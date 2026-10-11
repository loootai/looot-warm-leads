import fs from "node:fs";
import path from "node:path";
import { emptyState } from "../engine/state";
import { instantlyCsv, leadsCsv, leadsMarkdown } from "../engine/exportCsv";
import { hasLoootToken } from "../engine/looot";
import { usd, usdPrecise } from "../engine/money";
import type { Quote } from "../engine/types";
import { textHash } from "../sender/outbox";
import { unipileConfigured, unipileFromEnv } from "../sender/unipile";
import { accountId, approve, budgetStatus, cancel, dncAdd, ensureDrafts, executeEmails, executeRun, forgetPerson, listLeads, makeCtx, pause, plan, purgeOld, queueLeads, quoteEmails, quoteRun, sendTick, sync, unknownAction, type Ctx } from "../server/service";

const HELP = `looot-warm-leads: warm B2B leads from LinkedIn intent signals, on looot

Usage
  npm run warm -- <command> [options]

Commands
  run                 Find people showing intent, enrich, score and rank them
  leads               Print the ranked list (--new for leads first seen in the latest run)
  draft               Write or refresh message drafts (--ids a,b or --all, --force to overwrite edits)
  email               Find and verify work emails (--ids a,b or --top N)
  export              Write the list as a file (--format csv|instantly|md)
  outbox <sub>        LinkedIn sender via Unipile: list, queue, approve, cancel, pause, resume, plan, tick, sync, retry, confirm
  connect             Print a hosted auth link to connect a LinkedIn account in Unipile
  dnc <value>         Add a LinkedIn URL, email or domain to the do-not-contact list
  forget <value>      Erase a person (LinkedIn URL or email) and keep only a hash so they are not added back
  purge               Delete leads older than privacy.retentionDays
  config              Check the config file

Options for run
  --max-spend <usd>   Per-run spend cap in dollars (default 2)
  --partial           Run until the cap or the period budget even when the quote is above it
  --dry-run           Print the list-price quote and make no call
  --since-last        Also write the leads first seen in this run to out/new-<date>.md and .csv
  --out <dir>         Where reports go (default out)
  --config <file>     Config file (default: WARM_CONFIG, .looot-warm/config.json, config/warm.config.json)

Environment
  LOOOT_TOKEN                  Your looot key. Not needed for --demo or --dry-run
  WARM_DEMO=1 or --demo        Sample data, no network, no cost
  WARM_DIR                     Where state is kept (default .looot-warm)
  WARM_DAILY_USD, WARM_MONTHLY_USD    Starting daily and monthly budget in dollars until the owner saves one in the web UI (default 10 and 50)
  UNIPILE_DSN, UNIPILE_API_KEY, UNIPILE_ACCOUNT_ID    Optional LinkedIn sender through your own Unipile account
`;

type Flags = Record<string, string | true>;

/** Splits argv into positionals and --flags. A flag with no value after it is true. Throws on a flag missing from `known`. */
export function parseArgs(argv: string[], known: string[]): { pos: string[]; flags: Flags } {
  const pos: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "-h") { flags.help = true; continue; }
    if (!t.startsWith("--")) { pos.push(t); continue; }
    const name = t.slice(2);
    if (!known.includes(name)) throw new Error(`Unknown option ${t}. Run with --help.`);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--") && !BOOLEAN.has(name)) { flags[name] = next; i += 1; } else flags[name] = true;
  }
  return { pos, flags };
}

const BOOLEAN = new Set(["partial", "dry-run", "since-last", "demo", "new", "all", "force", "live", "reviewed", "help", "verified"]);
const KNOWN = ["max-spend", "partial", "dry-run", "since-last", "out", "config", "demo", "new", "min-score", "limit", "ids", "all", "force", "top", "format", "live", "reviewed", "help", "verified", "success-url"];

function quoteTable(q: Quote): string {
  const rows = q.lines.map((l) => `  ${l.label.padEnd(30)} ${l.provider.padEnd(14)} ${l.jobId.padEnd(26)} ${usdPrecise(l.priceMicros).padStart(9)} x ${String(l.calls).padStart(4)} = ${usdPrecise(l.totalMicros).padStart(9)}`);
  return [...rows, `  ${"Upper bound".padEnd(30)} ${"".padEnd(14)} ${"".padEnd(26)} ${"".padStart(9)}        ${usd(q.totalMicros).padStart(9)}`, `  Prices: ${q.priceSource === "catalog" ? "read from the public looot catalog" : "dated fallback in the code"}`].join("\n");
}

