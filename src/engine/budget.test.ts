import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Budget, DEFAULT_LIMITS, HARD_EXPIRY_MS, RESERVE_TTL_MS } from "./budget";
import { demoConfig, DEMO_NOW } from "./demo";
import { emailEndpointIds, runEmails } from "./emailStep";
import { ENDPOINTS, FALLBACK_PRICES } from "./endpoints";
import { LoootError, type LoootRun, type Runner } from "./looot";
import { Meter } from "./meter";
import { idempotencyKey, runWarm } from "./run";
import { emptyState } from "./state";
import type { Lead } from "./types";

const now = DEMO_NOW;
let dir: string;
let file: string;
const open = () => new Budget(file);

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-"));
  file = join(dir, "budget.json");
});

/** A runner whose answer you choose. It records every call that reaches it. */
function runner(answer: (n: number, endpointId: string) => LoootRun | Promise<LoootRun>) {
  const calls: string[] = [];
  const looot: Runner = {
    async runAndWait(endpointId) {
      calls.push(endpointId);
      return answer(calls.length, endpointId);
    },
  };
  return { looot, calls };
}
const completed = (cost: number, runId = "run_ok"): LoootRun => ({ runId, status: "completed", result: {}, actualCost: cost });
/** Charges the list price of the endpoint, like a live run. */
const chargeList = (n: number, endpointId: string): LoootRun => ({ runId: `r${n}`, status: "completed", result: {}, actualCost: (FALLBACK_PRICES[endpointId] ?? 0) / 1e6 });

const profileDef = ENDPOINTS.profile;
const profileInput = (i: number) => ({ profileUrlOrUrn: `https://www.linkedin.com/in/person-${i}` });

