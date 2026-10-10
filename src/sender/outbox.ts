import type { WarmConfig } from "../engine/config";
import { normalizeProfileUrl } from "../engine/parse";
import { shortHash } from "../engine/run";
import { isLeadDnc } from "../engine/state";
import type { Lead, OutboxItem, Reply, State } from "../engine/types";
import { UnipileError, type SenderClient } from "./unipile";

/** Hash of the text a person reviewed. An approval is valid only while the text still hashes to the same value. */
export function textHash(text: string): string {
  return shortHash(text.trim(), 16);
}

export const itemId = (leadId: string, step: OutboxItem["step"]) => `${leadId}:${step}`;

// ---- clock helpers: working hours and daily counts use a fixed UTC offset from the config ----

function local(now: Date, offsetMin: number): Date {
  return new Date(now.getTime() + offsetMin * 60_000);
}

export function localDay(now: Date, offsetMin: number): string {
  return local(now, offsetMin).toISOString().slice(0, 10);
}

/** true inside the working-hours window: allowed days and start hour (inclusive) to end hour (exclusive). */
export function inWorkingHours(now: Date, cfg: WarmConfig): boolean {
  const wh = cfg.outbox.workingHours;
  const l = local(now, wh.utcOffsetMinutes);
  return wh.days.includes(l.getUTCDay()) && l.getUTCHours() >= wh.start && l.getUTCHours() < wh.end;
}

export function sentToday(state: State, step: OutboxItem["step"], now: Date, cfg: WarmConfig): number {
  const day = localDay(now, cfg.outbox.workingHours.utcOffsetMinutes);
  return state.sender.sentLog.filter((s) => s.step === step && localDay(new Date(s.at), cfg.outbox.workingHours.utcOffsetMinutes) === day).length;
}

export function checksToday(state: State, now: Date, cfg: WarmConfig): number {
  const day = localDay(now, cfg.outbox.workingHours.utcOffsetMinutes);
  return state.sender.checkLog.filter((c) => localDay(new Date(c), cfg.outbox.workingHours.utcOffsetMinutes) === day).length;
}

// ---- queue management ----

export interface QueueResult {
  queued: string[];
  refused: { leadId: string; reason: string }[];
}

/**
 * Puts a lead's invitation and follow-up in the outbox as drafts. Nothing is approved and nothing sends.
 * Refuses a lead on the do-not-contact list, with a note over the limit, or already sent (a second queue never makes a second send).
 */
export function queueLead(state: State, lead: Lead, cfg: WarmConfig): QueueResult {
  const res: QueueResult = { queued: [], refused: [] };
  const refuse = (reason: string) => res.refused.push({ leadId: lead.id, reason });
  if (!lead.drafts) return refuse("No draft yet."), res;
  if (isLeadDnc(state, lead.linkedinUrl, lead.email?.address ?? undefined, lead.companyDomain)) return refuse("On the do-not-contact list."), res;
  if (lead.replies.length > 0) return refuse("The lead already replied."), res;
  if (lead.drafts.connectionNote.length > cfg.messages.noteMax) return refuse(`The connection note is over ${cfg.messages.noteMax} characters.`), res;
  const steps: [OutboxItem["step"], string][] = [["invite", lead.drafts.connectionNote], ["followup", lead.drafts.followUp]];
  for (const [step, text] of steps) {
    const id = itemId(lead.id, step);
    const existing = state.sender.items.find((i) => i.id === id);
    if (existing && ["sent", "sending", "unknown"].includes(existing.status)) {
      refuse(`The ${step} is already ${existing.status}.`);
      continue;
    }
    if (existing) {
      existing.text = text;
      existing.status = "draft";
      existing.approvedHash = undefined;
      existing.approvedAt = undefined;
      existing.message = undefined;
    } else {
      state.sender.items.push({ id, leadId: lead.id, step, text, status: "draft" });
    }
    res.queued.push(id);
  }
  return res;
}

