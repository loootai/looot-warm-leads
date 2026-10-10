import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoConfig, demoRunner } from "../engine/demo";
import { FALLBACK_PRICES } from "../engine/endpoints";
import type { Runner } from "../engine/looot";
import { saveConfig } from "../engine/config";
import { main, parseArgs } from "./cli";

let dir: string;
let env: Record<string, string | undefined>;
/** Stands in for the public catalog: every endpoint answers with its dated list price. */
const noNet = (async (url: string) => {
  const id = decodeURIComponent(String(url).split("/").pop() ?? "");
  const micros = FALLBACK_PRICES[id];
  return micros === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify({ price: { state: "known", amountMicros: micros, unit: "call" } }));
}) as unknown as typeof fetch;
const noCatalog = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
const lines: string[] = [];
const out = (s: string) => void lines.push(s);

beforeEach(() => {
  lines.length = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "warm-cli-"));
  const cfg = demoConfig();
  cfg.limits.engagementPostsPerSource = 1;
  cfg.limits.maxEnrich = 10;
  cfg.limits.maxTriggerCompanies = 3;
  saveConfig(cfg, path.join(dir, "config.json"));
  env = { WARM_DIR: dir, LOOOT_TOKEN: "tok_test" };
});

function charged(): { runner: Runner; calls: string[] } {
  const base = demoRunner();
  const calls: string[] = [];
  return { calls, runner: { async runAndWait(id, input, key) { calls.push(id); const r = await base.runAndWait(id, input, key); return { ...r, actualCost: (FALLBACK_PRICES[id] ?? 0) / 1e6 }; } } };
}

describe("args", () => {
  it("rejects an unknown flag so a typo never runs with defaults", async () => {
    expect(await main(["run", "--max-spnd", "3"], env, out)).toBe(1);
    expect(lines.join("\n")).toMatch(/Unknown option --max-spnd/);
  });
  it("treats boolean flags as true and takes values for the rest", () => {
    expect(parseArgs(["run", "--dry-run", "--max-spend", "3"], ["dry-run", "max-spend"])).toEqual({ pos: ["run"], flags: { "dry-run": true, "max-spend": "3" } });
  });
});

describe("run", () => {
  it("--dry-run prints the list-price cost and makes no looot call", async () => {
    const looot: Runner = { runAndWait: vi.fn(async () => { throw new Error("must not be called"); }) };
    const code = await main(["run", "--dry-run"], env, out, { looot, fetch: noNet });
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toMatch(/Upper bound/);
    expect(text).toMatch(/Dry run. No call was made./);
    expect(looot.runAndWait).not.toHaveBeenCalled();
  });
  it("refuses without LOOOT_TOKEN (exit 2) and says how to preview", async () => {
    expect(await main(["run"], { WARM_DIR: dir }, out, { fetch: noNet })).toBe(2);
    expect(lines.join("\n")).toMatch(/LOOOT_TOKEN is not set/);
  });
  it("refuses when the quote is above the cap (exit 2) and makes no call", async () => {
    const { runner, calls } = charged();
    expect(await main(["run", "--max-spend", "0.01"], env, out, { looot: runner, fetch: noNet })).toBe(2);
    expect(lines.join("\n")).toMatch(/above the cap/);
    expect(calls).toHaveLength(0);
  });
  it("runs inside the cap, writes json, csv and md, and the new-leads files with --since-last", async () => {
    const { runner } = charged();
    const o = path.join(dir, "out");
    expect(await main(["run", "--max-spend", "2", "--since-last", "--out", o], env, out, { looot: runner, fetch: noNet })).toBe(0);
    const files = fs.readdirSync(o);
    expect(files.some((f) => /^warm-.*\.json$/.test(f))).toBe(true);
    expect(files.some((f) => /^new-.*\.md$/.test(f))).toBe(true);
    const csv = fs.readFileSync(path.join(o, files.find((f) => /^warm-.*\.csv$/.test(f))!), "utf8");
    expect(csv.split("\n")[0]).toContain("rank,score");
    expect(lines.join("\n")).toMatch(/\d+ leads on the list, [1-9]\d* new\. Spent \$0\.\d+/);
    // A second run the same day lists no new leads.
    lines.length = 0;
    await main(["run", "--max-spend", "2", "--since-last", "--out", o], env, out, { looot: runner, fetch: noNet });
    expect(lines.join("\n")).toMatch(/, 0 new\./);
  });
  it("fails loudly, and calls nothing, when no live price can be read", async () => {
    const { runner, calls } = charged();
    expect(await main(["run", "--max-spend", "2", "--out", path.join(dir, "o")], env, out, { looot: runner, fetch: noCatalog })).toBe(1);
    expect(lines.join("\n")).toMatch(/prices could not be read/);
    expect(calls).toHaveLength(0);
  });
  it("--demo needs no token and no network", async () => {
    const o = path.join(dir, "demo-out");
    expect(await main(["run", "--demo", "--out", o], { WARM_DIR: dir }, out)).toBe(0);
    expect(lines.join("\n")).toMatch(/Demo run \(simulated cost\)/);
  });
});

