import fs from "node:fs";
import path from "node:path";
import type { LoootRun } from "./looot";
import { toMicros, usd } from "./money";

/** Daily and monthly spend limits in micro-dollars. */
export interface BudgetLimits {
  dailyMicros: number;
  monthlyMicros: number;
}

/** Used when the owner has not set a budget: $10 a day, $50 a month. */
export const DEFAULT_LIMITS: BudgetLimits = { dailyMicros: 10_000_000, monthlyMicros: 50_000_000 };

/** A reservation with no answer after this long is looked up through GET /v1/runs/{id}. */
export const RESERVE_TTL_MS = 10 * 60_000;
/** A reservation that cannot be looked up is released after this long. */
export const HARD_EXPIRY_MS = 24 * 3_600_000;
/** Stored answers to paid calls are kept this long. The key's freshness window is shorter or equal. */
export const RESULT_TTL_MS = 40 * 24 * 3_600_000;

const LOCK_STALE_MS = 15_000;
const LOCK_WAIT_MS = 30_000;

interface Reservation {
  micros: number;
  at: string;
  runId?: string;
  /** Fingerprint of the call, so a run that ends later is stored under the right request. */
  fingerprint?: string;
}

interface SpentEntry {
  at: string;
  micros: number;
  key: string;
}

interface StoredResult {
  at: string;
  fingerprint: string;
  run: LoootRun;
}

interface BudgetData {
  limits: BudgetLimits | null;
  reservations: Record<string, Reservation>;
  spent: SpentEntry[];
  results: Record<string, StoredResult>;
}

export interface PeriodStatus {
  limitMicros: number;
  usedMicros: number;
  reservedMicros: number;
  remainingMicros: number;
}

export interface BudgetStatus {
  limits: BudgetLimits;
  /** false when the owner has set the limits. */
  isDefault: boolean;
  day: PeriodStatus;
  month: PeriodStatus;
  /** The smaller of the two remainders: what one more run can spend. */
  remainingMicros: number;
  reservations: number;
}

export type ReserveResult = { ok: true; shared: boolean } | { ok: false; message: string };

/** What the engine needs from the budget. Tests and the demo pass their own or none. */
export interface Ledger {
  recall(key: string, fingerprint: string, now: Date): Promise<LoootRun | null>;
  reserve(key: string, micros: number, now: Date, fingerprint?: string): Promise<ReserveResult>;
  attach(key: string, runId: string): Promise<void>;
  settle(key: string, fingerprint: string, micros: number, now: Date, run?: LoootRun): Promise<void>;
  release(key: string): Promise<void>;
}

const emptyData = (): BudgetData => ({ limits: null, reservations: {}, spent: [], results: {} });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dayOf = (iso: string) => iso.slice(0, 10);
const monthOf = (iso: string) => iso.slice(0, 7);

/** Where the budget lives: budget.json next to state.json (in WARM_DIR). */
export function budgetFile(env: Record<string, string | undefined> = process.env): string {
  return path.resolve(/*turbopackIgnore: true*/ env.WARM_DIR ?? ".looot-warm", "budget.json");
}

/** Limits from the server's environment, used until the owner saves their own. Read once per file. */
export function defaultLimits(env: Record<string, string | undefined> = process.env): BudgetLimits {
  const d = Number(env.WARM_DAILY_USD);
  const m = Number(env.WARM_MONTHLY_USD);
  const daily = Number.isFinite(d) && d > 0 ? toMicros(d) : DEFAULT_LIMITS.dailyMicros;
  const monthly = Number.isFinite(m) && m > 0 ? toMicros(m) : DEFAULT_LIMITS.monthlyMicros;
  return { dailyMicros: Math.min(daily, monthly), monthlyMicros: monthly };
}

/**
 * Period budget, reservations and stored results in one JSON file. Every change takes a lock file, reads the file,
 * changes it and writes it back through a temp file and a rename, so two requests or two processes cannot both pass.
 */
