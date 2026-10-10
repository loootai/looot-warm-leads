"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { usd, usdPrecise } from "@/engine/money";
import type { Quote, RunSummary } from "@/engine/types";
import { Btn, ErrorNote, Panel, act, inputCls, useBusy } from "./ui";

/** Shows what a discovery run costs before it starts, takes a spend cap, and runs. */
export function RunPanel({ demo, hasSources }: { demo: boolean; hasSources: boolean }) {
  const router = useRouter();
  const [quote, setQuote] = useState<(Quote & { unpriced: string[] }) | null>(null);
  const [cap, setCap] = useState("2");
  const [done, setDone] = useState<RunSummary | null>(null);
  const q = useBusy();
  const r = useBusy();
  useEffect(() => {
    void q.run(async () => setQuote(await act("quote")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const capNum = Number(cap);
  const over = quote ? quote.totalMicros > capNum * 1e6 : false;
  return (
    <Panel title="Find new warm leads" aside={<span className="text-12 text-mute">{demo ? "Demo: cost is simulated at list price" : "Quote first, then run"}</span>}>
      {!hasSources && <p className="mb-3 rounded-control bg-amber-soft px-2 py-1.5 text-12 text-amber">No signal sources yet. Add competitors, creators or keywords on the Sources page.</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-12">
          <thead className="text-mute"><tr><th className="py-1 pr-3 font-medium">Step</th><th className="py-1 pr-3 font-medium">Provider</th><th className="py-1 pr-3 text-right font-medium">Price</th><th className="py-1 pr-3 text-right font-medium">Calls, up to</th><th className="py-1 text-right font-medium">Total</th></tr></thead>
          <tbody>
            {quote?.lines.map((l) => (
              <tr key={l.endpointId} className="border-t border-line"><td className="py-1 pr-3">{l.label}</td><td className="py-1 pr-3 text-mute">{l.provider}</td><td className="num py-1 pr-3 text-right">{usdPrecise(l.priceMicros)}</td><td className="num py-1 pr-3 text-right">{l.calls}</td><td className="num py-1 text-right">{usdPrecise(l.totalMicros)}</td></tr>
            ))}
            {quote && <tr className="border-t border-line-strong font-medium"><td className="py-1" colSpan={4}>Upper bound at list price</td><td className="num py-1 text-right">{usd(quote.totalMicros)}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-12 font-medium text-mute">Spend cap (USD)
          <input aria-label="Spend cap in dollars" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} className={`${inputCls} w-24 num`} />
        </label>
        <Btn tone="primary" disabled={r.busy || !hasSources || !(capNum > 0)} onClick={() => r.run(async () => { const s = await act<RunSummary>("run", { capUsd: capNum }); setDone(s); router.refresh(); })}>
          <Play size={14} />{r.busy ? "Running..." : "Run discovery"}
        </Btn>
        {over && <span className="text-12 text-amber">The quote is above the cap. The run will refuse; raise the cap or lower limits.</span>}
      </div>
      <ErrorNote message={q.error ?? r.error} />
      {done && <p className="mt-2 text-12 text-mute">{done.leads} leads on the list, {done.newLeads} new. {done.demo ? "Simulated spend" : "Spent"} {usd(done.spentMicros)}. {done.pendingCalls} calls pending, {done.failedCalls} failed. A pending call is not a failure; run again the same day to collect it without a second charge.</p>}
    </Panel>
  );
}