describe("period budget", () => {
  it("has a default daily and monthly limit that the owner can change", async () => {
    const b = open();
    expect((await b.status(now)).limits).toEqual(DEFAULT_LIMITS);
    await b.setLimits({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
    expect((await open().status(now)).limits).toEqual({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
  });

  it("lets exactly one of two concurrent reservations through when their sum is over the budget", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all([open().reserve("k1", 700_000, now), open().reserve("k2", 700_000, now)]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(out.filter((r) => !r.ok)).toHaveLength(1);
    expect((await open().status(now)).day.reservedMicros).toBe(700_000);
  });

  it("holds under 25 concurrent reservations from separate handles", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all(Array.from({ length: 25 }, (_, i) => open().reserve(`k${i}`, 100_000, now)));
    expect(out.filter((r) => r.ok)).toHaveLength(10);
    const s = await open().status(now);
    expect(s.day.reservedMicros).toBe(1_000_000);
    expect(s.day.remainingMicros).toBe(0);
  });

  it("stops many small runs at the budget and says which limit it hit", async () => {
    await open().setLimits({ dailyMicros: 300_000, monthlyMicros: 300_000 });
    const b = open();
    let ok = 0;
    let last = "";
    for (let i = 0; i < 10; i++) {
      const r = await b.reserve(`s${i}`, 100_000, now);
      if (r.ok) ok++;
      else last = r.message;
    }
    expect(ok).toBe(3);
    expect(last).toMatch(/budget is reached/i);
  });

  it("counts a settled run against the day and the month, and a new day starts clean", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    await b.reserve("a", 400_000, now);
    await b.settle("a", "fp", 350_000, now);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBe(350_000);
    expect(s.month.usedMicros).toBe(350_000);
    const next = new Date(now.getTime() + 86_400_000);
    const s2 = await b.status(next);
    expect(s2.day.usedMicros).toBe(0);
    expect(s2.month.usedMicros).toBe(350_000);
  });

  it("releases a reservation", async () => {
    const b = open();
    await b.reserve("a", 400_000, now);
    await b.release("a");
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("rejects limits that are not positive or put the day above the month", async () => {
    const b = open();
    await expect(b.setLimits({ dailyMicros: 0, monthlyMicros: 1_000_000 })).rejects.toThrow();
    await expect(b.setLimits({ dailyMicros: 5_000_000, monthlyMicros: 1_000_000 })).rejects.toThrow(/daily/i);
    await expect(b.setLimits({ dailyMicros: Number.NaN, monthlyMicros: 1_000_000 })).rejects.toThrow();
  });
});

describe("reconciling reservations", () => {
  async function pendingReservation() {
    const b = open();
    await b.reserve("p", 10_000, now);
    await b.attach("p", "run_p");
    return b;
  }

  it("settles a late completion to the real cost", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "completed", result: { x: 1 }, actualCost: 0.0031 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(3_100);
  });

  it("keeps the reservation while the run is still going", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "running" }) }, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(10_000);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases when the run ended failed with no charge", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "failed", actualCost: 0 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("keeps an unfetchable run reserved until the hard expiry, then releases it", async () => {
    const b = await pendingReservation();
    const broken = { getRun: async (): Promise<LoootRun> => { throw new LoootError("down", 503); } };
    await b.reconcile(broken, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(broken, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps a reservation that never got a run id until the hard expiry", async () => {
    const b = open();
    await b.reserve("crash", 10_000, now);
    const never = { getRun: async (): Promise<LoootRun> => { throw new Error("not called"); } };
    await b.reconcile(never, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(never, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });
});

describe("Meter with the budget", () => {
  const meter = (looot: Runner, b: Budget, capMicros = 50_000_000) => new Meter({ looot, prices: FALLBACK_PRICES, capMicros, ledger: b, now });
  const price = FALLBACK_PRICES[profileDef.endpointId];

  it("keeps the total charged inside the budget when concurrent calls add up to more", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: price * 10, monthlyMicros: price * 10 });
    const { looot, calls } = runner(async (n, e) => {
      await new Promise((r) => setTimeout(r, 10));
      return chargeList(n, e);
    });
    // Three meters on three handles, 30 different calls started together.
    const meters = [meter(looot, open()), meter(looot, open()), meter(looot, open())];
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => meters[i % 3].call(profileDef, profileInput(i), idempotencyKey(profileDef, profileInput(i), now))));
    expect(results.filter((r) => r.status === "ok")).toHaveLength(10);
    expect(results.filter((r) => r.status === "skipped_budget")).toHaveLength(20);
    expect(calls).toHaveLength(10);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBe(price * 10);
    expect(s.day.usedMicros).toBeLessThanOrEqual(s.day.limitMicros);
    expect(s.day.reservedMicros).toBe(0);
  });

  it("stops many small calls one after another at the budget", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: price * 4, monthlyMicros: price * 50 });
    const { looot } = runner(chargeList);
    const m = meter(looot, b);
    const out: string[] = [];
    for (let i = 0; i < 12; i++) out.push((await m.call(profileDef, profileInput(i), idempotencyKey(profileDef, profileInput(i), now))).status);
    expect(out.filter((s) => s === "ok")).toHaveLength(4);
    expect(out.filter((s) => s === "skipped_budget")).toHaveLength(8);
    expect(m.skippedByBudget).toBe(8);
    expect(m.budgetMessage).toMatch(/daily budget is reached/i);
  });

  it("keeps the reservation of a pending call and never counts it as zero", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "run_slow", status: "running" }));
    const m = meter(looot, b);
    const r = await m.call(profileDef, profileInput(1), idempotencyKey(profileDef, profileInput(1), now));
    expect(r.status).toBe("pending");
    expect(m.failed).toBe(0);
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(price);
    expect(s.day.usedMicros).toBe(0);
  });

  it("settles a pending call to its real cost when it finishes late", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "run_slow", status: "pending_provider" }));
    await meter(looot, b).call(profileDef, profileInput(1), idempotencyKey(profileDef, profileInput(1), now));
    await b.reconcile({ getRun: async () => ({ runId: "run_slow", status: "completed", result: {}, actualCost: 0.0021 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(2_100);
  });

  it("releases the reservation when looot answers with an error", async () => {
    const b = open();
    const { looot } = runner(() => { throw new LoootError("bad input", 400, "invalid_input"); });
    const m = meter(looot, b);
    expect((await m.call(profileDef, profileInput(1), idempotencyKey(profileDef, profileInput(1), now))).status).toBe("failed");
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases a run looot reports failed at no charge", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "r", status: "failed", actualCost: 0, error: { code: "provider_error" } }));
    await meter(looot, b).call(profileDef, profileInput(1), idempotencyKey(profileDef, profileInput(1), now));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps the reservation when the network fails and the outcome is unknown", async () => {
    const b = open();
    const { looot } = runner(() => { throw new TypeError("fetch failed"); });
    await meter(looot, b).call(profileDef, profileInput(1), idempotencyKey(profileDef, profileInput(1), now));
    expect((await b.status(now)).day.reservedMicros).toBe(price);
  });

  it("does not charge a repeated identical call twice", async () => {
    const b = open();
    const first = runner(chargeList);
    const key = idempotencyKey(profileDef, profileInput(1), now);
    await meter(first.looot, b).call(profileDef, profileInput(1), key);
    const second = runner(chargeList);
    const again = await meter(second.looot, open()).call(profileDef, profileInput(1), key);
    expect(again.status).toBe("ok");
    expect(again.costMicros).toBe(0);
    expect(second.calls).toHaveLength(0);
    expect((await b.status(now)).day.usedMicros).toBe(price);
  });

  it("is not used in demo mode", async () => {
    const b = open();
    const m = new Meter({ looot: runner(() => completed(0)).looot, prices: FALLBACK_PRICES, capMicros: 0, ledger: b, demo: true, now });
    await m.call(profileDef, profileInput(1), "k");
    expect(() => readFileSync(file, "utf8")).toThrow();
  });
});

