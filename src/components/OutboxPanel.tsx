"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, RefreshCw, ShieldCheck, Link2 } from "lucide-react";
import { Pill } from "./chips";
import { Btn, ErrorNote, Field, Panel, act, inputCls, useBusy } from "./ui";

export interface OutboxRow {
  id: string;
  leadId: string;
  leadName: string;
  step: "invite" | "followup";
  status: string;
  text: string;
  hash: string;
  message?: string;
  notBefore?: string;
  sentAt?: string;
}

export interface OutboxView {
  paused: boolean;
  demo: boolean;
  configured: boolean;
  dryRun: boolean;
  accountConnected: boolean;
  caps: { invites: [number, number]; messages: [number, number]; checks: [number, number] };
  window: string;
  inWindow: boolean;
  gap: string;
  nextReason: string;
  nextText?: string;
  /** The item a live send would send, and the hash of the text on screen. */
  nextItemId?: string;
  nextHash?: string;
  dncCount: number;
}

const TONE: Record<string, "low" | "amber" | "high" | "brand"> = { draft: "low", approved: "amber", sending: "amber", sent: "brand", failed: "high", unknown: "high", cancelled: "low", skipped: "low" };

/** The review-and-approve queue for LinkedIn sends through Unipile, with the safety settings in view. */
export function OutboxPanel({ rows, view }: { rows: OutboxRow[]; view: OutboxView }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [dnc, setDnc] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const b = useBusy();
  const refresh = () => router.refresh();
  const pending = rows.filter((r) => r.status === "draft" || r.status === "approved");
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="space-y-4">
      <Panel title="Sender status" aside={<div className="flex gap-2">
        <Btn disabled={b.busy} onClick={() => b.run(async () => { await act("pause", { paused: !view.paused }); refresh(); })}>{view.paused ? <><Play size={14} />Resume sending</> : <><Pause size={14} />Pause everything</>}</Btn>
      </div>}>
        <dl className="grid grid-cols-2 gap-3 text-13 sm:grid-cols-4">
          <div><dt className="text-12 text-mute">Switch</dt><dd>{view.paused ? <Pill tone="high">paused</Pill> : <Pill tone="brand">running</Pill>}</dd></div>
          <div><dt className="text-12 text-mute">Mode</dt><dd>{view.demo ? <Pill tone="amber">demo, nothing leaves</Pill> : view.dryRun ? <Pill tone="amber">dry run</Pill> : <Pill tone="brand">live</Pill>}</dd></div>
          <div><dt className="text-12 text-mute">Unipile</dt><dd>{view.demo ? "demo client" : !view.configured ? "not configured" : view.accountConnected ? "account connected" : "no account connected"}</dd></div>
          <div><dt className="text-12 text-mute">Do-not-contact</dt><dd className="num">{view.dncCount}</dd></div>
          <div><dt className="text-12 text-mute">Invitations today</dt><dd className="num">{view.caps.invites[0]} of {view.caps.invites[1]}</dd></div>
          <div><dt className="text-12 text-mute">Follow-ups today</dt><dd className="num">{view.caps.messages[0]} of {view.caps.messages[1]}</dd></div>
          <div><dt className="text-12 text-mute">Working hours</dt><dd>{view.window} {view.inWindow ? <Pill tone="brand">open</Pill> : <Pill>closed</Pill>}</dd></div>
          <div><dt className="text-12 text-mute">Gap between sends</dt><dd>{view.gap}, random</dd></div>
        </dl>
        <p className="mt-3 text-12 text-mute">Next send: {view.nextText ? "ready (see below)" : view.nextReason}</p>
        {view.nextText && <pre className="mt-1 whitespace-pre-wrap rounded-control bg-page p-2 text-12">{view.nextText}</pre>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn disabled={b.busy} onClick={() => b.run(async () => { const r = await act<{ action: string; reason: string }>("tick", { live: false }); setMsg(`Dry run: ${r.reason}`); })}><ShieldCheck size={14} />Preview next send</Btn>
          <Btn tone="primary" disabled={b.busy || view.demo || view.dryRun || !view.configured || !view.accountConnected || view.paused || !view.nextItemId} title={view.dryRun ? "Turn on live sending first" : undefined} onClick={() => { if (confirm("Send the next approved item through Unipile now?")) void b.run(async () => { const r = await act<{ action: string; reason: string }>("tick", { live: true, itemId: view.nextItemId, hash: view.nextHash }); setMsg(`${r.action}: ${r.reason}`); refresh(); }); }}>Send next now</Btn>
          <Btn disabled={b.busy || !(view.demo || view.accountConnected)} onClick={() => b.run(async () => { const r = await act<{ replies: number; accepted: number; checks: number }>("sync"); setMsg(`${r.replies} new replies, ${r.accepted} accepted invitations, ${r.checks} profile checks.`); refresh(); })}><RefreshCw size={14} />Check replies</Btn>
          {!view.demo && <Btn tone={view.dryRun ? undefined : "danger"} disabled={b.busy} title={view.dryRun ? "Needs an admin password. Recorded in the audit log." : "Recorded in the audit log."} onClick={() => { if (confirm(view.dryRun ? "Turn on live sending? Approved items will then go to LinkedIn through Unipile when you press Send next now." : "Turn live sending off?")) void b.run(async () => { await act("setLiveSend", { live: view.dryRun }); refresh(); }); }}>{view.dryRun ? "Turn on live sending" : "Turn live sending off"}</Btn>}
          <Btn disabled={b.busy} onClick={() => b.run(async () => { const r = await act<{ url: string | null; message?: string }>("connect"); setLink(r.url ?? r.message ?? null); })}><Link2 size={14} />Connect LinkedIn on Unipile</Btn>
        </div>
        {link && <p className="mt-2 break-all text-12">{link.startsWith("http") ? <>Sign in on Unipile&apos;s page: <a className="text-link underline" href={link}>{link}</a></> : link}</p>}
        {msg && <p className="mt-2 text-12 text-link">{msg}</p>}
        <ErrorNote message={b.error} />
      </Panel>

      <Panel title="Queue" aside={<div className="flex gap-2">
        <Btn tone="primary" disabled={b.busy || [...sel].filter((id) => pending.some((p) => p.id === id)).length === 0} onClick={() => b.run(async () => { const reviewed = Object.fromEntries(rows.filter((r) => sel.has(r.id)).map((r) => [r.id, r.hash])); const r = await act<{ approved: string[]; refused: { id: string; reason: string }[] }>("approve", { reviewed }); setMsg(`Approved ${r.approved.length}.${r.refused.length ? ` Refused ${r.refused.length}: ${r.refused[0].reason}` : ""}`); setSel(new Set()); refresh(); })}>Approve selected</Btn>
        <Btn disabled={b.busy || sel.size === 0} onClick={() => b.run(async () => { await act("cancel", { ids: [...sel] }); setSel(new Set()); refresh(); })}>Cancel selected</Btn>
      </div>}>
        <p className="mb-2 text-12 text-mute">Approving covers exactly the text shown here. If you edit a draft later, the approval is void. Follow-ups wait for the invitation to be accepted, then for the delay in the config.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-12">
            <thead className="text-mute"><tr><th className="w-8 py-1" /><th className="py-1 pr-3 font-medium">Lead</th><th className="py-1 pr-3 font-medium">Step</th><th className="py-1 pr-3 font-medium">Status</th><th className="py-1 font-medium">Text</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="py-2"><input type="checkbox" aria-label={`Select ${r.leadName} ${r.step}`} disabled={!["draft", "approved", "failed"].includes(r.status)} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="py-2 pr-3"><Link href={`/leads/${r.leadId}`} className="font-medium text-link hover:underline">{r.leadName}</Link></td>
                  <td className="py-2 pr-3">{r.step === "invite" ? "Connection request" : "Follow-up"}</td>
                  <td className="py-2 pr-3"><Pill tone={TONE[r.status] ?? "low"}>{r.status}</Pill>{r.sentAt && <div className="mt-0.5 text-11 text-faint">{r.sentAt.slice(0, 16).replace("T", " ")}</div>}{r.notBefore && r.status === "approved" && <div className="mt-0.5 text-11 text-faint">not before {r.notBefore.slice(0, 16).replace("T", " ")}</div>}{r.message && <div className="mt-0.5 text-11 text-amber">{r.message}</div>}
                    {r.status === "unknown" && <div className="mt-1 flex gap-1"><Btn className="h-6 px-2 text-11" onClick={() => b.run(async () => { await act("unknown", { id: r.id, mode: "confirm" }); refresh(); })}>It went out</Btn><Btn className="h-6 px-2 text-11" onClick={() => b.run(async () => { await act("unknown", { id: r.id, mode: "retry" }); refresh(); })}>It did not</Btn></div>}</td>
                  <td className="whitespace-pre-wrap py-2">{r.text}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-mute">Nothing queued. Pick leads in the inbox and choose Add to outbox.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Do-not-contact list">
        <div className="flex items-end gap-2">
          <div className="flex-1"><Field label="LinkedIn URL, email or company domain"><input value={dnc} onChange={(e) => setDnc(e.target.value)} className={inputCls} placeholder="https://www.linkedin.com/in/..." /></Field></div>
          <Btn disabled={b.busy || !dnc.trim()} onClick={() => b.run(async () => { await act("dnc", { value: dnc }); setDnc(""); setMsg("Added. Pending messages for that person were cancelled."); refresh(); })}>Add</Btn>
        </div>
        <p className="mt-2 text-11 text-faint">Only a hash is stored, so the list itself holds no personal data.</p>
      </Panel>
    </div>
  );
}