describe("email, export, outbox, privacy", () => {
  it("quotes the email lookup first and --dry-run makes no call", async () => {
    const { runner, calls } = charged();
    await main(["run", "--max-spend", "2", "--out", path.join(dir, "o")], env, out, { looot: runner, fetch: noNet });
    calls.length = 0;
    lines.length = 0;
    expect(await main(["email", "--top", "2", "--dry-run"], env, out, { looot: runner, fetch: noNet })).toBe(0);
    expect(lines.join("\n")).toMatch(/Work email find/);
    expect(calls).toHaveLength(0);
    expect(await main(["email", "--top", "2", "--max-spend", "0.5"], env, out, { looot: runner, fetch: noNet })).toBe(0);
    expect(calls.filter((c) => c === "anysite-api-linkedin-user-email")).toHaveLength(2);
  });
  it("writes the Instantly file with verified emails only", async () => {
    const { runner } = charged();
    await main(["run", "--max-spend", "2", "--out", path.join(dir, "o")], env, out, { looot: runner, fetch: noNet });
    await main(["email", "--top", "3", "--max-spend", "0.5"], env, out, { looot: runner, fetch: noNet });
    lines.length = 0;
    const o = path.join(dir, "exp");
    expect(await main(["export", "--format", "instantly", "--out", o], env, out, { fetch: noNet })).toBe(0);
    expect(lines.join("\n")).toMatch(/with a verified email/);
    const f = fs.readdirSync(o).find((x) => x.startsWith("instantly-"))!;
    expect(fs.readFileSync(path.join(o, f), "utf8").split("\n")[0]).toBe("email,first_name,last_name,company_name,website,personalization,job_title,linkedin_url,signal,score");
  });
  it("needs --reviewed to approve, and the sender stays dry by default", async () => {
    const { runner } = charged();
    await main(["run", "--max-spend", "2", "--out", path.join(dir, "o")], env, out, { looot: runner, fetch: noNet });
    lines.length = 0;
    await main(["leads", "--limit", "1"], env, out, { fetch: noNet });
    const leadId = /(ld_[a-f0-9]+)/.exec(lines.join("\n"))![1];
    lines.length = 0;
    await main(["draft", "--all"], env, out, { fetch: noNet });
    expect(await main(["outbox", "queue", "--ids", leadId], env, out, { fetch: noNet })).toBe(0);
    expect(await main(["outbox", "approve", "--ids", `${leadId}:invite`], env, out, { fetch: noNet })).toBe(2);
    expect(lines.join("\n")).toMatch(/--reviewed/);
    expect(await main(["outbox", "approve", "--reviewed", "--ids", `${leadId}:invite`], env, out, { fetch: noNet })).toBe(0);
    lines.length = 0;
    await main(["outbox", "tick"], env, out, { fetch: noNet });
    expect(lines.join("\n")).toMatch(/Dry run|working-hours|idle/);
    lines.length = 0;
    expect(await main(["outbox", "pause"], env, out, { fetch: noNet })).toBe(0);
    await main(["outbox", "plan"], env, out, { fetch: noNet });
    expect(lines.join("\n")).toMatch(/paused/);
  });
  it("forget erases a person and keeps only a hash; purge honours the retention setting", async () => {
    const { runner } = charged();
    await main(["run", "--max-spend", "2", "--out", path.join(dir, "o")], env, out, { looot: runner, fetch: noNet });
    const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    const lead = Object.values(state.leads)[0] as { linkedinUrl: string };
    lines.length = 0;
    await main(["forget", lead.linkedinUrl], env, out, { fetch: noNet });
    expect(lines.join("\n")).toMatch(/Erased 1 lead/);
    const after = fs.readFileSync(path.join(dir, "state.json"), "utf8");
    expect(after).not.toContain(lead.linkedinUrl);
    expect(JSON.parse(after).sender.suppressed).toHaveLength(1);
    lines.length = 0;
    await main(["purge"], env, out, { fetch: noNet });
    expect(lines.join("\n")).toMatch(/Deleted \d+ leads older than 90 days/);
  });
});
