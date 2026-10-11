import { BudgetForm } from "@/components/BudgetForm";
import { BudgetPanel } from "@/components/BudgetPanel";
import { Bar } from "@/components/chips";
import { Panel } from "@/components/ui";
import { ENDPOINTS, PRICES_AS_OF } from "@/engine/endpoints";
import { MICROS, usd, usdPrecise } from "@/engine/money";
import { budgetStatus, makeCtx } from "@/server/service";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cost" };

export default async function CostPage() {
  await requireAdminPage();
  const ctx = await makeCtx();
  const state = ctx.read();
  const status = await budgetStatus(ctx);
  const run = state.lastRun;
  const steps = new Map<string, { label: string; provider: string; jobId: string; endpointId: string; ok: number; pending: number; failed: number; skipped: number; cost: number; list: number }>();
  for (const c of run?.calls ?? []) {
    const def = Object.values(ENDPOINTS).find((d) => d.endpointId === c.endpointId);
    const x = steps.get(c.endpointId) ?? { label: def?.label ?? c.stage, provider: def?.provider ?? "", jobId: def?.jobId ?? "", endpointId: c.endpointId, ok: 0, pending: 0, failed: 0, skipped: 0, cost: 0, list: c.listPriceMicros };
    x.cost += c.costMicros;
    if (c.status === "ok") x.ok += 1;
    else if (c.status === "pending") x.pending += 1;
    else if (c.status === "skipped_cap" || c.status === "skipped_budget" || c.status === "skipped_price") x.skipped += 1;
    else x.failed += 1;
    steps.set(c.endpointId, x);
  }
  const emailSpend = state.spendLog.reduce((n, s) => n + s.micros, 0);
  const emailSim = Object.values(state.leads).reduce((n, l) => n + (l.email?.costMicros ?? 0), 0);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-20 font-medium">Cost</h1>
        <p className="text-13 text-mute">Every paid call, at looot list price. A failed call costs nothing. A call still running at the provider is pending, not failed. A run is held to the cap per run in the config (runs ${ctx.getConfig().spend.runCapUsd.toFixed(2)}, emails ${ctx.getConfig().spend.emailCapUsd.toFixed(2)}), then to the daily and monthly budget below. Each call reserves its list price first and settles to the real cost.</p>
      </div>
      <BudgetPanel status={status} />
      <BudgetForm key={`${status.limits.dailyMicros}:${status.limits.monthlyMicros}`} dailyUsd={status.limits.dailyMicros / MICROS} monthlyUsd={status.limits.monthlyMicros / MICROS} disabled={ctx.demo} />
      {run ? (
        <Panel title={run.demo ? "Last run (simulated at list price, nothing charged)" : "Last run"}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Quoted, upper bound", usd(run.quotedMicros)], ["Spent", usd(run.spentMicros)], ["Spend cap", usd(run.capMicros)], ["Per lead on the list", run.leads ? usdPrecise(Math.round(run.spentMicros / run.leads)) : "n/a"]].map(([k, v]) => <div key={k}><dt className="text-12 text-mute">{k}</dt><dd className="num text-20 font-medium">{v}</dd></div>)}
          </dl>
          <div className="mt-3"><Bar value={run.spentMicros} max={run.capMicros} /></div>
          <p className="mt-2 text-12 text-mute">{run.candidates} people found, {run.enriched} profiles read, {run.leads} on the list, {run.newLeads} new. {run.pendingCalls} pending, {run.failedCalls} failed, {run.skippedByCap} skipped by the cap, {run.skippedByBudget ?? 0} skipped by the budget.</p>
          {run.notes.map((n) => <p key={n} className="mt-1 text-12 text-amber">{n}</p>)}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-12">
              <thead className="text-mute"><tr><th className="py-1 pr-3 font-medium">Step</th><th className="py-1 pr-3 font-medium">Provider</th><th className="py-1 pr-3 font-medium">looot job</th><th className="py-1 pr-3 text-right font-medium">List price</th><th className="py-1 pr-3 text-right font-medium">Calls ok</th><th className="py-1 pr-3 font-medium">Other</th><th className="py-1 text-right font-medium">Spent</th></tr></thead>
              <tbody>
                {[...steps.values()].map((x) => (
                  <tr key={x.endpointId} className="border-t border-line"><td className="py-1 pr-3">{x.label}</td><td className="py-1 pr-3 text-mute">{x.provider}</td><td className="py-1 pr-3 text-mute">{x.jobId}</td><td className="num py-1 pr-3 text-right">{usdPrecise(x.list)}</td><td className="num py-1 pr-3 text-right">{x.ok}</td><td className="py-1 pr-3 text-mute">{[x.pending && `${x.pending} pending`, x.failed && `${x.failed} failed`, x.skipped && `${x.skipped} skipped`].filter(Boolean).join(", ") || "-"}</td><td className="num py-1 text-right">{usdPrecise(x.cost)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : <Panel title="Last run"><p className="text-13 text-mute">No run yet.</p></Panel>}
      <Panel title="Email lookups">
        <p className="text-13">{usd(emailSpend || emailSim)} {ctx.demo ? "simulated" : "spent"} on email find and verify. Run history: {state.runs.length} runs kept.</p>
      </Panel>
      <Panel title={`Endpoints and list prices (read ${PRICES_AS_OF})`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-12">
            <thead className="text-mute"><tr><th className="py-1 pr-3 font-medium">Used for</th><th className="py-1 pr-3 font-medium">looot job</th><th className="py-1 pr-3 font-medium">Endpoint</th><th className="py-1 text-right font-medium">Per call</th></tr></thead>
            <tbody>{Object.values(ENDPOINTS).map((d) => <tr key={d.step} className="border-t border-line"><td className="py-1 pr-3">{d.label}</td><td className="py-1 pr-3 text-mute">{d.jobId}</td><td className="py-1 pr-3 text-mute">{d.endpointId}</td><td className="num py-1 text-right">{usdPrecise(d.fallbackMicros)}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="mt-2 text-11 text-faint">Live runs read the current price from the public catalog before every run and refuse a call whose price cannot be read.</p>
      </Panel>
    </div>
  );
}