/** Edits the text of a queued item. An approval does not survive an edit. */
export function editItem(state: State, id: string, text: string): boolean {
  const item = state.sender.items.find((i) => i.id === id);
  if (!item || ["sent", "sending", "unknown"].includes(item.status)) return false;
  item.text = text;
  if (item.status === "approved") {
    item.status = "draft";
    item.approvedHash = undefined;
    item.approvedAt = undefined;
  }
  return true;
}

export interface ApproveResult {
  approved: string[];
  refused: { id: string; reason: string }[];
}

/**
 * Approves items the user reviewed. `reviewed` maps item id to the hash of the text that was on screen.
 * An id whose current text differs from what was reviewed is refused, so a batch approval can never cover text nobody read.
 */
export function approveItems(state: State, reviewed: Record<string, string>, cfg: WarmConfig, now: Date): ApproveResult {
  const res: ApproveResult = { approved: [], refused: [] };
  for (const [id, hash] of Object.entries(reviewed)) {
    const item = state.sender.items.find((i) => i.id === id);
    if (!item) { res.refused.push({ id, reason: "Not in the outbox." }); continue; }
    if (item.status !== "draft" && item.status !== "approved") { res.refused.push({ id, reason: `Item is ${item.status}.` }); continue; }
    if (textHash(item.text) !== hash) { res.refused.push({ id, reason: "The text changed after review." }); continue; }
    if (item.step === "invite" && item.text.length > cfg.messages.noteMax) { res.refused.push({ id, reason: `Over ${cfg.messages.noteMax} characters.` }); continue; }
    const lead = state.leads[item.leadId];
    if (lead && isLeadDnc(state, lead.linkedinUrl, lead.email?.address ?? undefined, lead.companyDomain)) { res.refused.push({ id, reason: "On the do-not-contact list." }); continue; }
    item.status = "approved";
    item.approvedHash = hash;
    item.approvedAt = now.toISOString();
    res.approved.push(id);
  }
  return res;
}

export function cancelItems(state: State, ids: string[], why = "Cancelled by the user."): number {
  let n = 0;
  for (const item of state.sender.items) {
    if (ids.includes(item.id) && ["draft", "approved", "failed"].includes(item.status)) {
      item.status = "cancelled";
      item.message = why;
      n += 1;
    }
  }
  return n;
}

export function setPaused(state: State, paused: boolean): void {
  state.sender.paused = paused;
}

// ---- planning and sending ----

export interface Plan {
  /** What would send next, or null. */
  item: OutboxItem | null;
  /** Why nothing sends now, in plain words. Empty when something does. */
  reason: string;
  /** Earliest time the next send may happen, when known. */
  waitUntil?: string;
}

const eligible = (state: State, item: OutboxItem): { ok: boolean; why?: string } => {
  const lead = state.leads[item.leadId];
  if (!lead) return { ok: false, why: "Lead was erased." };
  if (isLeadDnc(state, lead.linkedinUrl, lead.email?.address ?? undefined, lead.companyDomain)) return { ok: false, why: "On the do-not-contact list." };
  if (lead.replies.length > 0) return { ok: false, why: "The lead replied." };
  if (item.approvedHash !== textHash(item.text)) return { ok: false, why: "Approval does not match the text." };
  return { ok: true };
};

/** The next item that may send now, or the reason none does. Pure: it changes nothing. */
export function planNext(state: State, cfg: WarmConfig, now: Date): Plan {
  const s = state.sender;
  if (s.paused) return { item: null, reason: "The outbox is paused." };
  if (!inWorkingHours(now, cfg)) return { item: null, reason: "Outside the working-hours window." };
  if (s.nextSendAt && Date.parse(s.nextSendAt) > now.getTime()) return { item: null, reason: "Waiting out the random gap between sends.", waitUntil: s.nextSendAt };
  const approved = s.items.filter((i) => i.status === "approved").sort((a, b) => (a.approvedAt ?? "").localeCompare(b.approvedAt ?? ""));
  if (approved.length === 0) return { item: null, reason: "No approved items." };
  let capped = false;
  for (const item of approved) {
    if (!eligible(state, item).ok) continue;
    if (item.step === "followup" && (!item.notBefore || Date.parse(item.notBefore) > now.getTime())) continue;
    if (item.step === "invite" && sentToday(state, "invite", now, cfg) >= cfg.outbox.dailyInvites) { capped = true; continue; }
    if (item.step === "followup" && sentToday(state, "followup", now, cfg) >= cfg.outbox.dailyMessages) { capped = true; continue; }
    return { item, reason: "" };
  }
  return { item: null, reason: capped ? "The daily cap is reached for the approved items." : "Approved items are waiting (follow-ups wait for acceptance) or are blocked." };
}