const num = (v: string | true | undefined, d: number, flag: string): number => {
  if (v === undefined || v === true) return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} needs a number`);
  return n;
};

const idsOf = (ctx: Ctx, flags: Flags, defaultTop = 0): string[] => {
  const state = ctx.read();
  const cfg = ctx.getConfig();
  const ranked = listLeads(state, cfg);
  if (typeof flags.ids === "string") return flags.ids.split(",").map((s) => s.trim()).filter(Boolean);
  if (flags.all) return ranked.map((l) => l.id);
  const top = flags.top ? num(flags.top, defaultTop, "--top") : defaultTop;
  return ranked.slice(0, top).map((l) => l.id);
};

/** Runs the CLI. Returns the exit code: 0 done, 1 error, 2 refused (over the cap, no token, nothing configured). */
export async function main(argv: string[], env: Record<string, string | undefined> = process.env, out: (s: string) => void = (s) => process.stdout.write(`${s}\n`), overrides: Partial<Pick<Ctx, "looot" | "sender" | "fetch">> = {}): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv, KNOWN);
  } catch (e) {
    out((e as Error).message);
    return 1;
  }
  const { pos, flags } = parsed;
  const cmd = pos[0];
  if (flags.help || !cmd) {
    out(HELP);
    return flags.help ? 0 : 1;
  }
  const effEnv: Record<string, string | undefined> = { ...env, ...(flags.demo ? { WARM_DEMO: "1" } : {}), ...(typeof flags.config === "string" ? { WARM_CONFIG: flags.config } : {}) };
  try {
    const ctx = { ...(await makeCtx(effEnv)), ...overrides };
    const outDir = typeof flags.out === "string" ? flags.out : "out";
    const cfg = ctx.getConfig();
    const sub = pos[1];

    switch (cmd) {
      case "config": {
        out(`Config is valid. ${cfg.sources.competitors.length} competitors, ${cfg.sources.creators.length} creators, ${cfg.sources.keywords.length} keywords, ${cfg.sources.posts.length} watched posts. Triggers: ${["newRole", "hiring", "funding"].filter((k) => cfg.triggers[k as "newRole"]).join(", ") || "none"}.`);
        return 0;
      }
      case "run": {
        const quote = await quoteRun(ctx);
        out(quoteTable(quote));
        if (quote.unpriced.length) out(`  Live price unreadable for: ${quote.unpriced.join(", ")}. Those calls are refused.`);
        if (flags["dry-run"]) {
          out("Dry run. No call was made.");
          return 0;
        }
        if (!ctx.demo && !ctx.looot && !hasLoootToken(effEnv)) {
          out("LOOOT_TOKEN is not set. Use --dry-run to see the cost, or --demo for sample data.");
          return 2;
        }
        const cap = num(flags["max-spend"], 2, "--max-spend");
        if (ctx.demo) ctx.write(emptyState()); // a demo run starts from nothing so the output shows a first run
        if (!ctx.demo) {
          const room = await budgetStatus(ctx);
          out(`Budget left: ${usd(room.remainingMicros)} (${usd(room.day.remainingMicros)} today, ${usd(room.month.remainingMicros)} this month, ${usd(room.day.reservedMicros)} reserved).`);
        }
        const s = await executeRun(ctx, { capUsd: cap, partial: Boolean(flags.partial) });
        const state = ctx.read();
        const ranked = listLeads(state, cfg);
        fs.mkdirSync(outDir, { recursive: true });
        const stamp = ctx.now().toISOString().slice(0, 10);
        fs.writeFileSync(path.join(outDir, `warm-${stamp}.json`), JSON.stringify({ summary: s, leads: ranked }, null, 2));
        fs.writeFileSync(path.join(outDir, `warm-${stamp}.csv`), leadsCsv(ranked));
        fs.writeFileSync(path.join(outDir, `warm-${stamp}.md`), leadsMarkdown(ranked, `Warm leads ${stamp}`));
        const fresh = ranked.filter((l) => s.newLeadIds.includes(l.id));
        if (flags["since-last"]) {
          fs.writeFileSync(path.join(outDir, `new-${stamp}.md`), leadsMarkdown(fresh, `New warm leads since the last run (${stamp})`));
          fs.writeFileSync(path.join(outDir, `new-${stamp}.csv`), leadsCsv(fresh));
        }
        out(`${s.demo ? "Demo run (simulated cost). " : ""}${s.leads} leads on the list, ${s.newLeads} new. Spent ${usd(s.spentMicros)} of a ${usd(s.capMicros)} cap (quoted up to ${usd(s.quotedMicros)}). ${s.pendingCalls} pending, ${s.failedCalls} failed, ${s.skippedByCap} skipped by the cap, ${s.skippedByBudget ?? 0} skipped by the budget.`);
        for (const n of s.notes) out(`  Note: ${n}`);
        if (s.aborted) out(`  ${s.aborted}`);
        out(`Wrote ${path.join(outDir, `warm-${stamp}`)}.json, .csv and .md${flags["since-last"] ? `, and new-${stamp}.md and .csv` : ""}.`);
        return s.aborted ? 1 : 0;
      }
      case "leads": {
        const rows = listLeads(ctx.read(), cfg, { newOnly: Boolean(flags.new), minScore: flags["min-score"] ? num(flags["min-score"], 0, "--min-score") : undefined }).slice(0, num(flags.limit, 25, "--limit"));
        if (rows.length === 0) out("No leads. Run `warm run` first.");
        rows.forEach((l, i) => out(`${String(i + 1).padStart(2)}  ${String(l.score).padStart(3)} ${l.band.padEnd(5)} ${l.id}  ${l.name} | ${l.title ?? ""} | ${l.company ?? ""}  ${l.reasons[0] ?? ""}`));
        return 0;
      }
      case "draft": {
        const state = ctx.read();
        const ids = idsOf(ctx, flags, 0);
        if (!flags.all && ids.length === 0) { out("Pass --ids a,b or --all."); return 1; }
        const n = await ensureDrafts(ctx, state, { ids: flags.all ? undefined : ids, force: Boolean(flags.force) });
        ctx.write(state);
        out(`Wrote ${n} drafts. Edited drafts are kept unless you pass --force.`);
        return 0;
      }
      case "email": {
        const ids = idsOf(ctx, flags, 0);
        if (ids.length === 0) { out("Pass --ids a,b or --top N."); return 1; }
        const q = await quoteEmails(ctx, ids);
        out(quoteTable(q));
        out(`  ${q.leads} leads need a lookup. The verify call runs only when the finder returns an address.`);
        if (flags["dry-run"]) { out("Dry run. No call was made."); return 0; }
        if (!ctx.demo && !ctx.looot && !hasLoootToken(effEnv)) { out("LOOOT_TOKEN is not set."); return 2; }
        const r = await executeEmails(ctx, ids, num(flags["max-spend"], 1, "--max-spend"));
        out(`${r.found} emails found, ${r.deliverable} verified deliverable. Spent ${usd(r.spentMicros)}. ${r.pending} pending, ${r.skippedByCap} skipped by the cap, ${r.skippedByBudget} skipped by the budget.`);
        return r.aborted ? 1 : 0;
      }
      case "export": {
        const format = typeof flags.format === "string" ? flags.format : "csv";
        const ranked = listLeads(ctx.read(), cfg, { newOnly: Boolean(flags.new) });
        fs.mkdirSync(outDir, { recursive: true });
        const stamp = ctx.now().toISOString().slice(0, 10);
        if (format === "instantly") {
          const r = instantlyCsv(ranked);
          const file = path.join(outDir, `instantly-${stamp}.csv`);
          fs.writeFileSync(file, r.csv);
          out(`Wrote ${file}: ${r.included} leads with a verified email. ${r.skipped} skipped (no verified email). Run \`warm email\` first for more.`);
        } else if (format === "md") {
          const file = path.join(outDir, `leads-${stamp}.md`);
          fs.writeFileSync(file, leadsMarkdown(ranked, `Warm leads ${stamp}`));
          out(`Wrote ${file}.`);
        } else if (format === "csv") {
          const file = path.join(outDir, `leads-${stamp}.csv`);
          fs.writeFileSync(file, leadsCsv(ranked));
          out(`Wrote ${file}: ${ranked.length} leads.`);
        } else {
          out(`Unknown format ${format}. Use csv, instantly or md.`);
          return 1;
        }
        return 0;
      }
      case "outbox":
        return await outbox(ctx, sub, pos.slice(2), flags, out);
      case "connect": {
        if (!unipileConfigured(effEnv)) { out("Set UNIPILE_DSN and UNIPILE_API_KEY first. You need your own Unipile account."); return 2; }
        const client = unipileFromEnv(effEnv, ctx.fetch);
        const link = await client.createHostedAuthLink({ name: "looot-warm-leads", successRedirectUrl: typeof flags["success-url"] === "string" ? flags["success-url"] : undefined });
        out(`Open this link and sign in to LinkedIn on Unipile's page. This app never sees your credentials:\n${link.url}\nThen set UNIPILE_ACCOUNT_ID to the account id shown in your Unipile dashboard.`);
        return 0;
      }
      case "dnc": {
        if (!sub) { out("Usage: warm dnc <linkedin url | email | domain>"); return 1; }
        dncAdd(ctx, sub);
        out("Added to the do-not-contact list. Pending messages for that person were cancelled.");
        return 0;
      }
      case "forget": {
        if (!sub) { out("Usage: warm forget <linkedin url | email>"); return 1; }
        const n = forgetPerson(ctx, sub);
        out(`Erased ${n} lead record${n === 1 ? "" : "s"} and their outbox items. A hash is kept so the person is not added again.`);
        return 0;
      }
      case "purge": {
        const n = purgeOld(ctx);
        out(`Deleted ${n} leads older than ${cfg.privacy.retentionDays} days.`);
        return 0;
      }
      default:
        out(`Unknown command ${cmd}. Run with --help.`);
        return 1;
    }
  } catch (e) {
    out((e as Error).message);
    return /above the cap|above what is left of the budget|not set|No signal sources/.test((e as Error).message) ? 2 : 1;
  }
}

