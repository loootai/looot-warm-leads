"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, X } from "lucide-react";
import type { WarmConfig } from "@/engine/config";
import { SIGNAL_KINDS } from "@/engine/types";
import { Btn, ErrorNote, Field, Panel, act, inputCls, useBusy } from "./ui";

function useConfig(initial: WarmConfig) {
  const router = useRouter();
  const [cfg, setCfg] = useState(initial);
  const [saved, setSaved] = useState(false);
  const b = useBusy();
  const save = () => b.run(async () => { await act("saveConfig", { config: cfg }); setSaved(true); router.refresh(); });
  const edit = (fn: (c: WarmConfig) => void) => { const c = structuredClone(cfg); fn(c); setCfg(c); setSaved(false); };
  return { cfg, edit, save, saved, b };
}

const lines = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

function SaveBar({ onSave, saved, b }: { onSave: () => void; saved: boolean; b: ReturnType<typeof useBusy> }) {
  return (
    <div className="flex items-center gap-3">
      <Btn tone="primary" disabled={b.busy} onClick={onSave}><Save size={14} />Save</Btn>
      {saved && <span className="text-12 text-link">Saved. The next run uses these settings.</span>}
      <ErrorNote message={b.error} />
    </div>
  );
}

function NameUrlList({ title, hint, rows, onChange, namePh, urlPh }: { title: string; hint: string; rows: { name: string; linkedinUrl: string }[]; onChange: (r: { name: string; linkedinUrl: string }[]) => void; namePh: string; urlPh: string }) {
  return (
    <Panel title={title} aside={<Btn onClick={() => onChange([...rows, { name: "", linkedinUrl: "" }])}><Plus size={14} />Add</Btn>}>
      <p className="mb-2 text-12 text-mute">{hint}</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input aria-label={`${title} name`} placeholder={namePh} value={r.name} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={`${inputCls} mt-0 w-1/3`} />
            <input aria-label={`${title} LinkedIn URL`} placeholder={urlPh} value={r.linkedinUrl} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, linkedinUrl: e.target.value } : x)))} className={`${inputCls} mt-0 flex-1`} />
            <Btn aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}><X size={14} /></Btn>
          </div>
        ))}
        {rows.length === 0 && <p className="text-12 text-faint">None yet.</p>}
      </div>
    </Panel>
  );
}

function StringList({ title, hint, rows, onChange, ph }: { title: string; hint: string; rows: string[]; onChange: (r: string[]) => void; ph: string }) {
  return (
    <Panel title={title} aside={<Btn onClick={() => onChange([...rows, ""])}><Plus size={14} />Add</Btn>}>
      <p className="mb-2 text-12 text-mute">{hint}</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input aria-label={title} placeholder={ph} value={r} onChange={(e) => onChange(rows.map((x, j) => (j === i ? e.target.value : x)))} className={`${inputCls} mt-0 flex-1`} />
            <Btn aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}><X size={14} /></Btn>
          </div>
        ))}
        {rows.length === 0 && <p className="text-12 text-faint">None yet.</p>}
      </div>
    </Panel>
  );
}

