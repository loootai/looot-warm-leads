import { describe, expect, it, vi } from "vitest";
import { demoConfig, demoRunner, DEMO_NOW } from "./demo";
import { draftFor, fitTo, signalPhrase, topEvent } from "./draft";
import { emailQuote, runEmails } from "./emailStep";
import { instantlyCsv, leadsCsv, safeCell } from "./exportCsv";
import { FALLBACK_PRICES } from "./endpoints";
import { llmEnabled, llmRewrite } from "./llm";
import type { Runner } from "./looot";
import { runWarm } from "./run";
import { emptyState } from "./state";
import type { Lead } from "./types";

async function leads(): Promise<Lead[]> {
  const cfg = demoConfig();
  const { leads } = await runWarm({ config: cfg, looot: demoRunner(), prices: FALLBACK_PRICES, capMicros: 5_000_000, state: emptyState(), now: DEMO_NOW, demo: true });
  return Object.values(leads).filter((l) => !l.excluded).sort((a, b) => b.score - a.score);
}

describe("drafts", () => {
  it("refers to the real signal, fills every placeholder and stays inside the note limit", async () => {
    const cfg = demoConfig();
    for (const lead of (await leads()).slice(0, 8)) {
      const d = draftFor(lead, cfg);
      const ev = topEvent(lead)!;
      expect(d.connectionNote).toContain(ev.kind === "new_role" ? (lead.company as string) : ev.source);
      expect(signalPhrase(ev, lead).length).toBeGreaterThan(5);
      expect(d.connectionNote.length).toBeLessThanOrEqual(cfg.messages.noteMax);
      expect(`${d.connectionNote}${d.followUp}${d.email.body}${d.email.subject}`).not.toMatch(/\{[a-z_]+\}/);
      expect(d.signalRef).toContain(ev.title);
    }
  });
  it("warns instead of cutting silently when one sentence is already too long", () => {
    expect(fitTo("A very long single sentence without a stop that goes on", 10)).toContain("single");
    expect(fitTo("One. Two. Three.", 9)).toBe("One. Two.");
  });
  it("warns about a placeholder the template cannot fill", async () => {
    const cfg = demoConfig();
    cfg.messages.followUp = "Hi {first_name} {nope}";
    const d = draftFor((await leads())[0], cfg);
    expect(d.warnings.join(" ")).toContain("{nope}");
  });
});

describe("optional LLM step", () => {
  it("is off unless all three env vars are set and changes nothing", async () => {
    const [lead] = await leads();
    const cfg = demoConfig();
    const base = draftFor(lead, cfg);
    const f = vi.fn();
    expect(llmEnabled({ WARM_LLM: "anthropic" })).toBe(false);
    expect(await llmRewrite(lead, base, cfg, {}, f as unknown as typeof fetch)).toBe(base);
    expect(f).not.toHaveBeenCalled();
  });
  it("uses the answer when it is complete and short enough", async () => {
    const [lead] = await leads();
    const cfg = demoConfig();
    const base = draftFor(lead, cfg);
    const f = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ connectionNote: "Hi, short.", followUp: "F", emailSubject: "S", emailBody: "B" }) }] })));
    const d = await llmRewrite(lead, base, cfg, { WARM_LLM: "anthropic", ANTHROPIC_API_KEY: "k", WARM_LLM_MODEL: "m" }, f as unknown as typeof fetch);
    expect(d).toMatchObject({ by: "llm", connectionNote: "Hi, short." });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
  });
  it("keeps the template and warns when the call fails or the note is too long", async () => {
    const [lead] = await leads();
    const cfg = demoConfig();
    const base = draftFor(lead, cfg);
    const env = { WARM_LLM: "anthropic", ANTHROPIC_API_KEY: "k", WARM_LLM_MODEL: "m" };
    const bad = await llmRewrite(lead, base, cfg, env, (async () => new Response("no", { status: 500 })) as unknown as typeof fetch);
    expect(bad.by).toBe("template");
    expect(bad.warnings.join(" ")).toMatch(/LLM step failed/);
    const long = await llmRewrite(lead, base, cfg, env, (async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ connectionNote: "x".repeat(400), followUp: "F", emailSubject: "S", emailBody: "B" }) }] }))) as unknown as typeof fetch);
    expect(long.by).toBe("template");
  });
});

