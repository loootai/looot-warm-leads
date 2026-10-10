import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../engine/config";
import { addDnc, emptyState } from "../engine/state";
import type { Lead, State } from "../engine/types";
import { applyWebhook, approveItems, cancelItems, editItem, inWorkingHours, itemId, markAccepted, planNext, queueLead, recordReply, retryUnknown, sentToday, syncOutbox, textHash, tick } from "./outbox";
import { UnipileError, type SenderClient } from "./unipile";

const cfg = defaultConfig();
cfg.outbox.dryRun = false;
const MON_10 = new Date("2026-10-12T10:00:00Z"); // a Monday, inside the window
const SAT_10 = new Date("2026-10-10T10:00:00Z");
const lead = (id: string, extra: Partial<Lead> = {}): Lead => ({
  id, name: "Ann Example", firstName: "Ann", lastName: "Example", linkedinUrl: `https://www.linkedin.com/in/${id}`, events: [], fit: [], fitPoints: 0, intentPoints: 0, rawIntent: 0, score: 80, band: "hot", breakdown: [], reasons: [], enrichCostMicros: 0, costMicros: 0, enriched: true, firstSeen: "2026-10-01T00:00:00Z", lastSeen: "2026-10-09T00:00:00Z", isNew: false, replies: [],
  drafts: { connectionNote: "Hi Ann, short note.", followUp: "Thanks for connecting.", email: { subject: "s", body: "b" }, by: "template", signalRef: "", warnings: [], edited: false }, ...extra,
});
function setup(ids = ["a"]): State {
  const s = emptyState();
  for (const id of ids) {
    s.leads[id] = lead(id);
    queueLead(s, s.leads[id], cfg);
  }
  return s;
}
const approveAll = (s: State, now = MON_10) => approveItems(s, Object.fromEntries(s.sender.items.map((i) => [i.id, textHash(i.text)])), cfg, now);
function fakeClient(over: Partial<SenderClient> = {}) {
  const c = {
    getProfile: vi.fn(async () => ({ providerId: "ACo_a", networkDistance: "SECOND_DEGREE" })),
    sendInvitation: vi.fn(async () => ({ invitationId: "inv1" })),
    startChat: vi.fn(async () => ({ chatId: "chat1", messageId: "m1" })),
    sendMessage: vi.fn(async () => ({ messageId: "m2" })),
    listMessages: vi.fn(async () => []),
    ...over,
  };
  return c as unknown as SenderClient & typeof c;
}
const live = (s: State, client: SenderClient, now = MON_10, rng = () => 0.5) => tick({ state: s, cfg, now, client, accountId: "acc", live: true, rng });

describe("queue and approval", () => {
  it("queues drafts only, and approves nothing by itself", () => {
    const s = setup();
    expect(s.sender.items.map((i) => [i.step, i.status])).toEqual([["invite", "draft"], ["followup", "draft"]]);
    expect(planNext(s, cfg, MON_10).reason).toBe("No approved items.");
  });
  it("refuses a note over the limit, a lead who replied and a do-not-contact lead", () => {
    const s = emptyState();
    s.leads.long = lead("long", { drafts: { ...lead("x").drafts!, connectionNote: "x".repeat(301) } });
    s.leads.rep = lead("rep", { replies: [{ at: "t", text: "hi" }] });
    s.leads.dnc = lead("dnc");
    addDnc(s, s.leads.dnc.linkedinUrl);
    expect(queueLead(s, s.leads.long, cfg).refused[0].reason).toMatch(/over 300/);
    expect(queueLead(s, s.leads.rep, cfg).refused[0].reason).toMatch(/replied/);
    expect(queueLead(s, s.leads.dnc, cfg).refused[0].reason).toMatch(/do-not-contact/);
    expect(s.sender.items).toHaveLength(0);
  });
  it("refuses to approve text that changed after review, and an edit voids an approval", () => {
    const s = setup();
    const id = itemId("a", "invite");
    const seen = textHash(s.sender.items[0].text);
    editItem(s, id, "Hi Ann, a different note.");
    expect(approveItems(s, { [id]: seen }, cfg, MON_10).refused[0].reason).toMatch(/changed after review/);
    approveItems(s, { [id]: textHash("Hi Ann, a different note.") }, cfg, MON_10);
    expect(s.sender.items[0].status).toBe("approved");
    editItem(s, id, "Edited again.");
    expect(s.sender.items[0].status).toBe("draft");
    expect(planNext(s, cfg, MON_10).item).toBeNull();
  });
  it("does not send an item whose approval hash no longer matches its text", () => {
    const s = setup();
    approveAll(s);
    s.sender.items[0].text = "Tampered text.";
    expect(planNext(s, cfg, MON_10).item).toBeNull();
  });
});