export interface TickResult {
  action: "sent" | "would_send" | "idle" | "failed" | "unknown" | "skipped";
  itemId?: string;
  text?: string;
  reason: string;
}

export interface TickOptions {
  state: State;
  cfg: WarmConfig;
  now: Date;
  /** Random number in [0, 1). Injected so tests are deterministic. */
  rng?: () => number;
  /** Writes the state to disk. Called before every network call so a crash cannot lead to a second send. */
  persist?: () => void;
  client?: SenderClient;
  accountId?: string;
  /** false sends nothing and reports what would go. The default. */
  live: boolean;
}

function gapMs(cfg: WarmConfig, rng: () => number): number {
  const { minGapSeconds: a, maxGapSeconds: b } = cfg.outbox;
  return (a + rng() * Math.max(0, b - a)) * 1000;
}

/**
 * Processes at most one send. In dry-run (or without a client) it only reports what would go.
 * Live: the item is marked "sending" and saved before the call. A definite refusal ends as "failed"; a rate limit (HTTP 429)
 * puts the item back and cools the whole queue; an answer we cannot be sure about (network error, 5xx) ends as "unknown"
 * and is never retried by the app, because the message may have gone out.
 */
export async function tick(o: TickOptions): Promise<TickResult> {
  const { state, cfg, now } = o;
  const rng = o.rng ?? Math.random;
  const plan = planNext(state, cfg, now);
  if (!plan.item) return { action: "idle", reason: plan.reason };
  const item = plan.item;
  if (!o.live || cfg.outbox.dryRun || !o.client || !o.accountId) {
    const why = !o.live ? "Dry run." : cfg.outbox.dryRun ? "outbox.dryRun is true in the config." : "No Unipile account connected.";
    return { action: "would_send", itemId: item.id, text: item.text, reason: `${why} Would send the ${item.step}.` };
  }
  const lead = state.leads[item.leadId];
  const client = o.client;
  item.status = "sending";
  item.message = undefined;
  o.persist?.();
  try {
    if (!item.providerId) {
      const slug = /linkedin\.com\/in\/([^/?#]+)/i.exec(lead.linkedinUrl)?.[1] ?? lead.linkedinUrl;
      const profile = await client.getProfile(o.accountId, slug);
      item.providerId = profile.providerId;
      if (item.step === "invite" && profile.networkDistance === "FIRST_DEGREE") {
        item.status = "skipped";
        item.message = "Already a connection. The follow-up can go out.";
        const fu = state.sender.items.find((i) => i.id === itemId(item.leadId, "followup"));
        if (fu && !fu.notBefore) fu.notBefore = now.toISOString();
        o.persist?.();
        return { action: "skipped", itemId: item.id, reason: item.message };
      }
      o.persist?.();
    }
    if (item.step === "invite") {
      const r = await client.sendInvitation({ accountId: o.accountId, providerId: item.providerId, message: item.text });
      item.invitationId = r.invitationId;
    } else {
      const r = await client.startChat({ accountId: o.accountId, providerId: item.providerId, text: item.text });
      item.chatId = r.chatId ?? undefined;
    }
    item.status = "sent";
    item.sentAt = now.toISOString();
    state.sender.sentLog.push({ at: item.sentAt, step: item.step });
    state.sender.nextSendAt = new Date(now.getTime() + gapMs(cfg, rng)).toISOString();
    o.persist?.();
    return { action: "sent", itemId: item.id, reason: `Sent the ${item.step}.` };
  } catch (e) {
    const err = e instanceof UnipileError ? e : null;
    if (err && err.status === 429) {
      item.status = "approved";
      item.message = "Rate limited by LinkedIn through Unipile. Waiting an hour.";
      state.sender.nextSendAt = new Date(now.getTime() + 3_600_000).toISOString();
      o.persist?.();
      return { action: "idle", itemId: item.id, reason: item.message };
    }
    if (err && err.status >= 400 && err.status < 500) {
      item.status = "failed";
      item.message = `${err.status}${err.type ? ` ${err.type}` : ""}: ${err.message}`;
      o.persist?.();
      return { action: "failed", itemId: item.id, reason: item.message };
    }
    item.status = "unknown";
    item.message = `Not sure whether it went out (${(e as Error).message}). Check LinkedIn, then mark it sent or retry by hand.`;
    o.persist?.();
    return { action: "unknown", itemId: item.id, reason: item.message };
  }
}

/** Puts an "unknown" item back to approved after the user checked LinkedIn and saw nothing went out. */
export function retryUnknown(state: State, id: string): boolean {
  const item = state.sender.items.find((i) => i.id === id);
  if (!item || item.status !== "unknown") return false;
  item.status = "approved";
  item.message = "Retried by hand after checking LinkedIn.";
  return true;
}

/** Marks an "unknown" item as sent after the user saw it on LinkedIn. */
export function confirmSent(state: State, id: string, now: Date): boolean {
  const item = state.sender.items.find((i) => i.id === id);
  if (!item || item.status !== "unknown") return false;
  item.status = "sent";
  item.sentAt = now.toISOString();
  state.sender.sentLog.push({ at: item.sentAt, step: item.step });
  return true;
}

// ---- acceptance and replies ----

/** The invitation was accepted: the follow-up may go out after the delay, with up to two hours of jitter. */
export function markAccepted(state: State, leadId: string, cfg: WarmConfig, now: Date, rng: () => number = Math.random): boolean {
  const fu = state.sender.items.find((i) => i.id === itemId(leadId, "followup"));
  if (!fu || fu.notBefore) return false;
  fu.notBefore = new Date(now.getTime() + cfg.outbox.followUpDelayHours * 3_600_000 + rng() * 2 * 3_600_000).toISOString();
  return true;
}

/**
 * A reply arrived. It is stored on the lead and every pending step for that lead is cancelled (the sequence stops).
 * Returns false when the same message was already recorded.
 */
export function recordReply(state: State, leadId: string, reply: Reply): boolean {
  const lead = state.leads[leadId];
  if (!lead) return false;
  if (reply.messageId && lead.replies.some((r) => r.messageId === reply.messageId)) return false;
  lead.replies.push({ ...reply, text: reply.text.slice(0, 2000) });
  for (const item of state.sender.items) {
    if (item.leadId === leadId && ["draft", "approved"].includes(item.status)) {
      item.status = "cancelled";
      item.message = "The lead replied. Sequence stopped.";
    }
  }
  return true;
}

/** The lead a Unipile event belongs to: by provider id on a sent item, by chat id, or by LinkedIn profile URL. */
export function findLeadForEvent(state: State, e: { providerId?: string; chatId?: string; profileUrl?: string; publicIdentifier?: string }): string | null {
  const byItem = state.sender.items.find((i) => (e.providerId && i.providerId === e.providerId) || (e.chatId && i.chatId === e.chatId));
  if (byItem) return byItem.leadId;
  const url = normalizeProfileUrl(e.profileUrl ?? (e.publicIdentifier ? `https://www.linkedin.com/in/${e.publicIdentifier}` : undefined));
  if (url) return Object.values(state.leads).find((l) => l.linkedinUrl === url)?.id ?? null;
  return null;
}

export interface UnipileWebhookBody {
  event?: string;
  /** Hosted auth notify payload: CREATION_SUCCESS or RECONNECTED. */
  status?: string;
  name?: string;
  account_id?: string;
  account_info?: { user_id?: string };
  chat_id?: string;
  message_id?: string;
  message?: string;
  timestamp?: string;
  sender?: { attendee_provider_id?: string; attendee_profile_url?: string };
  user_provider_id?: string;
  user_public_identifier?: string;
  user_profile_url?: string;
}

/**
 * Applies one webhook event. `message_received` from someone other than our own account is a reply.
 * `new_relation` means an invitation was accepted. Anything else is ignored.
 */
export function applyWebhook(state: State, body: UnipileWebhookBody, cfg: WarmConfig, now: Date, rng?: () => number): { handled: string } {
  if ((body.status === "CREATION_SUCCESS" || body.status === "RECONNECTED") && body.account_id) {
    state.sender.accountId = body.account_id;
    return { handled: "account connected" };
  }
  if (body.event === "message_received") {
    const from = body.sender?.attendee_provider_id;
    if (!from || from === body.account_info?.user_id) return { handled: "own message ignored" };
    const leadId = findLeadForEvent(state, { providerId: from, chatId: body.chat_id, profileUrl: body.sender?.attendee_profile_url });
    if (!leadId) return { handled: "no matching lead" };
    // A message in the chat that our own invitation note created is the invitation, not a reply: it comes from us.
    recordReply(state, leadId, { at: body.timestamp ?? now.toISOString(), text: body.message ?? "", chatId: body.chat_id, messageId: body.message_id });
    return { handled: `reply recorded for ${leadId}` };
  }
  if (body.event === "new_relation") {
    const leadId = findLeadForEvent(state, { providerId: body.user_provider_id, profileUrl: body.user_profile_url, publicIdentifier: body.user_public_identifier });
    if (!leadId) return { handled: "no matching lead" };
    return { handled: markAccepted(state, leadId, cfg, now, rng) ? `accepted: ${leadId}` : "already accepted" };
  }
  return { handled: "ignored" };
}

/**
 * Reads replies and acceptances without the webhook. Replies: one message list per chat we started. Acceptance: a profile read
 * for invitations that are still open, at most `dailyProfileChecks` a day and at most `limit` per call, oldest check first.
 * Call this a few times a day at uneven times, not on a fixed clock: Unipile advises against fixed polling patterns.
 */
export async function syncOutbox(o: { state: State; cfg: WarmConfig; client: SenderClient; accountId: string; now: Date; limit?: number; persist?: () => void }): Promise<{ replies: number; accepted: number; checks: number }> {
  const { state, cfg, client, accountId, now } = o;
  let replies = 0;
  let accepted = 0;
  let checks = 0;
  for (const item of state.sender.items.filter((i) => i.status === "sent" && i.chatId)) {
    const msgs = await client.listMessages(item.chatId as string, { limit: 20 });
    for (const m of msgs) {
      if (m.isSender || !m.text) continue;
      if (item.sentAt && m.timestamp && Date.parse(m.timestamp) < Date.parse(item.sentAt)) continue;
      if (recordReply(state, item.leadId, { at: m.timestamp ?? now.toISOString(), text: m.text, chatId: item.chatId, messageId: m.messageId })) replies += 1;
    }
  }
  const open = state.sender.items
    .filter((i) => i.step === "invite" && i.status === "sent" && i.providerId && !state.sender.items.find((f) => f.id === itemId(i.leadId, "followup"))?.notBefore)
    .sort((a, b) => (a.lastCheckedAt ?? "").localeCompare(b.lastCheckedAt ?? ""));
  for (const item of open) {
    if (checks >= (o.limit ?? 5) || checksToday(state, now, cfg) >= cfg.outbox.dailyProfileChecks) break;
    state.sender.checkLog.push(now.toISOString());
    item.lastCheckedAt = now.toISOString();
    checks += 1;
    const p = await client.getProfile(accountId, item.providerId as string);
    if (p.networkDistance === "FIRST_DEGREE" && markAccepted(state, item.leadId, cfg, now)) accepted += 1;
  }
  o.persist?.();
  return { replies, accepted, checks };
}