describe("exports", () => {
  it("defuses spreadsheet formulas", () => {
    expect(safeCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(safeCell("Ann")).toBe("Ann");
  });
  it("writes the ranked list with a header", async () => {
    const ls = await leads();
    const csv = leadsCsv(ls.slice(0, 3));
    expect(csv.split("\n")[0]).toBe("rank,score,band,first_name,last_name,title,company,company_domain,linkedin_url,email,email_status,top_signal,signal_url,signal_date,signals,first_seen,connection_note");
    expect(csv.split("\n")).toHaveLength(5);
  });
  it("puts only verified deliverable emails in the Instantly file", async () => {
    const ls = (await leads()).slice(0, 3);
    const at = DEMO_NOW.toISOString();
    ls[0].email = { address: "a@example.com", status: "ok", deliverable: true, findProvider: "p", verifyProvider: "v", costMicros: 0, at };
    ls[1].email = { address: "b@example.com", status: "catch_all", deliverable: false, findProvider: "p", verifyProvider: "v", costMicros: 0, at };
    const r = instantlyCsv(ls);
    expect(r.included).toBe(1);
    expect(r.skipped).toBe(2);
    expect(r.csv).toContain("a@example.com");
    expect(r.csv).not.toContain("b@example.com");
    expect(r.csv.split("\n")[0]).toBe("email,first_name,last_name,company_name,website,personalization,job_title,linkedin_url,signal,score");
  });
});

describe("email step", () => {
  it("quotes find plus verify per lead without a call", async () => {
    const ls = await leads();
    const q = emailQuote(ls.slice(0, 4), demoConfig(), FALLBACK_PRICES);
    expect(q.leads).toBe(4);
    expect(q.totalMicros).toBe(4 * (3_598 + 1_780));
    expect(q.lines.map((l) => l.jobId)).toEqual(["people.email.find", "people.email.verify"]);
  });
  it("finds then verifies, with a stable key per lead and step, and caps the spend", async () => {
    const ls = (await leads()).slice(0, 3);
    const calls: { id: string; key: string }[] = [];
    const base = demoRunner();
    const runner: Runner = { async runAndWait(id, input, key) { calls.push({ id, key }); const r = await base.runAndWait(id, input, key); return { ...r, actualCost: (FALLBACK_PRICES[id] ?? 0) / 1e6 }; } };
    const o = { leads: ls, config: demoConfig(), looot: runner, prices: FALLBACK_PRICES, capMicros: 1_000_000, now: DEMO_NOW };
    const r1 = await runEmails(o);
    expect(Object.values(r1.results).filter((x) => x.deliverable).length).toBeGreaterThan(0);
    const firstKeys = calls.map((c) => c.key);
    calls.length = 0;
    await runEmails(o);
    expect(calls.map((c) => c.key)).toEqual(firstKeys);
    const capped = await runEmails({ ...o, capMicros: 4_000 });
    expect(capped.spentMicros).toBeLessThanOrEqual(4_000);
    expect(capped.skippedByCap).toBeGreaterThan(0);
  });
  it("keeps a step that is still running as pending", async () => {
    const ls = (await leads()).slice(0, 1);
    const runner: Runner = { async runAndWait() { return { runId: "r", status: "pending_provider" }; } };
    const r = await runEmails({ leads: ls, config: demoConfig(), looot: runner, prices: FALLBACK_PRICES, capMicros: 1_000_000, now: DEMO_NOW });
    expect(r.results[ls[0].id]).toMatchObject({ pending: true, status: "pending" });
    expect(r.pending).toBe(1);
  });
});