describe("safety rules", () => {
  it("sends nothing outside the working-hours window or while paused", () => {
    const s = setup();
    approveAll(s);
    expect(inWorkingHours(SAT_10, cfg)).toBe(false);
    expect(planNext(s, cfg, SAT_10).reason).toMatch(/working-hours/);
    expect(planNext(s, cfg, new Date("2026-10-12T20:00:00Z")).reason).toMatch(/working-hours/);
    s.sender.paused = true;
    expect(planNext(s, cfg, MON_10).reason).toMatch(/paused/);
  });
  it("applies the daily invitation cap and counts by local day", async () => {
    const small = { ...cfg, outbox: { ...cfg.outbox, dailyInvites: 1, minGapSeconds: 0, maxGapSeconds: 0 } };
    const s = setup(["a", "b"]);
    approveItems(s, Object.fromEntries(s.sender.items.map((i) => [i.id, textHash(i.text)])), small, MON_10);
    const client = fakeClient();
    expect((await tick({ state: s, cfg: small, now: MON_10, client, accountId: "acc", live: true })).action).toBe("sent");
    const second = await tick({ state: s, cfg: small, now: new Date(MON_10.getTime() + 60_000), client, accountId: "acc", live: true });
    expect(second.action).toBe("idle");
    expect(second.reason).toMatch(/daily cap/);
    expect(client.sendInvitation).toHaveBeenCalledTimes(1);
    expect(sentToday(s, "invite", MON_10, small)).toBe(1);
    expect(sentToday(s, "invite", new Date("2026-10-13T10:00:00Z"), small)).toBe(0);
  });
  it("waits a random gap inside the configured range after every send", async () => {
    const s = setup(["a", "b"]);
    approveAll(s);
    const client = fakeClient();
    await live(s, client, MON_10, () => 0);
    expect(Date.parse(s.sender.nextSendAt!) - MON_10.getTime()).toBe(cfg.outbox.minGapSeconds * 1000);
    expect(planNext(s, cfg, new Date(MON_10.getTime() + 60_000)).reason).toMatch(/random gap/);
    const s2 = setup(["a"]);
    approveAll(s2);
    await live(s2, client, MON_10, () => 0.999);
    const gap = (Date.parse(s2.sender.nextSendAt!) - MON_10.getTime()) / 1000;
    expect(gap).toBeGreaterThan(cfg.outbox.maxGapSeconds - 2);
    expect(gap).toBeLessThanOrEqual(cfg.outbox.maxGapSeconds);
  });
  it("does not send to a person added to the do-not-contact list after approval", () => {
    const s = setup();
    approveAll(s);
    addDnc(s, s.leads.a.linkedinUrl);
    expect(planNext(s, cfg, MON_10).item).toBeNull();
    expect(s.sender.items.every((i) => i.status === "cancelled")).toBe(true);
  });
  it("dry run, a config with dryRun true, or no client sends nothing and makes no call", async () => {
    const s = setup();
    approveAll(s);
    const client = fakeClient();
    const a = await tick({ state: s, cfg, now: MON_10, client, accountId: "acc", live: false });
    const b = await tick({ state: s, cfg: { ...cfg, outbox: { ...cfg.outbox, dryRun: true } }, now: MON_10, client, accountId: "acc", live: true });
    const c = await tick({ state: s, cfg, now: MON_10, accountId: "acc", live: true });
    expect([a.action, b.action, c.action]).toEqual(["would_send", "would_send", "would_send"]);
    expect(a.text).toBe("Hi Ann, short note.");
    expect(client.getProfile).not.toHaveBeenCalled();
    expect(client.sendInvitation).not.toHaveBeenCalled();
    expect(s.sender.items[0].status).toBe("approved");
  });
});

