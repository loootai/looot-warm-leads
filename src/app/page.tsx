import { InboxTable, type InboxRow } from "@/components/InboxTable";
import { RunPanel } from "@/components/RunPanel";
import { ago } from "@/components/chips";
import { topEvent } from "@/engine/draft";
import { usd } from "@/engine/money";
import { listLeads, makeCtx } from "@/server/service";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const ctx = await makeCtx();
  const cfg = ctx.getConfig();
  const state = ctx.read();
  const now = ctx.now();
  const leads = listLeads(state, cfg);
  const queued = new Set(state.sender.items.filter((i) => ["draft", "approved", "sent"].includes(i.status)).map((i) => i.leadId));
  const rows: InboxRow[] = leads.map((l) => {
    const ev = topEvent(l);
    return { id: l.id, name: l.name, title: l.title, company: l.company, score: l.score, band: l.band, isNew: l.isNew, signal: ev?.title ?? "No signal", signalAgo: ago(ev?.date, now), signalUrl: ev?.url, signalCount: l.events.length, emailStatus: l.email?.status, emailDeliverable: l.email?.deliverable, emailPending: l.email?.pending, costMicros: l.costMicros, queued: queued.has(l.id) };
  });
  const run = state.lastRun;
  const tiles: [string, string][] = [
    ["On the list", String(leads.length)],
    ["New in the last run", String(leads.filter((l) => l.isNew).length)],
    ["Hot", String(leads.filter((l) => l.band === "hot").length)],
    [run?.demo ? "Last run cost (simulated)" : "Last run cost", run ? usd(run.spentMicros) : "none yet"],
  ];
  const hasSources = cfg.sources.competitors.length + cfg.sources.creators.length + cfg.sources.keywords.length + cfg.sources.posts.length > 0;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-20 font-medium">Warm leads</h1>
        <p className="text-13 text-mute">People who engaged with the sources you watch, ranked by ICP fit and intent. Every score has a breakdown on the lead page.</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([k, v]) => <div key={k} className="rounded-panel border border-line bg-panel p-3"><dt className="text-12 text-mute">{k}</dt><dd className="num text-20 font-medium">{v}</dd></div>)}
      </dl>
      <InboxTable rows={rows} />
      <RunPanel demo={ctx.demo} hasSources={hasSources} />
    </div>
  );
}