/** Signal source setup: competitor pages, creators, keywords, watched posts, and the optional triggers. */
export function SourcesEditor({ initial }: { initial: WarmConfig }) {
  const { cfg, edit, save, saved, b } = useConfig(initial);
  return (
    <div className="space-y-4">
      <NameUrlList title="Competitor company pages" hint="People who comment on or react to recent posts from these pages are the strongest signal." rows={cfg.sources.competitors} onChange={(r) => edit((c) => void (c.sources.competitors = r))} namePh="Name" urlPh="https://www.linkedin.com/company/..." />
      <NameUrlList title="Creators" hint="Named people whose audience is your market. Their commenters and reactors count." rows={cfg.sources.creators} onChange={(r) => edit((c) => void (c.sources.creators = r))} namePh="Name" urlPh="https://www.linkedin.com/in/..." />
      <StringList title="Keywords and topics" hint="Posts matching these are searched. The authors count as people posting about the topic; commenters and reactors on the top posts count too." rows={cfg.sources.keywords} onChange={(r) => edit((c) => void (c.sources.keywords = r))} ph="product-led growth" />
      <StringList title="Watched posts" hint="Specific LinkedIn post URLs. Their commenters and reactors are read once per run." rows={cfg.sources.posts} onChange={(r) => edit((c) => void (c.sources.posts = r))} ph="https://www.linkedin.com/posts/..." />
      <Panel title="Triggers">
        <div className="space-y-2 text-13">
          {([["newRole", "New role in the last N days, read from the profile (no extra call)"], ["hiring", "Company is hiring for a related role (PredictLeads, $0.01 per company)"], ["funding", "Company raised funding recently (PredictLeads, $0.01 per company)"]] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={cfg.triggers[k]} onChange={(e) => edit((c) => void (c.triggers[k] = e.target.checked))} />{label}</label>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Look-back (days)"><input type="number" min={1} value={cfg.limits.lookbackDays} onChange={(e) => edit((c) => void (c.limits.lookbackDays = Number(e.target.value)))} className={inputCls} /></Field>
          <Field label="Top posts per source read for engagers"><input type="number" min={0} value={cfg.limits.engagementPostsPerSource} onChange={(e) => edit((c) => void (c.limits.engagementPostsPerSource = Number(e.target.value)))} className={inputCls} /></Field>
          <Field label="Profiles read per run, at most"><input type="number" min={0} value={cfg.limits.maxEnrich} onChange={(e) => edit((c) => void (c.limits.maxEnrich = Number(e.target.value)))} className={inputCls} /></Field>
        </div>
      </Panel>
      <SaveBar onSave={save} saved={saved} b={b} />
    </div>
  );
}

/** ICP editor, scoring weights and the sender text used by message templates. */
export function IcpEditor({ initial }: { initial: WarmConfig }) {
  const { cfg, edit, save, saved, b } = useConfig(initial);
  const list = (k: "titles" | "excludeTitles" | "seniority" | "industries" | "countries", label: string, hint: string) => (
    <Field label={label} hint={hint}><textarea rows={2} value={cfg.icp[k].join(", ")} onChange={(e) => edit((c) => void (c.icp[k] = lines(e.target.value)))} className={inputCls} /></Field>
  );
  return (
    <div className="space-y-4">
      <Panel title="Ideal customer profile">
        <div className="space-y-3">
          <Field label="Description"><textarea rows={2} value={cfg.icp.description} onChange={(e) => edit((c) => void (c.icp.description = e.target.value))} className={inputCls} /></Field>
          {list("titles", "Job titles that fit", "Comma separated. Matched as whole words in the title.")}
          {list("seniority", "Seniority terms", "For example head of, vp, director.")}
          {list("excludeTitles", "Titles to leave out", "A match removes the person from the list.")}
          {list("industries", "Industries", "Matched against the company's LinkedIn industry. Empty means not scored.")}
          {list("countries", "Countries or places", "Matched against the profile location. Empty means not scored.")}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company size, min"><input type="number" min={0} value={cfg.icp.companySize.min} onChange={(e) => edit((c) => void (c.icp.companySize.min = Number(e.target.value)))} className={inputCls} /></Field>
            <Field label="Company size, max" hint="0 means not scored."><input type="number" min={0} value={cfg.icp.companySize.max} onChange={(e) => edit((c) => void (c.icp.companySize.max = Number(e.target.value)))} className={inputCls} /></Field>
          </div>
        </div>
      </Panel>
      <Panel title="Score weights" aside={<span className="text-12 text-mute">Same values as config/warm.config.json</span>}>
        <div className="mb-3 grid gap-3 sm:grid-cols-5">
          {([["fitMax", "Fit maximum"], ["intentMax", "Intent maximum"], ["hotAt", "Hot from"], ["warmAt", "Warm from"], ["listMinScore", "Hide below"]] as const).map(([k, label]) => (
            <Field key={k} label={label}><input type="number" value={cfg.scoring[k]} onChange={(e) => edit((c) => void (c.scoring[k] = Number(e.target.value)))} className={inputCls} /></Field>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-12">
            <thead className="text-mute"><tr><th className="py-1 pr-3 font-medium">Signal</th><th className="py-1 pr-3 font-medium">Max points</th><th className="py-1 font-medium">Half-life, days</th></tr></thead>
            <tbody>
              {SIGNAL_KINDS.map((k) => (
                <tr key={k} className="border-t border-line">
                  <td className="py-1 pr-3">{cfg.scoring.signals[k].label}</td>
                  <td className="py-1 pr-3"><input aria-label={`${k} weight`} type="number" min={0} value={cfg.scoring.signals[k].weight} onChange={(e) => edit((c) => void (c.scoring.signals[k].weight = Number(e.target.value)))} className={`${inputCls} mt-0 w-20`} /></td>
                  <td className="py-1"><input aria-label={`${k} half-life`} type="number" min={1} value={cfg.scoring.signals[k].halfLifeDays} onChange={(e) => edit((c) => void (c.scoring.signals[k].halfLifeDays = Number(e.target.value)))} className={`${inputCls} mt-0 w-20`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="About you, for message drafts">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Your name"><input value={cfg.sender.name} onChange={(e) => edit((c) => void (c.sender.name = e.target.value))} className={inputCls} /></Field>
          <Field label="Your company"><input value={cfg.sender.company} onChange={(e) => edit((c) => void (c.sender.company = e.target.value))} className={inputCls} /></Field>
          <Field label="What you do, one phrase"><input value={cfg.sender.offer} onChange={(e) => edit((c) => void (c.sender.offer = e.target.value))} className={inputCls} /></Field>
        </div>
        <p className="mt-2 text-12 text-mute">Templates for each signal live in the config file under messages.templates, with the placeholders {"{first_name}"}, {"{company}"}, {"{signal_phrase}"}, {"{offer}"}, {"{topic}"}.</p>
      </Panel>
      <SaveBar onSave={save} saved={saved} b={b} />
    </div>
  );
}
