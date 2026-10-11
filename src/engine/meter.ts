import { createHash } from "node:crypto";
import type { Ledger } from "./budget";
import { LoootError, type Runner } from "./looot";
import { toMicros } from "./money";
import type { PriceMap } from "./looot";
import type { CallRecord } from "./types";
import type { EndpointDef } from "./endpoints";

/** Lowercases text, trims it and sorts object keys, so the same request always normalises to the same value. */
export function normalizeInput(v: unknown): unknown {
  if (typeof v === "string") return v.trim().toLowerCase();
  if (Array.isArray(v)) return v.map(normalizeInput);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, normalizeInput(x)]));
  return v;
}

/** Hash of what a paid call asks for: endpoint and normalised input. Guards a short key against a collision. */
export function callFingerprint(endpointId: string, input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify([endpointId, normalizeInput(input)])).digest("hex");
}

const FAIL_STOPS = new Set(["unauthorized", "insufficient_funds", "payment_required", "invalid_token", "missing_token"]);

export interface MeterOptions {
  looot: Runner;
  prices: PriceMap;
  /** Endpoint ids whose live price could not be read. A call to one of them is refused. */
  unpriced?: readonly string[];
  capMicros: number;
  /** Period budget, reservations and stored answers. Left out in demo mode and in tests that do not need it. */
  ledger?: Ledger;
  /** The clock for the ledger. Default: the real time. */
  now?: Date;
  /** Demo mode: nothing is charged, the cap is not applied, the price check is skipped. */
  demo?: boolean;
}

export interface MeterResult {
  status: CallRecord["status"];
  result?: unknown;
  costMicros: number;
  record: CallRecord;
}

/**
 * Wraps every paid call. Before a call it reserves the list price against the cap, so the spend can never pass the cap.
 * A call still running when waiting stops is "pending", never a failure. A fatal error (token, balance) stops all later calls.
 */
export class Meter {
  committed = 0;
  spent = 0;
  skippedByCap = 0;
  skippedByBudget = 0;
  budgetMessage: string | null = null;
  pending = 0;
  failed = 0;
  aborted: string | null = null;
  readonly calls: CallRecord[] = [];
  readonly #o: MeterOptions;
  readonly #unpriced: Set<string>;

  constructor(opts: MeterOptions) {
    this.#o = opts;
    this.#unpriced = new Set(opts.unpriced ?? []);
  }

  listPrice(def: EndpointDef): number {
    return this.#o.prices[def.endpointId] ?? def.fallbackMicros;
  }

  async call(def: EndpointDef, input: Record<string, unknown>, idempotencyKey: string): Promise<MeterResult> {
    const list = this.listPrice(def);
    const rec = (status: CallRecord["status"], extra: Partial<CallRecord> = {}): MeterResult => {
      const record: CallRecord = { endpointId: def.endpointId, stage: def.step, status, listPriceMicros: list, costMicros: 0, ...extra };
      this.calls.push(record);
      return { status, costMicros: record.costMicros, record };
    };
    if (this.aborted) return rec("skipped_cap", { message: this.aborted });
    const ledger = this.#o.demo ? undefined : this.#o.ledger;
    const at = () => this.#o.now ?? new Date();
    const fp = callFingerprint(def.endpointId, input);
    // 1. A finished answer to the same request is replayed from the store: no call, no reservation, no charge.
    if (ledger) {
      const stored = await ledger.recall(idempotencyKey, fp, at());
      if (stored) return { ...rec("ok", { runId: stored.runId, message: "Answered from the stored result. No call, no charge." }), result: stored.result };
    }
    // 2. Quote (the price check) and the per-run cap.
    if (!this.#o.demo && (this.#unpriced.has(def.endpointId) || list <= 0)) return rec("skipped_price", { message: "Live price could not be read." });
    if (!this.#o.demo && this.committed + list > this.#o.capMicros) {
      this.skippedByCap += 1;
      return rec("skipped_cap", { message: "Spend cap reached." });
    }
    // 3. Atomic reservation against the daily and monthly budget.
    if (ledger) {
      const held = await ledger.reserve(idempotencyKey, list, at(), fp);
      if (!held.ok) {
        this.skippedByBudget += 1;
        this.budgetMessage = held.message;
        return rec("skipped_budget", { message: held.message });
      }
    }
    if (!this.#o.demo) this.committed += list;
    // 4. The call.
    try {
      const run = await this.#o.looot.runAndWait(def.endpointId, input, idempotencyKey);
      // Demo mode charges nothing; the list price is booked as a simulated cost so the cost panels have numbers.
      const cost = this.#o.demo ? list : toMicros(run.actualCost);
      if (run.status === "completed") {
        this.committed += cost - list;
        this.spent += cost;
        await ledger?.settle(idempotencyKey, fp, cost, at(), run);
        const r = rec("ok", { costMicros: cost, runId: run.runId });
        return { ...r, result: run.result };
      }
      if (run.status === "failed" || run.status === "blocked" || run.status === "stopped") {
        this.committed += cost - list;
        this.spent += cost;
        this.failed += 1;
        await ledger?.settle(idempotencyKey, fp, cost, at());
        return rec("failed", { costMicros: cost, runId: run.runId, message: run.error?.message ?? run.status });
      }
      // queued, running, reconciliation_pending, pending_provider: the provider has not finished. The reservation stays
      // until the run ends. It is never recorded as failed at zero.
      this.pending += 1;
      await ledger?.attach(idempotencyKey, run.runId);
      return rec("pending", { runId: run.runId, message: `Run ${run.runId} is ${run.status}.` });
    } catch (e) {
      this.committed -= list; // the request never produced a run in this process
      this.failed += 1;
      const err = e instanceof LoootError ? e : null;
      // An HTTP answer from looot means the call did not run, so the reservation goes back. A network error is unknown:
      // the request may have been accepted, so the reservation stays until a replay settles it or the hard expiry passes.
      if (err) await ledger?.release(idempotencyKey);
      const code = err?.code ?? "network_error";
      if (err && (FAIL_STOPS.has(code) || err.status === 401 || err.status === 402)) this.aborted = `Stopped: ${err.message}`;
      return rec("failed", { message: (e as Error).message });
    }
  }
}
