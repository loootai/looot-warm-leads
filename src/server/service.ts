import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig, type WarmConfig } from "../engine/config";
import { DEMO_NOW, demoConfig, demoRunner } from "../engine/demo";
import { draftFor } from "../engine/draft";
import { emailEndpointIds, emailQuote, runEmails } from "../engine/emailStep";
import { FALLBACK_PRICES } from "../engine/endpoints";
import { llmRewrite } from "../engine/llm";
import { fetchPrices, hasLoootToken, loootFromEnv, type PriceMap, type Runner } from "../engine/looot";
import { toMicros } from "../engine/money";
import { buildQuote, runWarm } from "../engine/run";
import { dataDir, emptyState, forget, purge, readState, writeState, addDnc } from "../engine/state";
import type { Lead, Quote, RunSummary, State } from "../engine/types";
import { demoSender } from "../sender/demoSender";
import { approveItems, applyWebhook, cancelItems, confirmSent, editItem, planNext, queueLead, retryUnknown, setPaused, syncOutbox, textHash, tick, type TickResult, type UnipileWebhookBody } from "../sender/outbox";
import { unipileConfigured, unipileFromEnv, type SenderClient } from "../sender/unipile";
import { buildDemoState } from "./demoState";

type Env = Record<string, string | undefined>;

/** Everything the CLI and the web app share: where state lives, which config is in force, and which clients are used. */
export interface Ctx {
  demo: boolean;
  env: Env;
  now(): Date;
  getConfig(): WarmConfig;
  setConfig(c: WarmConfig): void;
  read(): State;
  write(s: State): void;
  /** Test hooks. */
  looot?: Runner;
  sender?: SenderClient;
  fetch?: typeof fetch;
}

declare global {
  var __warmDemo: { state: State; config: WarmConfig } | undefined;
}

export function configPath(env: Env): string {
  return env.WARM_CONFIG ?? path.join(dataDir(env), "config.json");
}

/** Builds the context for this process. Demo mode (WARM_DEMO=1) keeps everything in memory and never touches the network. */
export async function makeCtx(env: Env = process.env): Promise<Ctx> {
  if (env.WARM_DEMO === "1") {
    const demo = (globalThis.__warmDemo ??= await (async () => {
      const config = demoConfig();
      return { config, state: await buildDemoState(config) };
    })());
    return { demo: true, env, now: () => DEMO_NOW, getConfig: () => demo.config, setConfig: (c) => void (demo.config = c), read: () => demo.state, write: (s) => void (demo.state = s) };
  }
  const file = configPath(env);
  const stateFile = path.join(dataDir(env), "state.json");
  return {
    demo: false,
    env,
    now: () => new Date(),
    getConfig: () => loadConfig(fs.existsSync(/*turbopackIgnore: true*/ file) ? file : undefined),
    setConfig: (c) => saveConfig(c, file),
    read: () => readState(stateFile),
    write: (s) => writeState(s, stateFile),
  };
}

function allFallback(cfg: WarmConfig): PriceMap {
  const m: PriceMap = { ...FALLBACK_PRICES };
  for (const id of emailEndpointIds(cfg)) m[id] ??= 0;
  return m;
}

async function prices(ctx: Ctx, cfg: WarmConfig): Promise<{ prices: PriceMap; source: Quote["priceSource"]; unread: string[] }> {
  const fb = allFallback(cfg);
  if (ctx.demo) return { prices: fb, source: "catalog", unread: [] };
  const live = await fetchPrices(fb, { fetch: ctx.fetch });
  return { prices: live.prices, source: live.source, unread: live.unread };
}

export function runner(ctx: Ctx): Runner {
  if (ctx.looot) return ctx.looot;
  if (ctx.demo) return demoRunner();
  return loootFromEnv(ctx.env);
}

export function canRunLive(ctx: Ctx): boolean {
  return ctx.demo || Boolean(ctx.looot) || hasLoootToken(ctx.env);
}

/** The discovery quote: an upper bound at the catalog's list prices. Free. */
export async function quoteRun(ctx: Ctx): Promise<Quote & { unpriced: string[] }> {
  const cfg = ctx.getConfig();
  const p = await prices(ctx, cfg);
  return { ...buildQuote(cfg, p.prices, p.source), unpriced: p.unread };
}