export class Budget implements Ledger {
  readonly #file: string;
  readonly #defaults: BudgetLimits;

  constructor(file: string = budgetFile(), defaults: BudgetLimits = defaultLimits()) {
    this.#file = file;
    this.#defaults = defaults;
  }

  #read(): BudgetData {
    try {
      const raw = JSON.parse(fs.readFileSync(this.#file, "utf8")) as Partial<BudgetData>;
      return { limits: raw.limits ?? null, reservations: raw.reservations ?? {}, spent: raw.spent ?? [], results: raw.results ?? {} };
    } catch {
      return emptyData();
    }
  }

  async #lock(): Promise<() => void> {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const lock = `${this.#file}.lock`;
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        fs.closeSync(fs.openSync(lock, "wx"));
        return () => fs.rmSync(lock, { force: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        try {
          if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true });
        } catch {}
        if (Date.now() > deadline) throw new Error("The budget file is locked by another process. Try again.");
        await sleep(5 + Math.floor(Math.random() * 15));
      }
    }
  }

  async #mutate<T>(fn: (d: BudgetData) => T): Promise<T> {
    const unlock = await this.#lock();
    try {
      const d = this.#read();
      const out = fn(d);
      const tmp = `${this.#file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(d));
      fs.renameSync(tmp, this.#file);
      return out;
    } finally {
      unlock();
    }
  }

  #limits(d: BudgetData): BudgetLimits {
    return d.limits ?? this.#defaults;
  }

  #status(d: BudgetData, now: Date): BudgetStatus {
    const limits = this.#limits(d);
    const iso = now.toISOString();
    const reserved = Object.values(d.reservations).reduce((n, r) => n + r.micros, 0);
    const usedIn = (f: (at: string) => boolean) => d.spent.filter((s) => f(s.at)).reduce((n, s) => n + s.micros, 0);
    const period = (limit: number, used: number): PeriodStatus => ({ limitMicros: limit, usedMicros: used, reservedMicros: reserved, remainingMicros: Math.max(0, limit - used - reserved) });
    const day = period(limits.dailyMicros, usedIn((at) => dayOf(at) === dayOf(iso)));
    const month = period(limits.monthlyMicros, usedIn((at) => monthOf(at) === monthOf(iso)));
    return { limits, isDefault: d.limits === null, day, month, remainingMicros: Math.min(day.remainingMicros, month.remainingMicros), reservations: Object.keys(d.reservations).length };
  }

  /** Used, reserved and remaining for today and this month. Read only. */
  async status(now: Date = new Date()): Promise<BudgetStatus> {
    return this.#status(this.#read(), now);
  }

  /** Owner only: saves new limits. Throws on a limit that is not a positive number or a day above the month. */
  async setLimits(limits: BudgetLimits): Promise<BudgetLimits> {
    const { dailyMicros: d, monthlyMicros: m } = limits;
    if (!Number.isFinite(d) || !Number.isFinite(m) || d <= 0 || m <= 0) throw new Error("Budgets must be positive dollar amounts.");
    if (d > m) throw new Error("The daily budget cannot be above the monthly budget.");
    const next = { dailyMicros: Math.round(d), monthlyMicros: Math.round(m) };
    await this.#mutate((data) => {
      data.limits = next;
    });
    return next;
  }

  /** A stored answer to the same paid call, if one finished inside the window. */
  async recall(key: string, fingerprint: string, now: Date = new Date()): Promise<LoootRun | null> {
    const hit = this.#read().results[key];
    if (!hit || hit.fingerprint !== fingerprint) return null;
    return now.getTime() - Date.parse(hit.at) < RESULT_TTL_MS ? hit.run : null;
  }

  /**
   * Reserves the amount in one locked step. Refused when used + reserved + amount would pass the daily or the monthly
   * budget. A key that already holds a reservation shares it: the same call in flight is not paid for twice.
   */
  async reserve(key: string, micros: number, now: Date = new Date(), fingerprint = ""): Promise<ReserveResult> {
    return this.#mutate((d) => {
      this.#expire(d, now);
      if (d.reservations[key]) return { ok: true, shared: true } as const;
      const s = this.#status(d, now);
      for (const [name, p] of [["daily", s.day], ["monthly", s.month]] as const) {
        if (p.usedMicros + p.reservedMicros + micros > p.limitMicros) {
          return { ok: false, message: `The ${name} budget is reached: ${usd(p.usedMicros)} used and ${usd(p.reservedMicros)} reserved of ${usd(p.limitMicros)}. This call needs ${usd(micros)}. Raise the budget on the Cost page, or wait for the period to roll over.` } as const;
        }
      }
      d.reservations[key] = { micros, at: now.toISOString(), fingerprint };
      return { ok: true, shared: false } as const;
    });
  }

  /** Records the looot run id on a reservation that is still going. The reservation stays. */
  async attach(key: string, runId: string): Promise<void> {
    await this.#mutate((d) => {
      if (d.reservations[key]) d.reservations[key].runId = runId;
    });
  }

  /**
   * Turns a reservation into the real cost. A zero cost frees it. A finished run is stored under its key, so the same
   * request is answered later with no call. A second settle for a key that is already settled changes nothing.
   */
  async settle(key: string, fingerprint: string, micros: number, now: Date = new Date(), run?: LoootRun): Promise<void> {
    await this.#mutate((d) => {
      const held = d.reservations[key];
      delete d.reservations[key];
      if (held || !d.spent.some((s) => s.key === key)) {
        if (micros > 0) d.spent.push({ at: now.toISOString(), micros, key });
      }
      if (run) d.results[key] = { at: now.toISOString(), fingerprint, run };
      this.#prune(d, now);
    });
  }

  /** Gives a reservation back. Only for a call that is known not to have run. */
  async release(key: string): Promise<void> {
    await this.#mutate((d) => {
      delete d.reservations[key];
    });
  }

  /** Drops reservations that cannot be looked up and are past the hard expiry. */
  #expire(d: BudgetData, now: Date): void {
    for (const [k, r] of Object.entries(d.reservations)) {
      if (!r.runId && now.getTime() - Date.parse(r.at) > HARD_EXPIRY_MS) delete d.reservations[k];
    }
  }

  #prune(d: BudgetData, now: Date): void {
    const month = monthOf(now.toISOString());
    d.spent = d.spent.filter((s) => monthOf(s.at) === month);
    for (const [k, v] of Object.entries(d.results)) if (now.getTime() - Date.parse(v.at) > RESULT_TTL_MS) delete d.results[k];
  }

  /**
   * Looks up reservations that still hold a run id (any age) and settles the ones that ended: the real cost, and a
   * stored answer when the run completed. A run still going keeps its reservation. A lookup that fails keeps it too,
   * until the hard expiry. A reservation with no run id is released only at the hard expiry.
   */
  async reconcile(runner: { getRun(runId: string): Promise<LoootRun> }, now: Date = new Date()): Promise<void> {
    const snapshot = this.#read();
    for (const [key, r] of Object.entries(snapshot.reservations)) {
      const age = now.getTime() - Date.parse(r.at);
      if (!r.runId) {
        if (age > HARD_EXPIRY_MS) await this.release(key);
        continue;
      }
      let run: LoootRun | null = null;
      try {
        run = await runner.getRun(r.runId);
      } catch {
        if (age > HARD_EXPIRY_MS) await this.release(key);
        continue;
      }
      if (!["completed", "failed", "blocked", "stopped"].includes(run.status)) continue;
      const cost = toMicros(run.actualCost);
      await this.settle(key, r.fingerprint ?? "", cost, now, run.status === "completed" ? run : undefined);
    }
  }
}