async function outbox(ctx: Ctx, sub: string | undefined, rest: string[], flags: Flags, out: (s: string) => void): Promise<number> {
  const state = ctx.read();
  const cfg = ctx.getConfig();
  switch (sub) {
    case "list": {
      out(`Outbox is ${state.sender.paused ? "PAUSED" : "running"}. Mode: ${cfg.outbox.dryRun ? "dry run (outbox.dryRun is true)" : "live"}. Sender: ${ctx.demo ? "demo, nothing leaves this machine" : unipileConfigured(ctx.env) ? "Unipile configured" : "not configured"}.`);
      for (const i of state.sender.items) out(`${i.id.padEnd(26)} ${i.status.padEnd(9)} ${state.leads[i.leadId]?.name ?? "(erased)"} | ${i.text.slice(0, 90).replace(/\n/g, " ")} | hash ${textHash(i.text)}${i.message ? ` | ${i.message}` : ""}`);
      if (state.sender.items.length === 0) out("Nothing queued. Use `warm outbox queue --ids a,b`.");
      return 0;
    }
    case "queue": {
      const ids = idsOf(ctx, flags, 0);
      if (ids.length === 0) { out("Pass --ids a,b."); return 1; }
      const r = queueLeads(ctx, ids);
      out(`Queued ${r.queued.length} items as drafts. Nothing is approved and nothing sends.`);
      for (const x of r.refused) out(`  Refused ${x.leadId}: ${x.reason}`);
      return 0;
    }
    case "approve": {
      if (!flags.reviewed) { out("Run `warm outbox list`, read each text, then pass --reviewed with --ids. Approval is per item and tied to the text you read."); return 2; }
      const ids = typeof flags.ids === "string" ? flags.ids.split(",") : rest;
      const items = state.sender.items.filter((i) => ids.includes(i.id) || ids.includes(i.leadId));
      const reviewed = Object.fromEntries(items.map((i) => [i.id, textHash(i.text)]));
      const r = approve(ctx, reviewed);
      out(`Approved ${r.approved.length}.`);
      for (const x of r.refused) out(`  Refused ${x.id}: ${x.reason}`);
      return 0;
    }
    case "cancel": {
      const ids = typeof flags.ids === "string" ? flags.ids.split(",") : rest;
      out(`Cancelled ${cancel(ctx, state.sender.items.filter((i) => ids.includes(i.id) || ids.includes(i.leadId)).map((i) => i.id))}.`);
      return 0;
    }
    case "pause": pause(ctx, true); out("Outbox paused. Nothing sends until you run `warm outbox resume`."); return 0;
    case "resume": pause(ctx, false); out("Outbox resumed."); return 0;
    case "plan": {
      const p = plan(ctx);
      out(p.item ? `Next: ${p.item.step} to ${state.leads[p.item.leadId]?.name}\n${p.item.text}` : `Nothing sends now: ${p.reason}${p.waitUntil ? ` (until ${p.waitUntil})` : ""}`);
      return 0;
    }
    case "tick": {
      const r = await sendTick(ctx, { live: Boolean(flags.live) });
      out(`${r.action}: ${r.reason}${r.text ? `\n${r.text}` : ""}`);
      return r.action === "failed" || r.action === "unknown" ? 1 : 0;
    }
    case "sync": {
      const r = await sync(ctx);
      out(`${r.replies} new replies, ${r.accepted} accepted invitations, ${r.checks} profile checks.`);
      return 0;
    }
    case "retry":
    case "confirm": {
      const id = rest[0];
      if (!id) { out(`Usage: warm outbox ${sub} <item id>`); return 1; }
      out(unknownAction(ctx, id, sub) ? "Done." : "No unknown item with that id.");
      return 0;
    }
    default:
      out("Usage: warm outbox list|queue|approve|cancel|pause|resume|plan|tick|sync|retry|confirm");
      void accountId;
      return 1;
  }
}

if (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