describe("runWarm with the budget", () => {
  const cfg = () => demoConfig();
  const go = (looot: Runner, b: Budget, over: Partial<Parameters<typeof runWarm>[0]> = {}) =>
    runWarm({ config: cfg(), looot, prices: FALLBACK_PRICES, capMicros: 50_000_000, state: emptyState(), now, ledger: b, ...over });

  it("does not charge a repeated identical run twice", async () => {
    const b = open();
    const first = runner(chargeList);
    const r1 = await go(first.looot, b);
    expect(first.calls.length).toBeGreaterThan(0);
    const second = runner(chargeList);
    const r2 = await go(second.looot, open());
    expect(second.calls).toHaveLength(0);
    expect(r2.summary.spentMicros).toBe(0);
    expect(r2.summary.leads).toBe(r1.summary.leads);
    expect((await b.status(now)).day.usedMicros).toBe(r1.summary.spentMicros);
  });

  it("stays inside the budget and reports the skipped calls", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 5_000, monthlyMicros: 5_000 });
    const { looot } = runner(chargeList);
    const r = await go(looot, b);
    expect(r.summary.skippedByBudget).toBeGreaterThan(0);
    expect(r.summary.notes.join(" ")).toMatch(/budget/i);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBeLessThanOrEqual(5_000);
    expect(r.summary.spentMicros).toBeLessThanOrEqual(5_000);
  });

  it("keeps pending reservations and does not count the calls failed", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "run_slow", status: "running" }));
    const r = await go(looot, b);
    expect(r.summary.pendingCalls).toBeGreaterThan(0);
    expect(r.summary.failedCalls).toBe(0);
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBeGreaterThan(0);
    expect(s.day.usedMicros).toBe(0);
  });
});

describe("stable idempotency keys", () => {
  const def = ENDPOINTS.profile;
  const input = { profileUrlOrUrn: "https://www.linkedin.com/in/a" };
  it("is the same for the same call, whatever the case or key order of the input", () => {
    const a = idempotencyKey(def, input, now);
    expect(idempotencyKey(def, { profileUrlOrUrn: "HTTPS://www.linkedin.com/in/A " }, now)).toBe(a);
    expect(idempotencyKey(def, { a: 1, b: 2 }, now)).toBe(idempotencyKey(def, { b: 2, a: 1 }, now));
  });
  it("differs for another input or endpoint", () => {
    const a = idempotencyKey(def, input, now);
    expect(idempotencyKey(def, { profileUrlOrUrn: "https://www.linkedin.com/in/b" }, now)).not.toBe(a);
    expect(idempotencyKey(ENDPOINTS.company, input, now)).not.toBe(a);
  });
  it("holds for the whole refresh period and changes only when the next period starts", () => {
    const a = idempotencyKey(def, input, new Date("2026-10-10T00:00:01Z"));
    expect(idempotencyKey(def, input, new Date("2026-10-10T23:59:59Z"))).toBe(a);
    expect(idempotencyKey(def, input, new Date("2026-10-11T00:00:01Z"))).not.toBe(a);
    expect(a).not.toMatch(/2026|T\d\d/);
  });
});

describe("email step with the budget", () => {
  const lead = (id: string): Lead => ({ id, name: "A B", firstName: "A", lastName: "B", linkedinUrl: `https://www.linkedin.com/in/${id}`, events: [], fit: [], fitPoints: 0, intentPoints: 0, rawIntent: 0, score: 50, band: "warm", breakdown: [], reasons: [], enrichCostMicros: 0, costMicros: 0, enriched: true, firstSeen: "", lastSeen: "", isNew: false, replies: [] });
  const cfg = demoConfig();
  const prices = (() => {
    const m = { ...FALLBACK_PRICES };
    for (const id of emailEndpointIds(cfg)) m[id] ??= 5_000;
    return m;
  })();
  const answer = (n: number, e: string): LoootRun => (e === emailEndpointIds(cfg)[0] ? { runId: `f${n}`, status: "completed", result: { emails: [{ email: `p${n}@acme.example` }] }, actualCost: 0.005 } : { runId: `v${n}`, status: "completed", result: { result: "ok" }, actualCost: 0.001 });
  const go = (leads: Lead[], looot: Runner, b: Budget) => runEmails({ leads, config: cfg, looot, prices, capMicros: 50_000_000, now, ledger: b });

  it("does not charge the same lead twice", async () => {
    const b = open();
    const first = runner(answer);
    await go([lead("a")], first.looot, b);
    const second = runner(answer);
    const r2 = await go([lead("a")], second.looot, open());
    expect(first.calls.length).toBeGreaterThan(0);
    expect(second.calls).toHaveLength(0);
    expect(r2.spentMicros).toBe(0);
  });

  it("stops at the budget and keeps a pending find reserved", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 8_000, monthlyMicros: 8_000 });
    const pend = runner(() => ({ runId: "run_slow", status: "running" }));
    const r = await go([lead("a"), lead("b"), lead("c")], pend.looot, b);
    expect(r.pending).toBe(2);
    expect(r.skippedByBudget).toBe(1);
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBeLessThanOrEqual(8_000);
    expect(s.day.reservedMicros).toBeGreaterThan(0);
    expect(s.day.usedMicros).toBe(0);
  });
});

describe("the budget file", () => {
  it("survives a damaged file by falling back to the defaults", async () => {
    writeFileSync(file, "{not json");
    expect((await open().status(now)).limits).toEqual(DEFAULT_LIMITS);
  });
});
