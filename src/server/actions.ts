import { parseConfig } from "../engine/config";
import { instantlyCsv, leadsCsv } from "../engine/exportCsv";
import { allow, retryAfter } from "../lib/auth/limits";
import { unipileConfigured, unipileFromEnv } from "../sender/unipile";
import { approve, cancel, dncAdd, ensureDrafts, executeEmails, executeRun, forgetPerson, listLeads, pause, purgeOld, queueLeads, quoteEmails, quoteRun, saveDraft, sendReviewed, sendTick, setLiveSend, sync, unknownAction, type Ctx } from "./service";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Paid actions allowed per session in a window. The quote and the config cap still apply to each one. */
export const SPEND_ACTIONS_PER_WINDOW = 6;
export const SPEND_WINDOW_MS = 10 * 60_000;

/** Who is calling: the admin session id from the gate (absent in the demo). */
export interface Actor {
  sid?: string;
}

function limitSpend(actor: Actor): void {
  const key = `spend:${actor.sid ?? "demo"}`;
  if (!allow(key, SPEND_ACTIONS_PER_WINDOW, SPEND_WINDOW_MS)) throw new Error(`Too many paid runs from this session. Try again in ${retryAfter(key)} seconds.`);
}

/**
 * The one entry point the web UI posts to. Each action validates its own input and returns plain JSON.
 * The route has already checked the admin session and the CSRF token. Spend caps come from the config, never from `body`.
 */
export async function dispatch(ctx: Ctx, body: Record<string, unknown>, actor: Actor = {}): Promise<unknown> {
  const who = actor.sid ? `admin ${actor.sid.slice(0, 6)}` : "demo";
  switch (body.action) {
    case "quote": return quoteRun(ctx);
    case "run": limitSpend(actor); return executeRun(ctx, { capUsd: ctx.getConfig().spend.runCapUsd, partial: Boolean(body.partial) });
    case "saveConfig": {
      const cfg = parseConfig(body.config, "config");
      if (cfg.outbox.dryRun !== ctx.getConfig().outbox.dryRun) throw new Error("Use the live-send switch on the Outbox page to change outbox.dryRun. It is recorded in the audit log.");
      ctx.setConfig(cfg);
      return { saved: true };
    }
    case "drafts": {
      const state = ctx.read();
      const n = await ensureDrafts(ctx, state, { ids: strings(body.ids), force: Boolean(body.force) });
      ctx.write(state);
      return { drafts: n };
    }
    case "saveDraft": return { saved: saveDraft(ctx, String(body.leadId), (body.patch ?? {}) as Record<string, string>) };
    case "emailQuote": return quoteEmails(ctx, strings(body.ids));
    case "emailRun": limitSpend(actor); return executeEmails(ctx, strings(body.ids), ctx.getConfig().spend.emailCapUsd);
    case "queue": return queueLeads(ctx, strings(body.ids));
    case "approve": return approve(ctx, (body.reviewed ?? {}) as Record<string, string>);
    case "cancel": return { cancelled: cancel(ctx, strings(body.ids)) };
    case "pause": pause(ctx, Boolean(body.paused)); return { paused: Boolean(body.paused) };
    case "tick": {
      // A real send names the item and the text hash the admin reviewed. A dry run needs neither.
      if (!body.live) return sendReviewedPreview(ctx);
      if (typeof body.itemId !== "string" || typeof body.hash !== "string") throw new Error("A live send needs the item id and the text hash you reviewed.");
      return sendReviewed(ctx, { itemId: body.itemId, hash: body.hash, actor: who });
    }
    case "setLiveSend": return setLiveSend(ctx, Boolean(body.live), who);
    case "sync": return sync(ctx);
    case "unknown": return { ok: unknownAction(ctx, String(body.id), body.mode === "confirm" ? "confirm" : "retry") };
    case "dnc": dncAdd(ctx, String(body.value ?? "")); return { added: true };
    case "forget": return { erased: forgetPerson(ctx, String(body.value ?? "")) };
    case "purge": return { deleted: purgeOld(ctx) };
    case "connect": {
      if (ctx.demo) return { url: null, message: "Demo mode: no Unipile account is contacted." };
      if (!unipileConfigured(ctx.env)) throw new Error("Set UNIPILE_DSN and UNIPILE_API_KEY first. You need your own Unipile account.");
      const link = await unipileFromEnv(ctx.env, ctx.fetch).createHostedAuthLink({ name: "looot-warm-leads", notifyUrl: typeof body.notifyUrl === "string" ? body.notifyUrl : undefined });
      return { url: link.url };
    }
    default: throw new Error(`Unknown action ${String(body.action)}`);
  }
}

function sendReviewedPreview(ctx: Ctx) {
  return sendTick(ctx, { live: false });
}

export function exportFile(ctx: Ctx, format: string, newOnly: boolean): { body: string; name: string } {
  const leads = listLeads(ctx.read(), ctx.getConfig(), { newOnly });
  const stamp = ctx.now().toISOString().slice(0, 10);
  if (format === "instantly") return { body: instantlyCsv(leads).csv, name: `instantly-${stamp}.csv` };
  return { body: leadsCsv(leads), name: `warm-leads-${stamp}.csv` };
}