/** Refuses when the quote is above the cap, unless `partial`. Then runs discovery, drafts for new leads, and saves. */
export async function executeRun(ctx: Ctx, o: { capUsd: number; partial?: boolean; onProgress?: (s: string) => void }): Promise<RunSummary> {
  const cfg = ctx.getConfig();
  const cap = toMicros(o.capUsd);
  const p = await prices(ctx, cfg);
  const quote = buildQuote(cfg, p.prices, p.source);
  if (!ctx.demo && quote.totalMicros > cap && !o.partial) throw new Error(`The quote ($${(quote.totalMicros / 1e6).toFixed(2)}) is above the cap ($${o.capUsd.toFixed(2)}). Raise the cap, lower limits in the config, or pass --partial to run until the cap.`);
  if (!cfg.sources.competitors.length && !cfg.sources.creators.length && !cfg.sources.keywords.length && !cfg.sources.posts.length) throw new Error("No signal sources are set. Add a competitor, creator, keyword or post first.");
  const state = ctx.read();
  const { summary, leads } = await runWarm({ config: cfg, looot: runner(ctx), prices: p.prices, priceSource: p.source, unpriced: p.unread, capMicros: cap, state, now: ctx.now(), demo: ctx.demo, onProgress: o.onProgress });
  if (!ctx.demo && summary.calls.length > 0 && summary.calls.every((c) => c.status === "skipped_price")) throw new Error("Live prices could not be read from the public catalog, so no call was made. Check your network and try again.");
  state.leads = leads;
  state.lastRun = summary;
  state.runs = [summary, ...state.runs].slice(0, 30);
  await ensureDrafts(ctx, state, { onlyMissing: true });
  ctx.write(state);
  return summary;
}

/** The daily list: visible leads, best first. */
export function listLeads(state: State, cfg: WarmConfig, o: { newOnly?: boolean; minScore?: number; includeHidden?: boolean } = {}): Lead[] {
  const min = o.minScore ?? cfg.scoring.listMinScore;
  return Object.values(state.leads)
    .filter((l) => !l.excluded && (o.includeHidden || l.score >= min))
    .filter((l) => !o.newOnly || l.isNew)
    .sort((a, b) => b.score - a.score || b.rawIntent + b.fitPoints - (a.rawIntent + a.fitPoints) || b.events.length - a.events.length || a.name.localeCompare(b.name));
}

/** Writes template drafts (and the optional LLM rewrite) for leads that have none. A draft the user edited is never overwritten. */
export async function ensureDrafts(ctx: Ctx, state: State, o: { ids?: string[]; onlyMissing?: boolean; force?: boolean } = {}): Promise<number> {
  const cfg = ctx.getConfig();
  let n = 0;
  for (const lead of listLeads(state, cfg, { includeHidden: false })) {
    if (o.ids && !o.ids.includes(lead.id)) continue;
    if (lead.drafts?.edited && !o.force) continue;
    if (lead.drafts && o.onlyMissing && !o.force) continue;
    const base = draftFor(lead, cfg);
    lead.drafts = ctx.demo ? base : await llmRewrite(lead, base, cfg, ctx.env, ctx.fetch);
    n += 1;
  }
  return n;
}

/** Saves the user's edits to a lead's drafts. Marks them edited so a later run does not overwrite them. */
export function saveDraft(ctx: Ctx, leadId: string, patch: { connectionNote?: string; followUp?: string; emailSubject?: string; emailBody?: string }): boolean {
  const cfg = ctx.getConfig();
  const state = ctx.read();
  const lead = state.leads[leadId];
  if (!lead?.drafts) return false;
  const d = lead.drafts;
  if (patch.connectionNote !== undefined) d.connectionNote = patch.connectionNote;
  if (patch.followUp !== undefined) d.followUp = patch.followUp;
  if (patch.emailSubject !== undefined) d.email.subject = patch.emailSubject;
  if (patch.emailBody !== undefined) d.email.body = patch.emailBody;
  d.edited = true;
  d.warnings = d.warnings.filter((w) => !w.startsWith("The connection note is"));
  if (d.connectionNote.length > cfg.messages.noteMax) d.warnings.push(`The connection note is ${d.connectionNote.length} characters; LinkedIn allows ${cfg.messages.noteMax}. Shorten it before queueing.`);
  for (const item of state.sender.items.filter((i) => i.leadId === leadId)) {
    if (item.status === "draft" || item.status === "approved") editItem(state, item.id, item.step === "invite" ? d.connectionNote : d.followUp);
  }
  ctx.write(state);
  return true;
}

export async function quoteEmails(ctx: Ctx, ids: string[]) {
  const cfg = ctx.getConfig();
  const state = ctx.read();
  const leads = ids.map((id) => state.leads[id]).filter(Boolean);
  const p = await prices(ctx, cfg);
  return { ...emailQuote(leads, cfg, p.prices, p.source), unpriced: p.unread };
}

