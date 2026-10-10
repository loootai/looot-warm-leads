"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Mail, Send } from "lucide-react";
import { usd, usdPrecise } from "@/engine/money";
import type { Quote } from "@/engine/types";
import { Bar, BandChip, EmailChip, Pill } from "./chips";
import { Btn, ErrorNote, Panel, act, useBusy } from "./ui";

export interface InboxRow {
  id: string;
  name: string;
  title?: string;
  company?: string;
  score: number;
  band: "hot" | "warm" | "cool";
  isNew: boolean;
  signal: string;
  signalAgo: string;
  signalUrl?: string;
  signalCount: number;
  emailStatus?: string;
  emailDeliverable?: boolean;
  emailPending?: boolean;
  costMicros: number;
  queued: boolean;
}

/** The daily list, ranked by score, with select-and-act controls. Emails and queueing always show a quote or a review step first. */
export function InboxTable({ rows }: { rows: InboxRow[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [quote, setQuote] = useState<(Quote & { leads: number; unpriced: string[] }) | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const b = useBusy();
  const ids = [...sel];
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Panel title="Today's warm leads" aside={<div className="flex gap-1"><a className="inline-flex h-8 items-center gap-1 rounded-control border border-line-strong px-2 text-12 hover:bg-hover" href="/api/export?format=csv"><Download size={13} />CSV</a><a className="inline-flex h-8 items-center gap-1 rounded-control border border-line-strong px-2 text-12 hover:bg-hover" href="/api/export?format=instantly"><Download size={13} />Instantly CSV</a></div>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-12 text-mute">{ids.length} selected</span>
        <Btn disabled={ids.length === 0 || b.busy} onClick={() => b.run(async () => { setMsg(null); setQuote(await act("emailQuote", { ids })); })}><Mail size={14} />Quote emails</Btn>
        <Btn disabled={ids.length === 0 || b.busy} onClick={() => b.run(async () => { const r = await act<{ queued: string[]; refused: { reason: string }[] }>("queue", { ids }); setMsg(`${r.queued.length} items queued as drafts${r.refused.length ? `, ${r.refused.length} refused (${r.refused[0].reason})` : ""}. Review and approve them on the Outbox page. Nothing sends yet.`); router.refresh(); })}><Send size={14} />Add to outbox</Btn>
      </div>
      {quote && (
        <div className="mb-3 rounded-control border border-line-strong bg-page p-3 text-12">
          <p className="font-medium">Email lookup quote for {quote.leads} leads: {usd(quote.totalMicros)} at list price</p>
          <ul className="mt-1 text-mute">{quote.lines.map((l) => <li key={l.endpointId}>{l.label}: {l.calls} x {usdPrecise(l.priceMicros)} via {l.provider} ({l.jobId})</li>)}</ul>
          <p className="mt-1 text-mute">The verify call runs only when the finder returns an address, so this is the most it can cost.</p>
          <div className="mt-2 flex gap-2">
            <Btn tone="primary" disabled={b.busy} onClick={() => b.run(async () => { const r = await act<{ found: number; deliverable: number; spentMicros: number }>("emailRun", { ids, capUsd: Math.max(0.05, quote.totalMicros / 1e6) }); setQuote(null); setMsg(`${r.found} emails found, ${r.deliverable} verified. Spent ${usd(r.spentMicros)}.`); router.refresh(); })}>Run for {usd(quote.totalMicros)}</Btn>
            <Btn onClick={() => setQuote(null)}>Cancel</Btn>
          </div>
        </div>
      )}
      {msg && <p className="mb-3 rounded-control bg-brand-soft px-2 py-1.5 text-12 text-link">{msg}</p>}
      <ErrorNote message={b.error} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-13">
          <thead className="text-12 text-mute">
            <tr>
              <th className="w-8 py-1.5"><input type="checkbox" aria-label="Select all" checked={sel.size === rows.length && rows.length > 0} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
              <th className="py-1.5 pr-3 font-medium">#</th><th className="py-1.5 pr-3 font-medium">Score</th><th className="py-1.5 pr-3 font-medium">Person</th><th className="py-1.5 pr-3 font-medium">Top signal</th><th className="py-1.5 pr-3 font-medium">Email</th><th className="py-1.5 pr-3 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t border-line align-top hover:bg-hover/50">
                <td className="py-2"><input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="num py-2 pr-3 text-mute">{i + 1}</td>
                <td className="w-28 py-2 pr-3"><div className="flex items-center gap-2"><span className="num text-16 font-medium">{r.score}</span><BandChip band={r.band} /></div><Bar value={r.score} max={100} className="mt-1" /></td>
                <td className="py-2 pr-3">
                  <Link href={`/leads/${r.id}`} className="font-medium text-link hover:underline">{r.name}</Link> {r.isNew && <Pill tone="brand">new</Pill>} {r.queued && <Pill tone="amber">in outbox</Pill>}
                  <div className="text-12 text-mute">{[r.title, r.company].filter(Boolean).join(" at ")}</div>
                </td>
                <td className="py-2 pr-3">
                  <div>{r.signal}</div>
                  <div className="text-12 text-mute">{r.signalAgo}{r.signalCount > 1 ? `, ${r.signalCount} signals` : ""}{r.signalUrl && <> · <a href={r.signalUrl} target="_blank" rel="noreferrer" className="text-link hover:underline">evidence</a></>}</div>
                </td>
                <td className="py-2 pr-3"><EmailChip status={r.emailStatus} deliverable={r.emailDeliverable} pending={r.emailPending} /></td>
                <td className="num py-2 pr-3 text-right text-mute">{usdPrecise(r.costMicros)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-mute">No leads yet. Set sources, then run discovery.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
