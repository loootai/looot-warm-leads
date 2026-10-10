import { LoootError, type Runner } from "./looot";
import { toMicros } from "./money";
import type { PriceMap } from "./looot";
import type { CallRecord } from "./types";
import type { EndpointDef } from "./endpoints";

const FAIL_STOPS = new Set(["unauthorized", "insufficient_funds", "payment_required", "invalid_token", "missing_token"]);

export interface MeterOptions {
  looot: Runner;
  prices: PriceMap;
  /** Endpoint ids whose live price could not be read. A call to one of them is refused. */
  unpriced?: readonly string[];
  capMicros: number;
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
    if (!this.#o.demo && (this.#unpriced.has(def.endpointId) || list <= 0)) return rec("skipped_price", { message: "Live price could not be read." });
    if (!this.#o.demo && this.committed + list > this.#o.capMicros) {
      this.skippedByCap += 1;
      return rec("skipped_cap", { message: "Spend cap reached." });
    }
    if (!this.#o.demo) this.committed += list;
    try {
      const run = await this.#o.looot.runAndWait(def.endpointId, input, idempotencyKey);
      // Demo mode charges nothing; the list price is booked as a simulated cost so the cost panels have numbers.
      const cost = this.#o.demo ? list : toMicros(run.actualCost);
      if (run.status === "completed") {
        this.committed += cost - list;
        this.spent += cost;
        const r = rec("ok", { costMicros: cost, runId: run.runId });
        return { ...r, result: run.result };
      }
      if (run.status === "failed" || run.status === "blocked" || run.status === "stopped") {
        this.committed += cost - list;
        this.spent += cost;
        this.failed += 1;
        return rec("failed", { costMicros: cost, runId: run.runId, message: run.error?.message ?? run.status });
      }
      // queued, running, reconciliation_pending, pending_provider: the provider has not finished. Keep the reservation.
      this.pending += 1;
      return rec("pending", { runId: run.runId, message: `Run ${run.runId} is ${run.status}.` });
    } catch (e) {
      this.committed -= list; // the request never produced a run
      this.failed += 1;
      const err = e instanceof LoootError ? e : null;
      const code = err?.code ?? "network_error";
      if (err && (FAIL_STOPS.has(code) || err.status === 401 || err.status === 402)) this.aborted = `Stopped: ${err.message}`;
      return rec("failed", { message: (e as Error).message });
    }
  }
}