/** Finds and verifies emails for the picked leads. The caller shows the quote first; this refuses a quote above the cap. */
export async function executeEmails(ctx: Ctx, ids: string[], capUsd: number): Promise<{ found: number; deliverable: number; spentMicros: number; pending: number; skippedByCap: number; aborted: string | null }> {
  const cfg = ctx.getConfig();
  const state = ctx.read();
  const leads = ids.map((id) => state.leads[id]).filter(Boolean);
  const p = await prices(ctx, cfg);
  const q = emailQuote(leads, cfg, p.prices, p.source);
  const cap = toMicros(capUsd);
  if (!ctx.demo && q.totalMicros > cap) throw new Error(`The email quote ($${(q.totalMicros / 1e6).toFixed(2)}) is above the cap ($${capUsd.toFixed(2)}).`);
  const r = await runEmails({ leads, config: cfg, looot: runner(ctx), prices: p.prices, unpriced: p.unread, capMicros: cap, now: ctx.now(), demo: ctx.demo });
  for (const [id, res] of Object.entries(r.results)) state.leads[id].email = res;
  if (r.spentMicros > 0) state.spendLog.push({ at: ctx.now().toISOString(), what: `email find and verify for ${Object.keys(r.results).length} leads`, micros: r.spentMicros });
  ctx.write(state);
  const done = Object.values(r.results);
  return { found: done.filter((x) => x.address).length, deliverable: done.filter((x) => x.deliverable).length, spentMicros: r.spentMicros, pending: r.pending, skippedByCap: r.skippedByCap, aborted: r.aborted };
}

// ---- sender ----

export function senderEnabled(ctx: Ctx): boolean {
  return ctx.demo || Boolean(ctx.sender) || unipileConfigured(ctx.env);
}

export function senderClient(ctx: Ctx): SenderClient | undefined {
  if (ctx.sender) return ctx.sender;
  if (ctx.demo) return demoSender();
  return unipileConfigured(ctx.env) ? unipileFromEnv(ctx.env, ctx.fetch) : undefined;
}

export function accountId(ctx: Ctx, state: State): string | undefined {
  return ctx.env.UNIPILE_ACCOUNT_ID || state.sender.accountId || (ctx.demo ? "demo_account" : undefined);
}

export function queueLeads(ctx: Ctx, ids: string[]) {
  const cfg = ctx.getConfig();
  const state = ctx.read();
  const out = { queued: [] as string[], refused: [] as { leadId: string; reason: string }[] };
  for (const id of ids) {
    const lead = state.leads[id];
    if (!lead) continue;
    const r = queueLead(state, lead, cfg);
    out.queued.push(...r.queued);
    out.refused.push(...r.refused);
  }
  ctx.write(state);
  return out;
}

/** Approves reviewed items. `reviewed` maps item id to the hash of the text the user saw. */
export function approve(ctx: Ctx, reviewed: Record<string, string>) {
  const state = ctx.read();
  const r = approveItems(state, reviewed, ctx.getConfig(), ctx.now());
  ctx.write(state);
  return r;
}

export function cancel(ctx: Ctx, ids: string[]): number {
  const state = ctx.read();
  const n = cancelItems(state, ids);
  ctx.write(state);
  return n;
}

export function pause(ctx: Ctx, paused: boolean): void {
  const state = ctx.read();
  setPaused(state, paused);
  ctx.write(state);
}

export function plan(ctx: Ctx) {
  return planNext(ctx.read(), ctx.getConfig(), ctx.now());
}

/** One send tick. Dry-run unless `live` is true and the config has outbox.dryRun set to false and a Unipile account is connected. */
export async function sendTick(ctx: Ctx, o: { live: boolean }): Promise<TickResult> {
  const state = ctx.read();
  return tick({ state, cfg: ctx.getConfig(), now: ctx.now(), client: senderClient(ctx), accountId: accountId(ctx, state), live: o.live, persist: () => ctx.write(state) });
}

export async function sync(ctx: Ctx) {
  const state = ctx.read();
  const client = senderClient(ctx);
  const acc = accountId(ctx, state);
  if (!client || !acc) throw new Error("No Unipile account is connected.");
  return syncOutbox({ state, cfg: ctx.getConfig(), client, accountId: acc, now: ctx.now(), persist: () => ctx.write(state) });
}

export function handleWebhook(ctx: Ctx, body: UnipileWebhookBody) {
  const state = ctx.read();
  const r = applyWebhook(state, body, ctx.getConfig(), ctx.now());
  ctx.write(state);
  return r;
}

export function unknownAction(ctx: Ctx, id: string, action: "retry" | "confirm"): boolean {
  const state = ctx.read();
  const ok = action === "retry" ? retryUnknown(state, id) : confirmSent(state, id, ctx.now());
  ctx.write(state);
  return ok;
}

export function dncAdd(ctx: Ctx, value: string): void {
  const state = ctx.read();
  addDnc(state, value);
  ctx.write(state);
}

export function forgetPerson(ctx: Ctx, value: string): number {
  const state = ctx.read();
  const n = forget(state, value);
  ctx.write(state);
  return n;
}

export function purgeOld(ctx: Ctx): number {
  const state = ctx.read();
  const n = purge(state, ctx.getConfig().privacy.retentionDays, ctx.now());
  ctx.write(state);
  return n;
}

export { emptyState, textHash };
