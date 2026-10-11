import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as action } from "@/app/api/action/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as webhook } from "@/app/api/unipile/webhook/route";
import { resetLimits } from "@/lib/auth/limits";
import { CSRF_HEADER, csrfToken, verifySession } from "@/lib/auth/session";
import { webhookAuthorized } from "@/lib/auth/webhook";
import { defaultConfig, type WarmConfig } from "../engine/config";
import { emptyState } from "../engine/state";
import type { Lead, State } from "../engine/types";
import { approveItems, queueLead, textHash } from "../sender/outbox";
import type { SenderClient } from "../sender/unipile";
import { dispatch, SPEND_ACTIONS_PER_WINDOW } from "./actions";
import { LIVE_NEEDS_PASSWORD, makeCtx, sendReviewed, setLiveSend, type Ctx } from "./service";

const PW = "test-password-123456";
const MON_10 = new Date("2026-10-12T10:00:00Z");
const lead = (id: string): Lead => ({
  id, name: "Ann Example", firstName: "Ann", lastName: "Example", linkedinUrl: `https://www.linkedin.com/in/${id}`, events: [], fit: [], fitPoints: 0, intentPoints: 0, rawIntent: 0, score: 80, band: "hot", breakdown: [], reasons: [], enrichCostMicros: 0, costMicros: 0, enriched: true, firstSeen: "2026-10-01T00:00:00Z", lastSeen: "2026-10-09T00:00:00Z", isNew: false, replies: [],
  drafts: { connectionNote: "Hi Ann, short note.", followUp: "Thanks for connecting.", email: { subject: "s", body: "b" }, by: "template", signalRef: "", warnings: [], edited: false },
});

function fakeClient() {
  const c = {
    getProfile: vi.fn(async () => ({ providerId: "ACo_a", networkDistance: "SECOND_DEGREE" })),
    sendInvitation: vi.fn(async () => ({ invitationId: "inv1" })),
    startChat: vi.fn(async () => ({ chatId: "chat1", messageId: "m1" })),
    sendMessage: vi.fn(async () => ({ messageId: "m2" })),
    listMessages: vi.fn(async () => []),
  };
  return c as unknown as SenderClient & typeof c;
}

/** An in-memory context with one approved invitation, live sending configured, and a fake LinkedIn client. */
function liveCtx(env: Record<string, string | undefined>) {
  const cfg: WarmConfig = defaultConfig();
  cfg.outbox.dryRun = false;
  let state: State = emptyState();
  state.leads.a = lead("a");
  queueLead(state, state.leads.a, cfg);
  approveItems(state, Object.fromEntries(state.sender.items.map((i) => [i.id, textHash(i.text)])), cfg, MON_10);
  const client = fakeClient();
  let config = cfg;
  const ctx: Ctx = { demo: false, env: { UNIPILE_ACCOUNT_ID: "acc", ...env }, now: () => MON_10, getConfig: () => config, setConfig: (c) => void (config = c), read: () => state, write: (s) => void (state = s), sender: client, fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch };
  return { ctx, client, state: () => state, config: () => config };
}