describe("idempotent sending", () => {
  it("never sends the same step twice, even if queued and approved again", async () => {
    const s = setup();
    approveAll(s);
    const client = fakeClient();
    await live(s, client);
    expect(s.sender.items[0]).toMatchObject({ status: "sent", invitationId: "inv1", providerId: "ACo_a" });
    expect(queueLead(s, s.leads.a, cfg).refused.map((r) => r.reason).join()).toMatch(/already sent/);
    expect(approveItems(s, { [s.sender.items[0].id]: textHash(s.sender.items[0].text) }, cfg, MON_10).refused[0].reason).toMatch(/Item is sent/);
    await live(s, client, new Date(MON_10.getTime() + 3_600_000));
    expect(client.sendInvitation).toHaveBeenCalledTimes(1);
  });
  it("saves the item as sending before the network call, so a crash cannot lead to a second send", async () => {
    const s = setup();
    approveAll(s);
    let statusDuringCall = "";
    const persisted: string[] = [];
    const client = fakeClient({ sendInvitation: vi.fn(async () => { statusDuringCall = s.sender.items[0].status; throw new Error("process killed"); }) });
    const r = await tick({ state: s, cfg, now: MON_10, client, accountId: "acc", live: true, persist: () => persisted.push(s.sender.items[0].status) });
    expect(statusDuringCall).toBe("sending");
    expect(persisted[0]).toBe("sending");
    expect(r.action).toBe("unknown");
    expect(s.sender.items[0].status).toBe("unknown");
    // An unknown item is not retried by the app.
    expect(planNext(s, cfg, new Date(MON_10.getTime() + 3_600_000)).item).toBeNull();
    await live(s, client, new Date(MON_10.getTime() + 3_600_000));
    expect(client.sendInvitation).toHaveBeenCalledTimes(1);
    expect(retryUnknown(s, s.sender.items[0].id)).toBe(true);
    expect(s.sender.items[0].status).toBe("approved");
  });
  it("puts a rate-limited item back and cools the queue for an hour", async () => {
    const s = setup();
    approveAll(s);
    const client = fakeClient({ sendInvitation: vi.fn(async () => { throw new UnipileError("slow down", 429); }) });
    const r = await live(s, client);
    expect(r.action).toBe("idle");
    expect(s.sender.items[0].status).toBe("approved");
    expect(Date.parse(s.sender.nextSendAt!) - MON_10.getTime()).toBe(3_600_000);
  });
  it("marks a 4xx refusal as failed and keeps the message", async () => {
    const s = setup();
    approveAll(s);
    const client = fakeClient({ sendInvitation: vi.fn(async () => { throw new UnipileError("cannot resend yet", 422, "errors/cannot_resend_yet"); }) });
    const r = await live(s, client);
    expect(r.action).toBe("failed");
    expect(s.sender.items[0]).toMatchObject({ status: "failed" });
    expect(s.sender.items[0].message).toMatch(/422/);
  });
  it("skips the invitation for someone who is already a connection and releases the follow-up", async () => {
    const s = setup();
    approveAll(s);
    const client = fakeClient({ getProfile: vi.fn(async () => ({ providerId: "ACo_a", networkDistance: "FIRST_DEGREE" })) });
    const r = await live(s, client);
    expect(r.action).toBe("skipped");
    expect(client.sendInvitation).not.toHaveBeenCalled();
    expect(s.sender.items[1].notBefore).toBe(MON_10.toISOString());
  });
});

