import { describe, expect, it } from "vitest";
import { defaultConfig, merge } from "./config";
import { demoConfig, demoRunner, DEMO_NOW } from "./demo";
import { FALLBACK_PRICES } from "./endpoints";
import { LoootError, type LoootRun, type Runner } from "./looot";
import { buildQuote, idempotencyKey, leadId, runWarm } from "./run";
import { ENDPOINTS } from "./endpoints";
import { emptyState, forget } from "./state";
import type { State } from "./types";

/** Wraps the sample runner so it records calls and charges the list price, like a live run would. */
function charged(opts: { statusFor?: (endpointId: string) => LoootRun["status"] | undefined; throwFor?: (endpointId: string) => Error | undefined } = {}) {
  const base = demoRunner();
  const calls: { endpointId: string; input: Record<string, unknown>; key: string }[] = [];
  const runner: Runner = {
    async runAndWait(endpointId, input, key) {
      calls.push({ endpointId, input, key });
      const err = opts.throwFor?.(endpointId);
      if (err) throw err;
      const st = opts.statusFor?.(endpointId);
      if (st && st !== "completed") return { runId: `r${calls.length}`, status: st, actualCost: null };
      const r = await base.runAndWait(endpointId, input, key);
      return { ...r, actualCost: (FALLBACK_PRICES[endpointId] ?? 0) / 1e6 };
    },
  };
  return { runner, calls };
}

const run = (runner: Runner, over: Partial<Parameters<typeof runWarm>[0]> = {}, state: State = emptyState()) =>
  runWarm({ config: demoConfig(), looot: runner, prices: FALLBACK_PRICES, capMicros: 5_000_000, state, now: DEMO_NOW, ...over });

describe("quote", () => {
  it("is the upper bound of calls times list price, and zero when there are no sources", () => {
    const q = buildQuote(demoConfig(), FALLBACK_PRICES);
    expect(q.totalMicros).toBe(q.lines.reduce((n, l) => n + l.calls * l.priceMicros, 0));
    expect(q.lines.find((l) => l.endpointId === "fetchin-profile")?.calls).toBe(60);
    expect(buildQuote(defaultConfig(), FALLBACK_PRICES).totalMicros).toBe(0);
  });
  it("uses the catalog price when one is given", () => {
    const q = buildQuote(demoConfig(), { ...FALLBACK_PRICES, "fetchin-profile": 5_000 });
    expect(q.lines.find((l) => l.endpointId === "fetchin-profile")?.priceMicros).toBe(5_000);
  });
});

describe("runWarm", () => {
  it("finds people, ranks them and splits each call's cost across the events it found", async () => {
    const { runner } = charged();
    const { summary, leads } = await run(runner);
    expect(summary.leads).toBeGreaterThan(5);
    expect(summary.spentMicros).toBeGreaterThan(0);
    expect(summary.spentMicros).toBeLessThanOrEqual(summary.quotedMicros);
    const top = Object.values(leads).sort((a, b) => b.score - a.score)[0];
    expect(top.breakdown.some((b) => b.type === "intent" && b.provider.length > 0 && b.evidence.length > 0)).toBe(true);
    const attributed = Object.values(leads).reduce((n, l) => n + l.costMicros, 0);
    expect(attributed).toBeGreaterThan(0);
    expect(attributed).toBeLessThanOrEqual(summary.spentMicros + 1);
  });
  it("leaves out excluded titles and does not read their profiles", async () => {
    const { runner, calls } = charged();
    const { leads } = await run(runner);
    expect(Object.values(leads).some((l) => /Recruiter|Student|Freelance/.test(l.title ?? l.headline ?? ""))).toBe(false);
    expect(calls.some((c) => String(c.input.profileUrlOrUrn).includes("chloe-martin"))).toBe(false);
  });
  it("never spends past the cap and says how many calls it skipped", async () => {
    const { runner } = charged();
    const { summary } = await run(runner, { capMicros: 20_000 });
    expect(summary.spentMicros).toBeLessThanOrEqual(20_000);
    expect(summary.skippedByCap).toBeGreaterThan(0);
    expect(summary.notes.join(" ")).toMatch(/skipped because the cap/);
  });
  it("counts an unfinished run as pending, not failed", async () => {
    const { runner } = charged({ statusFor: (e) => (e === "fetchin-profile" ? "pending_provider" : undefined) });
    const { summary } = await run(runner);
    expect(summary.pendingCalls).toBeGreaterThan(0);
    expect(summary.failedCalls).toBe(0);
    expect(summary.spentMicros).toBeLessThan(summary.quotedMicros);
  });
  it("stops every later call when looot answers 402", async () => {
    const { runner, calls } = charged({ throwFor: () => new LoootError("Top up.", 402, "insufficient_funds") });
    const { summary } = await run(runner, { config: merge(demoConfig(), { limits: { concurrency: 1 } }) });
    expect(summary.aborted).toMatch(/Top up/);
    expect(calls.length).toBe(1);
  });
  it("refuses a call whose live price could not be read", async () => {
    const { runner, calls } = charged();
    await run(runner, { unpriced: ["fetchin-post-engagement"] });
    expect(calls.some((c) => c.endpointId === "fetchin-post-engagement")).toBe(false);
  });
  it("sends the same idempotency key for the same input on the same day, and another one the next day", () => {
    const def = ENDPOINTS.profile;
    const input = { profileUrlOrUrn: "https://www.linkedin.com/in/a" };
    const a = idempotencyKey(def, input, new Date("2026-10-10T01:00:00Z"));
    expect(idempotencyKey(def, input, new Date("2026-10-10T23:00:00Z"))).toBe(a);
    expect(idempotencyKey(def, input, new Date("2026-10-11T01:00:00Z"))).not.toBe(a);
    expect(idempotencyKey(def, { profileUrlOrUrn: "https://www.linkedin.com/in/b" }, new Date("2026-10-10T01:00:00Z"))).not.toBe(a);
  });
  it("marks leads new only the first time, and reuses stored profiles instead of paying again", async () => {
    const first = charged();
    const r1 = await run(first.runner);
    const state = emptyState();
    state.leads = r1.leads;
    const second = charged();
    const r2 = await run(second.runner, {}, state);
    expect(r1.summary.newLeads).toBeGreaterThan(0);
    expect(r2.summary.newLeads).toBe(0);
    expect(second.calls.filter((c) => c.endpointId === "fetchin-profile").length).toBe(0);
  });
  it("does not add back a person who was erased", async () => {
    const r1 = await run(charged().runner);
    const state = emptyState();
    state.leads = r1.leads;
    const victim = Object.values(r1.leads).sort((a, b) => b.score - a.score)[0];
    forget(state, victim.linkedinUrl);
    const r2 = await run(charged().runner, {}, state);
    expect(r2.leads[victim.id]).toBeUndefined();
    expect(leadId(victim.linkedinUrl)).toBe(victim.id);
  });
});