describe("a live send needs the item and the text the admin reviewed", () => {
  const item = (s: State) => s.sender.items.find((i) => i.step === "invite")!;

  it("sends when the id and hash match the approved text", async () => {
    const t = liveCtx({ WARM_ADMIN_PASSWORD: PW });
    const it0 = item(t.state());
    const r = await dispatch(t.ctx, { action: "tick", live: true, itemId: it0.id, hash: textHash(it0.text) }, { sid: "abcdef123" });
    expect((r as { action: string }).action).toBe("sent");
    expect(t.client.sendInvitation).toHaveBeenCalledTimes(1);
  });
  it("refuses a live tick that names no item or hash, and sends nothing", async () => {
    const t = liveCtx({ WARM_ADMIN_PASSWORD: PW });
    await expect(dispatch(t.ctx, { action: "tick", live: true }, { sid: "s" })).rejects.toThrow(/item id and the text hash/);
    expect(t.client.sendInvitation).not.toHaveBeenCalled();
  });
  it("refuses a hash that is not the approved text, and an item that is not next", async () => {
    const t = liveCtx({ WARM_ADMIN_PASSWORD: PW });
    const it0 = item(t.state());
    const wrong = await sendReviewed(t.ctx, { itemId: it0.id, hash: "0000000000000000", actor: "admin" });
    expect(wrong.action).toBe("skipped");
    expect(wrong.reason).toMatch(/changed after review/);
    const other = await sendReviewed(t.ctx, { itemId: "a:followup", hash: textHash(it0.text), actor: "admin" });
    expect(other.reason).toMatch(/not the one you reviewed/);
    expect(t.client.sendInvitation).not.toHaveBeenCalled();
  });
  it("refuses an item whose text was edited after approval", async () => {
    const t = liveCtx({ WARM_ADMIN_PASSWORD: PW });
    const it0 = item(t.state());
    const seen = textHash(it0.text);
    it0.text = "Hi Ann, a different note.";
    const r = await sendReviewed(t.ctx, { itemId: it0.id, hash: seen, actor: "admin" });
    expect(r.action).toBe("skipped");
    expect(t.client.sendInvitation).not.toHaveBeenCalled();
  });
  it("sends nothing with no admin password, even when the config says live", async () => {
    const t = liveCtx({});
    const it0 = item(t.state());
    const r = await sendReviewed(t.ctx, { itemId: it0.id, hash: textHash(it0.text), actor: "admin" });
    expect(r.action).toBe("skipped");
    expect(r.reason).toBe(LIVE_NEEDS_PASSWORD);
    expect(t.client.sendInvitation).not.toHaveBeenCalled();
    expect(t.state().audit?.at(-1)?.action).toBe("live_send_refused");
  });
  it("records each live send in the audit log", async () => {
    const t = liveCtx({ WARM_ADMIN_PASSWORD: PW });
    const it0 = item(t.state());
    await sendReviewed(t.ctx, { itemId: it0.id, hash: textHash(it0.text), actor: "admin abcdef" });
    expect(t.state().audit?.at(-1)).toMatchObject({ action: "live_tick", actor: "admin abcdef" });
  });
});

describe("the live-send switch", () => {
  it("cannot be turned on with no admin password", () => {
    const t = liveCtx({});
    t.config().outbox.dryRun = true;
    expect(() => setLiveSend(t.ctx, true, "admin")).toThrow(LIVE_NEEDS_PASSWORD);
    expect(t.config().outbox.dryRun).toBe(true);
  });
  it("turns on and off with a password, and writes an audit entry each time", () => {
    const t = liveCtx({ WARM_ADMIN_PASSWORD: PW });
    expect(setLiveSend(t.ctx, false, "admin abc")).toEqual({ dryRun: true });
    expect(setLiveSend(t.ctx, true, "admin abc")).toEqual({ dryRun: false });
    expect(t.state().audit?.map((a) => a.action)).toEqual(["live_send_off", "live_send_on"]);
    expect(t.state().audit?.[0].actor).toBe("admin abc");
  });
  it("is not changed by the saveConfig action", async () => {
    const t = liveCtx({ WARM_ADMIN_PASSWORD: PW });
    const next = { ...t.config(), outbox: { ...t.config().outbox, dryRun: true } };
    await expect(dispatch(t.ctx, { action: "saveConfig", config: next }, { sid: "s" })).rejects.toThrow(/live-send switch/);
    expect(t.config().outbox.dryRun).toBe(false);
  });
});

describe("a config file with dryRun false and no admin password", () => {
  it("reads as dry run, and refuses to be saved as live", async () => {
    mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), ".vitest", "live-"));
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ outbox: { dryRun: false } }));
    const noAuth = await makeCtx({ WARM_DIR: dir, WARM_CONFIG: file });
    expect(noAuth.getConfig().outbox.dryRun).toBe(true);
    expect(() => noAuth.setConfig({ ...noAuth.getConfig(), outbox: { ...noAuth.getConfig().outbox, dryRun: false } })).toThrow(LIVE_NEEDS_PASSWORD);
    const withAuth = await makeCtx({ WARM_DIR: dir, WARM_CONFIG: file, WARM_ADMIN_PASSWORD: PW });
    expect(withAuth.getConfig().outbox.dryRun).toBe(false);
    const short = await makeCtx({ WARM_DIR: dir, WARM_CONFIG: file, WARM_ADMIN_PASSWORD: "short" });
    expect(short.getConfig().outbox.dryRun).toBe(true);
  });
});

