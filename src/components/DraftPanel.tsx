"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Send } from "lucide-react";
import { Pill } from "./chips";
import { Btn, ErrorNote, Field, Panel, act, inputCls, useBusy } from "./ui";

export interface DraftView {
  connectionNote: string;
  followUp: string;
  emailSubject: string;
  emailBody: string;
  by: string;
  signalRef: string;
  warnings: string[];
  edited: boolean;
}

/** Edit the drafted messages for one lead. Saving never sends. "Add to outbox" creates drafts in the outbox for review. */
export function DraftPanel({ leadId, draft, noteMax, canQueue, queuedState }: { leadId: string; draft: DraftView; noteMax: number; canQueue: boolean; queuedState?: string }) {
  const router = useRouter();
  const [d, setD] = useState(draft);
  const [msg, setMsg] = useState<string | null>(null);
  const b = useBusy();
  const set = (k: keyof DraftView) => (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  const save = () => b.run(async () => { await act("saveDraft", { leadId, patch: { connectionNote: d.connectionNote, followUp: d.followUp, emailSubject: d.emailSubject, emailBody: d.emailBody } }); setMsg("Saved. An edit voids any approval, so approve again on the Outbox page."); router.refresh(); });
  const over = d.connectionNote.length > noteMax;
  return (
    <Panel title="Message drafts" aside={<span className="flex gap-1">{d.by === "llm" ? <Pill tone="amber">LLM rewrite</Pill> : <Pill>template</Pill>}{d.edited && <Pill tone="brand">edited</Pill>}</span>}>
      <p className="mb-3 text-12 text-mute">Refers to: {d.signalRef || "no signal"}</p>
      <div className="space-y-3">
        <Field label="Connection note" hint={`${d.connectionNote.length} of ${noteMax} characters`}>
          <textarea rows={3} value={d.connectionNote} onChange={set("connectionNote")} className={`${inputCls} ${over ? "border-high" : ""}`} />
        </Field>
        <Field label="Follow-up after acceptance"><textarea rows={3} value={d.followUp} onChange={set("followUp")} className={inputCls} /></Field>
        <Field label="Email subject"><input value={d.emailSubject} onChange={set("emailSubject")} className={inputCls} /></Field>
        <Field label="Email body"><textarea rows={7} value={d.emailBody} onChange={set("emailBody")} className={inputCls} /></Field>
      </div>
      {d.warnings.map((w) => <p key={w} className="mt-2 text-12 text-amber">{w}</p>)}
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn disabled={b.busy} onClick={save}><Save size={14} />Save edits</Btn>
        <Btn tone="primary" disabled={b.busy || !canQueue || over} title={canQueue ? undefined : "Connect Unipile or use demo mode"} onClick={() => b.run(async () => { await save(); const r = await act<{ queued: string[]; refused: { reason: string }[] }>("queue", { ids: [leadId] }); setMsg(r.queued.length ? "Queued as drafts. Review and approve on the Outbox page. Nothing has been sent." : `Not queued: ${r.refused[0]?.reason}`); router.refresh(); })}><Send size={14} />Add to outbox</Btn>
        {queuedState && <Pill tone="amber">outbox: {queuedState}</Pill>}
      </div>
      {msg && <p className="mt-2 text-12 text-link">{msg}</p>}
      <ErrorNote message={b.error} />
    </Panel>
  );
}
