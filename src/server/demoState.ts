import type { WarmConfig } from "../engine/config";
import { DEMO_NOW, demoRunner } from "../engine/demo";
import { draftFor } from "../engine/draft";
import { runEmails } from "../engine/emailStep";
import { FALLBACK_PRICES } from "../engine/endpoints";
import { runWarm } from "../engine/run";
import { emptyState } from "../engine/state";
import type { State } from "../engine/types";
import { approveItems, itemId, markAccepted, queueLead, recordReply, textHash } from "../sender/outbox";

const iso = (daysAgo: number, hour = 9) => {
  const d = new Date(DEMO_NOW.getTime() - daysAgo * 86_400_000);
  d.setUTCHours(hour, 12, 0, 0);
  return d.toISOString();
};

/** Runs the sample sources through the real engine, then adds emails and a small outbox history so every screen has content. */
export async function buildDemoState(cfg: WarmConfig): Promise<State> {
  const state = emptyState();
  const { summary, leads } = await runWarm({ config: cfg, looot: demoRunner(), prices: FALLBACK_PRICES, capMicros: 5_000_000, state, now: DEMO_NOW, demo: true });
  state.leads = leads;
  state.lastRun = summary;
  state.runs = [summary];
  const ranked = Object.values(leads).filter((l) => !l.excluded && l.score >= cfg.scoring.listMinScore).sort((a, b) => b.score - a.score || b.rawIntent + b.fitPoints - (a.rawIntent + a.fitPoints));
  for (const l of ranked) l.drafts = draftFor(l, cfg);
  // Emails for the top five, found through the same engine and the sample runner.
  const e = await runEmails({ leads: ranked.slice(0, 5), config: cfg, looot: demoRunner(), prices: FALLBACK_PRICES, capMicros: 1_000_000, now: DEMO_NOW, demo: true });
  for (const [id, r] of Object.entries(e.results)) leads[id].email = r;

  // Outbox history: one lead went through the whole sequence and replied, one is approved and waiting, one is a draft.
  const [a, b, c] = ranked;
  const reviewed = (id: string) => ({ [id]: textHash(state.sender.items.find((i) => i.id === id)?.text ?? "") });
  for (const l of [a, b, c]) queueLead(state, l, cfg);
  for (const step of ["invite", "followup"] as const) approveItems(state, reviewed(itemId(a.id, step)), cfg, new Date(iso(5)));
  for (const step of ["invite", "followup"] as const) approveItems(state, reviewed(itemId(b.id, step)), cfg, new Date(iso(0, 7)));
  const inv = state.sender.items.find((i) => i.id === itemId(a.id, "invite"));
  const fu = state.sender.items.find((i) => i.id === itemId(a.id, "followup"));
  if (inv && fu) {
    Object.assign(inv, { status: "sent", sentAt: iso(4), providerId: "demo_provider_a", invitationId: "demo_invitation_a" });
    markAccepted(state, a.id, cfg, new Date(iso(3)), () => 0);
    Object.assign(fu, { status: "sent", sentAt: iso(2), chatId: "demo_chat_a", providerId: "demo_provider_a" });
    state.sender.sentLog.push({ at: iso(4), step: "invite" }, { at: iso(2), step: "followup" }, { at: iso(0, 7), step: "invite" }, { at: iso(0, 7), step: "invite" });
    recordReply(state, a.id, { at: iso(1, 14), text: "Thanks for the note. Timing is good, we are reviewing attribution tools this month. Can you send the example?", chatId: "demo_chat_a", messageId: "demo_reply_a" });
  }
  return state;
}