describe("spend caps come from the config", () => {
  it("a capUsd in the request body changes nothing", async () => {
    const t = liveCtx({ WARM_ADMIN_PASSWORD: PW });
    t.config().sources.keywords = ["growth"];
    t.config().spend.runCapUsd = 0.01;
    // The quote is above the config cap of $0.01, so the run refuses. A body cap of $5000 would have let it through.
    await expect(dispatch(t.ctx, { action: "run", capUsd: 5000 }, { sid: "cap" })).rejects.toThrow(/above the cap \(\$0\.01\)/);
  });
  it("limits paid actions per session", async () => {
    resetLimits();
    const t = liveCtx({ WARM_ADMIN_PASSWORD: PW });
    for (let i = 0; i < SPEND_ACTIONS_PER_WINDOW; i++) {
      await dispatch(t.ctx, { action: "emailRun", ids: [] }, { sid: "same" }).catch(() => undefined);
    }
    await expect(dispatch(t.ctx, { action: "emailRun", ids: [] }, { sid: "same" })).rejects.toThrow(/Too many paid runs/);
    await expect(dispatch(t.ctx, { action: "run" }, { sid: "same" })).rejects.toThrow(/Too many paid runs/);
    // another session has its own allowance: it gets past the limiter and fails later, on the missing token
    await expect(dispatch(t.ctx, { action: "emailRun", ids: [] }, { sid: "other" })).rejects.toThrow(/LOOOT_TOKEN/);
  });
});

describe("the Unipile webhook secret", () => {
  it("compares in constant time and rejects empty values", () => {
    expect(webhookAuthorized("abc", "abc")).toBe(true);
    expect(webhookAuthorized("abc", "abd")).toBe(false);
    expect(webhookAuthorized("abc", "abcd")).toBe(false);
    expect(webhookAuthorized("", "")).toBe(false);
    expect(webhookAuthorized(undefined, "x")).toBe(false);
    expect(webhookAuthorized("abc", null)).toBe(false);
  });
  it("rejects an unsigned or wrongly signed call and changes no state", async () => {
    mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), ".vitest", "hook-"));
    process.env.WARM_DIR = dir;
    process.env.UNIPILE_WEBHOOK_SECRET = "hook-secret-123456";
    const call = (h: Record<string, string>) => webhook(new Request("http://localhost/api/unipile/webhook", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ event: "new_message" }) }));
    expect((await call({})).status).toBe(401);
    expect((await call({ "unipile-auth": "hook-secret-123457" })).status).toBe(401);
    expect((await call({ "unipile-auth": "hook-secret-123456" })).status).toBe(200);
    delete process.env.UNIPILE_WEBHOOK_SECRET;
  });
});

describe("over HTTP: the route needs session, token and the reviewed hash", () => {
  beforeEach(() => {
    mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), ".vitest", "http-"));
    process.env.WARM_DIR = dir;
    process.env.WARM_CONFIG = join(dir, "config.json");
    process.env.WARM_ADMIN_PASSWORD = PW;
    delete process.env.WARM_DEMO;
    resetLimits();
  });
  const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.9" };
  const post = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost:3000/api/action", { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify(body) });

  it("a live tick without a session is 401, without the token is 403, without a hash is 400", async () => {
    expect((await action(post({ action: "tick", live: true }))).status).toBe(401);
    const l = await login(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ password: PW }) }));
    const cookie = /warm_session=[^;]+/.exec(l.headers.get("set-cookie") ?? "")![0];
    const s = (await verifySession(process.env, cookie.split("=")[1]))!;
    expect((await action(post({ action: "tick", live: true }, { cookie }))).status).toBe(403);
    const withToken = await action(post({ action: "tick", live: true }, { cookie, [CSRF_HEADER]: await csrfToken(process.env, s.sid) }));
    expect(withToken.status).toBe(400);
    expect(((await withToken.json()) as { error: string }).error).toMatch(/item id and the text hash/);
  });
});
