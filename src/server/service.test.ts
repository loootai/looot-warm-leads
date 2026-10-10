import { afterEach, describe, expect, it } from "vitest";
import { addDnc, contactHash, emptyState, forget, isLeadDnc, purge } from "../engine/state";
import type { Lead } from "../engine/types";
import { POST as webhook } from "../app/api/unipile/webhook/route";
import { dispatch } from "./actions";
import { makeCtx } from "./service";

const lead = (id: string, lastSeen: string): Lead => ({ id, name: "A B", firstName: "A", lastName: "B", linkedinUrl: `https://www.linkedin.com/in/${id}`, companyDomain: "x.example", events: [], fit: [], fitPoints: 0, intentPoints: 0, rawIntent: 0, score: 50, band: "warm", breakdown: [], reasons: [], enrichCostMicros: 0, costMicros: 0, enriched: true, firstSeen: lastSeen, lastSeen, isNew: false, replies: [], email: { address: "a@example.com", status: "ok", deliverable: true, findProvider: "p", verifyProvider: "v", costMicros: 0, at: lastSeen } });

describe("privacy", () => {
  it("matches the do-not-contact list by LinkedIn URL, email or domain, and stores only hashes", () => {
    const s = emptyState();
    addDnc(s, "A@example.com");
    addDnc(s, "blocked.example");
    expect(s.sender.dnc.join()).not.toMatch(/x\.example|blocked/);
    expect(isLeadDnc(s, "https://www.linkedin.com/in/q", "a@example.com")).toBe(true);
    expect(isLeadDnc(s, "https://www.linkedin.com/in/q", undefined, "blocked.example")).toBe(true);
    expect(isLeadDnc(s, "https://www.linkedin.com/in/q", "other@example.org")).toBe(false);
    expect(contactHash("https://uk.linkedin.com/in/Q/?x=1")).toBe(contactHash("https://www.linkedin.com/in/q"));
  });
  it("forget removes the lead and outbox items and suppresses the hash, also by email", () => {
    const s = emptyState();
    s.leads.a = lead("a", "2026-10-01T00:00:00Z");
    s.sender.items.push({ id: "a:invite", leadId: "a", step: "invite", text: "t", status: "draft" });
    expect(forget(s, "a@example.com")).toBe(1);
    expect(s.leads.a).toBeUndefined();
    expect(s.sender.items).toHaveLength(0);
    expect(s.sender.suppressed).toHaveLength(1);
  });
  it("purge deletes old leads, and keeps a hash for those already contacted so they are not messaged twice", () => {
    const s = emptyState();
    s.leads.old = lead("old", "2026-01-01T00:00:00Z");
    s.leads.sent = lead("sent", "2026-01-01T00:00:00Z");
    s.leads.fresh = lead("fresh", "2026-10-09T00:00:00Z");
    s.sender.items.push({ id: "sent:invite", leadId: "sent", step: "invite", text: "t", status: "sent" });
    expect(purge(s, 90, new Date("2026-10-10T00:00:00Z"))).toBe(2);
    expect(Object.keys(s.leads)).toEqual(["fresh"]);
    expect(s.sender.suppressed).toEqual([contactHash("https://www.linkedin.com/in/sent")]);
    expect(s.sender.items).toHaveLength(0);
  });
});

describe("webhook route", () => {
  const OLD = process.env.UNIPILE_WEBHOOK_SECRET;
  afterEach(() => { process.env.UNIPILE_WEBHOOK_SECRET = OLD; });
  const req = (headers: Record<string, string>) => new Request("http://x/api/unipile/webhook", { method: "POST", headers, body: JSON.stringify({ event: "ignored" }) });
  it("rejects a request without the secret, and when no secret is set", async () => {
    delete process.env.UNIPILE_WEBHOOK_SECRET;
    expect((await webhook(req({ "unipile-auth": "x" }))).status).toBe(401);
    process.env.UNIPILE_WEBHOOK_SECRET = "s3";
    expect((await webhook(req({}))).status).toBe(401);
    expect((await webhook(req({ "unipile-auth": "wrong" }))).status).toBe(401);
  });
});

describe("demo context", () => {
  it("serves a seeded demo with no network, and the connect action sends nothing", async () => {
    const ctx = await makeCtx({ WARM_DEMO: "1" });
    expect(ctx.demo).toBe(true);
    expect(Object.keys(ctx.read().leads).length).toBeGreaterThan(10);
    expect(await dispatch(ctx, { action: "connect" })).toMatchObject({ url: null });
    const q = (await dispatch(ctx, { action: "quote" })) as { totalMicros: number };
    expect(q.totalMicros).toBeGreaterThan(0);
  });
  it("rejects an unknown action and a config with a missing signal weight", async () => {
    const ctx = await makeCtx({ WARM_DEMO: "1" });
    await expect(dispatch(ctx, { action: "nope" })).rejects.toThrow(/Unknown action/);
    const cfg = JSON.parse(JSON.stringify(ctx.getConfig()));
    delete cfg.scoring.signals.hiring;
    await expect(dispatch(ctx, { action: "saveConfig", config: cfg })).rejects.toThrow(/hiring/);
  });
});
