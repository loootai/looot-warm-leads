/** Error from the looot API, with the HTTP status and looot's error code when there is one. */
export class LoootError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "LoootError";
  }
}

export interface LoootRun {
  runId: string;
  status: string;
  result?: unknown;
  actualCost?: number | string | null;
  error?: { code?: string; message?: string } | null;
}

export const TERMINAL_STATUSES = new Set(["completed", "failed", "blocked", "stopped"]);

export interface LoootClientOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** How long to keep polling a run that is still queued or running. */
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** The part of the client the engine needs. Tests and the demo pass their own. */
export interface Runner {
  runAndWait(endpointId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<LoootRun>;
}

/** Client for the looot calls this app makes: run an endpoint, read a run, read the balance. */
export class LoootClient implements Runner {
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #pollTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(opts: LoootClientOptions) {
    this.#token = opts.token;
    this.#baseUrl = (opts.baseUrl ?? "https://api.looot.ai").replace(/\/+$/, "");
    this.#fetch = opts.fetch ?? fetch;
    this.#pollTimeoutMs = opts.pollTimeoutMs ?? 60_000;
    this.#pollIntervalMs = opts.pollIntervalMs ?? 2_000;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = (json as { error?: { message?: string; code?: string } } | null)?.error;
      throw new LoootError(err?.message ?? `looot returned HTTP ${res.status}`, res.status, err?.code);
    }
    return json as T;
  }

  /**
   * Paid. Runs one pinned endpoint, with no provider fallback, so the price is the one quoted.
   * The same idempotency key replays the stored run and never charges twice.
   */
  run(endpointId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<LoootRun> {
    return this.#request("POST", "/v1/runs?wait=30", { endpointId, input, idempotencyKey });
  }

  /** Free. Reads a run again. */
  getRun(runId: string): Promise<LoootRun> {
    return this.#request("GET", `/v1/runs/${encodeURIComponent(runId)}`);
  }

  /** Runs an endpoint and polls until the run ends or the poll timeout passes. */
  async runAndWait(endpointId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<LoootRun> {
    let run = await this.run(endpointId, input, idempotencyKey);
    const deadline = Date.now() + this.#pollTimeoutMs;
    while (!TERMINAL_STATUSES.has(run.status) && Date.now() < deadline) {
      await this.#sleep(this.#pollIntervalMs);
      run = await this.getRun(run.runId);
    }
    return run;
  }

  /** Free. Reads the prepaid balance. */
  balance(): Promise<unknown> {
    return this.#request("GET", "/v1/balance");
  }
}

/** true when LOOOT_TOKEN is set. The value itself never leaves this file. */
export function hasLoootToken(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.LOOOT_TOKEN);
}

/** Builds a client from LOOOT_TOKEN. Throws when the token is missing. */
export function loootFromEnv(env: Record<string, string | undefined> = process.env): LoootClient {
  const token = env.LOOOT_TOKEN;
  if (!token) throw new LoootError("LOOOT_TOKEN is not set", 500, "missing_token");
  return new LoootClient({ token, baseUrl: env.LOOOT_API_URL });
}

/** A price entry as the public catalog returns it. */
interface CatalogItem {
  price?: { state?: string; amountMicros?: number; unit?: string } | null;
}

/** Reads the per-call price in micros from one public catalog item. null when it has no known call price. */
export function priceOfItem(item: CatalogItem | null | undefined): number | null {
  const p = item?.price;
  if (!p || p.state !== "known" || typeof p.amountMicros !== "number" || p.amountMicros < 0) return null;
  if (p.unit && p.unit !== "call") return null;
  return Math.round(p.amountMicros);
}

export type PriceMap = Record<string, number>;

export interface PriceResult {
  prices: PriceMap;
  source: "catalog" | "fallback";
  /** Endpoints whose live price could not be read. Their entry in `prices` is the dated fallback. */
  unread: string[];
}

/**
 * Free, no token needed. Reads current per-call prices from the public catalog. An endpoint that cannot be read keeps
 * its dated fallback price and is named in `unread`, so the engine refuses to call it.
 */
export async function fetchPrices(fallback: PriceMap, opts: { baseUrl?: string; fetch?: typeof fetch } = {}): Promise<PriceResult> {
  const base = (opts.baseUrl ?? process.env.LOOOT_API_URL ?? "https://api.looot.ai").replace(/\/+$/, "");
  const f = opts.fetch ?? fetch;
  const prices: PriceMap = { ...fallback };
  const unread: string[] = [];
  await Promise.all(
    Object.keys(fallback).map(async (id) => {
      try {
        const res = await f(`${base}/v1/public-catalog/${encodeURIComponent(id)}`);
        const price = res.ok ? priceOfItem((await res.json()) as CatalogItem) : null;
        if (price === null) unread.push(id);
        else prices[id] = price;
      } catch {
        unread.push(id);
      }
    }),
  );
  return { prices, source: unread.length > 0 ? "fallback" : "catalog", unread };
}
