import { parseConfig } from "../engine/config";
import { instantlyCsv, leadsCsv } from "../engine/exportCsv";
import { unipileConfigured, unipileFromEnv } from "../sender/unipile";
import { approve, cancel, dncAdd, ensureDrafts, executeEmails, executeRun, forgetPerson, listLeads, pause, purgeOld, queueLeads, quoteEmails, quoteRun, saveDraft, sendTick, sync, unknownAction, type Ctx } from "./service";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The one entry point the web UI posts to. Each action validates its own input and returns plain JSON. */
export async function dispatch(ctx: Ctx, body: Record<string, unknown>): Promise<unknown> {
  switch (body.action) {
    case "quote": return quoteRun(ctx);
    case "run": return executeRun(ctx, { capUsd: Number(body.capUsd ?? 2), partial: Boolean(body.partial) });
    case "saveConfig": {
      const cfg = parseConfig(body.config, "config");
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
    case "emailRun": return executeEmails(ctx, strings(body.ids), Number(body.capUsd ?? 1));
    case "queue": return queueLeads(ctx, strings(body.ids));
    case "approve": return approve(ctx, (body.reviewed ?? {}) as Record<string, string>);
    case "cancel": return { cancelled: cancel(ctx, strings(body.ids)) };
    case "pause": pause(ctx, Boolean(body.paused)); return { paused: Boolean(body.paused) };
    case "tick": return sendTick(ctx, { live: Boolean(body.live) });
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

export function exportFile(ctx: Ctx, format: string, newOnly: boolean): { body: string; name: string } {
  const leads = listLeads(ctx.read(), ctx.getConfig(), { newOnly });
  const stamp = ctx.now().toISOString().slice(0, 10);
  if (format === "instantly") return { body: instantlyCsv(leads).csv, name: `instantly-${stamp}.csv` };
  return { body: leadsCsv(leads), name: `warm-leads-${stamp}.csv` };
}
