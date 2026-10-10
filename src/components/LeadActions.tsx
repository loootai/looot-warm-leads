"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Mail, Trash2 } from "lucide-react";
import { usd } from "@/engine/money";
import { Btn, ErrorNote, act, useBusy } from "./ui";

/** Email lookup with the quote first, do-not-contact, and erase. */
export function LeadActions({ leadId, linkedinUrl, hasEmail }: { leadId: string; linkedinUrl: string; hasEmail: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState<{ totalMicros: number; lines: { label: string; calls: number; priceMicros: number; provider: string }[]; leads: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const b = useBusy();
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {!hasEmail && <Btn disabled={b.busy} onClick={() => b.run(async () => setQ(await act("emailQuote", { ids: [leadId] })))}><Mail size={14} />Find work email</Btn>}
        <Btn disabled={b.busy} onClick={() => b.run(async () => { await act("dnc", { value: linkedinUrl }); setMsg("Added to the do-not-contact list. Pending messages were cancelled."); router.refresh(); })}><Ban size={14} />Do not contact</Btn>
        <Btn tone="danger" disabled={b.busy} onClick={() => { if (confirm("Erase this person? Their record and outbox items are deleted. A hash is kept so they are not added again.")) void b.run(async () => { await act("forget", { value: linkedinUrl }); router.push("/"); router.refresh(); }); }}><Trash2 size={14} />Erase</Btn>
      </div>
      {q && (
        <div className="mt-3 rounded-control border border-line-strong bg-page p-3 text-12">
          <p className="font-medium">Quote: {usd(q.totalMicros)} at list price</p>
          <ul className="text-mute">{q.lines.map((l) => <li key={l.label}>{l.label}: {l.calls} x ${(l.priceMicros / 1e6).toFixed(5)} via {l.provider}</li>)}</ul>
          <div className="mt-2 flex gap-2">
            <Btn tone="primary" disabled={b.busy} onClick={() => b.run(async () => { const r = await act<{ found: number; deliverable: number; spentMicros: number }>("emailRun", { ids: [leadId], capUsd: Math.max(0.05, q.totalMicros / 1e6) }); setQ(null); setMsg(r.found ? `Found. Verified deliverable: ${r.deliverable ? "yes" : "no"}. Spent ${usd(r.spentMicros)}.` : `No email found. Spent ${usd(r.spentMicros)}.`); router.refresh(); })}>Run for {usd(q.totalMicros)}</Btn>
            <Btn onClick={() => setQ(null)}>Cancel</Btn>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-12 text-link">{msg}</p>}
      <ErrorNote message={b.error} />
    </div>
  );
}