describe("sequence: acceptance, follow-up, replies", () => {
  async function sentInvite() {
    const s = setup();
    approveAll(s);
    const client = fakeClient();
    await live(s, client, MON_10, () => 0);
    return { s, client };
  }
  it("holds the follow-up until the invitation is accepted, then waits the configured delay", async () => {
    const { s, client } = await sentInvite();
    const later = new Date(MON_10.getTime() + 5 * 3_600_000);
    expect(planNext(s, cfg, later).item).toBeNull();
    expect(markAccepted(s, "a", cfg, later, () => 0)).toBe(true);
    expect(Date.parse(s.sender.items[1].notBefore!) - later.getTime()).toBe(cfg.outbox.followUpDelayHours * 3_600_000);
    const tooEarly = new Date(later.getTime() + 3_600_000);
    expect(planNext(s, cfg, tooEarly).item).toBeNull();
    const ready = new Date("2026-10-14T10:00:00Z");
    const r = await live(s, client, ready, () => 0);
    expect(r.action).toBe("sent");
    expect(client.startChat).toHaveBeenCalledWith({ accountId: "acc", providerId: "ACo_a", text: "Thanks for connecting." });
    expect(s.sender.items[1]).toMatchObject({ status: "sent", chatId: "chat1" });
  });
  it("stops the sequence when the lead replies: pending steps are cancelled and nothing more sends", async () => {
    const { s, client } = await sentInvite();
    markAccepted(s, "a", cfg, MON_10, () => 0);
    expect(recordReply(s, "a", { at: "2026-10-12T12:00:00Z", text: "Not now, thanks", chatId: "chat1", messageId: "r1" })).toBe(true);
    expect(s.sender.items[1]).toMatchObject({ status: "cancelled", message: expect.stringMatching(/replied/) });
    expect(planNext(s, cfg, new Date("2026-10-14T10:00:00Z")).item).toBeNull();
    expect(client.startChat).not.toHaveBeenCalled();
    expect(recordReply(s, "a", { at: "x", text: "again", messageId: "r1" })).toBe(false);
    expect(s.leads.a.replies).toHaveLength(1);
  });
  it("a reply that arrives while a follow-up is approved still blocks it at send time", () => {
    const { s } = { s: setup() };
    approveAll(s);
    s.sender.items[1].notBefore = MON_10.toISOString();
    s.sender.items[0].status = "sent";
    s.leads.a.replies.push({ at: "t", text: "hi" });
    expect(planNext(s, cfg, MON_10).item).toBeNull();
  });
  it("handles webhooks: replies from the lead count, our own messages do not, new_relation releases the follow-up", async () => {
    const { s } = await sentInvite();
    expect(applyWebhook(s, { event: "message_received", account_info: { user_id: "me" }, sender: { attendee_provider_id: "me" }, message: "mine" }, cfg, MON_10).handled).toMatch(/own message/);
    expect(applyWebhook(s, { event: "new_relation", user_provider_id: "ACo_a", user_public_identifier: "a" }, cfg, MON_10, () => 0).handled).toMatch(/accepted/);
    expect(s.sender.items[1].notBefore).toBeTruthy();
    const r = applyWebhook(s, { event: "message_received", account_info: { user_id: "me" }, chat_id: "c9", message_id: "w1", message: "Interested", sender: { attendee_provider_id: "ACo_a" } }, cfg, MON_10);
    expect(r.handled).toMatch(/reply recorded/);
    expect(s.leads.a.replies[0].text).toBe("Interested");
    expect(applyWebhook(s, { status: "CREATION_SUCCESS", account_id: "acc9" }, cfg, MON_10).handled).toBe("account connected");
    expect(s.sender.accountId).toBe("acc9");
  });
  it("sync reads replies from chats we started and checks acceptance within the daily limit", async () => {
    const s = setup(["a", "b"]);
    approveAll(s);
    const client = fakeClient();
    await live(s, client, MON_10, () => 0);
    await live(s, client, new Date(MON_10.getTime() + 600_000), () => 0);
    s.sender.items.find((i) => i.id === itemId("a", "followup"))!.status = "sent";
    Object.assign(s.sender.items.find((i) => i.id === itemId("a", "followup"))!, { chatId: "chat1", sentAt: "2026-10-12T09:00:00Z" });
    (client.listMessages as ReturnType<typeof vi.fn>).mockResolvedValue([{ messageId: "m5", text: "Hello back", isSender: false, timestamp: "2026-10-12T11:00:00Z" }, { messageId: "m6", text: "mine", isSender: true, timestamp: "2026-10-12T11:01:00Z" }]);
    (client.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({ providerId: "ACo_a", networkDistance: "FIRST_DEGREE" });
    const small = { ...cfg, outbox: { ...cfg.outbox, dailyProfileChecks: 1 } };
    const r = await syncOutbox({ state: s, cfg: small, client, accountId: "acc", now: new Date("2026-10-12T12:00:00Z") });
    expect(r.replies).toBe(1);
    expect(r.checks).toBe(1);
    expect(s.leads.a.replies[0].text).toBe("Hello back");
    const again = await syncOutbox({ state: s, cfg: small, client, accountId: "acc", now: new Date("2026-10-12T13:00:00Z") });
    expect(again.checks).toBe(0);
  });
  it("cancel only touches items that have not gone out", async () => {
    const { s } = await sentInvite();
    expect(cancelItems(s, s.sender.items.map((i) => i.id))).toBe(1);
    expect(s.sender.items[0].status).toBe("sent");
  });
});
