import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Bar, BandChip, EmailChip, ago } from "@/components/chips";
import { DraftPanel } from "@/components/DraftPanel";
import { LeadActions } from "@/components/LeadActions";
import { Panel } from "@/components/ui";
import { usd, usdPrecise } from "@/engine/money";
import { makeCtx, senderEnabled } from "@/server/service";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const ctx = await makeCtx();
  const cfg = ctx.getConfig();
  const state = ctx.read();
  const lead = state.leads[id];
  if (!lead) notFound();
  const now = ctx.now();
  const items = state.sender.items.filter((i) => i.leadId === id);
  const intent = lead.breakdown.filter((b) => b.type === "intent");
  const fit = lead.breakdown.filter((b) => b.type === "fit");
  const events = [...lead.events].sort((a, b) => (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0));
  return (
    <div className="space-y-4">
      <Link href="/" className="text-12 text-mute hover:underline">Back to the list</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-20 font-medium">{lead.name}</h1>
          <p className="text-13 text-mute">{[lead.title, lead.company].filter(Boolean).join(" at ")}{lead.location ? `, ${lead.location}` : ""}</p>
          <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-12 text-link hover:underline">LinkedIn profile <ExternalLink size={12} /></a>
        </div>
        <div className="w-44">
          <div className="flex items-center justify-between"><span className="num text-20 font-medium">{lead.score}</span><BandChip band={lead.band} /></div>
          <Bar value={lead.score} max={100} className="mt-1" />
          <p className="mt-1 text-11 text-mute">Fit {lead.fitPoints} of {cfg.scoring.fitMax}, intent {lead.intentPoints} of {cfg.scoring.intentMax}</p>
        </div>
      </div>

      <Panel title="Why this score">
        <ul className="mb-3 space-y-1 text-13">{lead.reasons.map((r) => <li key={r}>{r}</li>)}{lead.reasons.length === 0 && <li className="text-mute">No signal earned points.</li>}</ul>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-12">
            <thead className="text-mute"><tr><th className="py-1 pr-3 font-medium">Signal or criterion</th><th className="py-1 pr-3 font-medium">Provider</th><th className="py-1 pr-3 text-right font-medium">Weight</th><th className="py-1 pr-3 text-right font-medium">Points</th><th className="py-1 pr-3 font-medium">Date</th><th className="py-1 pr-3 text-right font-medium">Cost</th><th className="py-1 font-medium">Evidence</th></tr></thead>
            <tbody>
              {intent.map((b) => (
                <tr key={b.key} className="border-t border-line align-top">
                  <td className="py-1.5 pr-3"><div className="font-medium">{b.label}</div><div className="text-mute">{b.summary}</div></td>
                  <td className="py-1.5 pr-3 text-mute">{b.provider}</td>
                  <td className="num py-1.5 pr-3 text-right">{b.maxPoints}</td>
                  <td className="num py-1.5 pr-3 text-right font-medium">{b.points}</td>
                  <td className="py-1.5 pr-3 text-mute">{b.date ? b.date.slice(0, 10) : "undated"}</td>
                  <td className="num py-1.5 pr-3 text-right">{usdPrecise(b.costMicros)}</td>
                  <td className="py-1.5">{b.evidence.map((e, i) => <a key={e.url} href={e.url} target="_blank" rel="noreferrer" className="mr-2 text-link hover:underline">link {i + 1}</a>)}</td>
                </tr>
              ))}
              {fit.map((b) => (
                <tr key={b.key} className="border-t border-line align-top">
                  <td className="py-1.5 pr-3"><div className="font-medium">Fit: {b.label}</div><div className="text-mute">{b.summary}</div></td>
                  <td className="py-1.5 pr-3 text-mute">{b.provider}</td>
                  <td className="num py-1.5 pr-3 text-right">{b.maxPoints}</td>
                  <td className="num py-1.5 pr-3 text-right font-medium">{b.points}</td>
                  <td className="py-1.5 pr-3 text-mute">-</td><td className="num py-1.5 pr-3 text-right">-</td><td />
                </tr>
              ))}
              <tr className="border-t border-line-strong"><td className="py-1.5 pr-3 font-medium" colSpan={3}>Fit points are scaled to the {cfg.scoring.fitMax} maximum; intent is capped at {cfg.scoring.intentMax}</td><td className="num py-1.5 pr-3 text-right font-medium">{lead.score}</td><td /><td className="num py-1.5 pr-3 text-right font-medium">{usdPrecise(lead.costMicros)}</td><td /></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-11 text-faint">Cost: each paid call is split across the events it produced. Profile and company reads for the fit data cost {usd(lead.enrichCostMicros)}. {lead.enriched ? "" : "The profile could not be read, so fit uses only the headline."}</p>
      </Panel>

      <Panel title="Signal evidence">
        <ul className="space-y-2 text-13">
          {events.map((e, i) => (
            <li key={`${e.kind}${i}`} className="border-t border-line pt-2 first:border-0 first:pt-0">
              <div className="font-medium">{e.title}</div>
              <div className="text-12 text-mute">{ago(e.date, now)} · {e.provider} · {e.endpointId}{e.url && <> · <a href={e.url} target="_blank" rel="noreferrer" className="text-link hover:underline">open</a></>}</div>
              {e.snippet && <blockquote className="mt-1 border-l-2 border-line-strong pl-2 text-12 text-mute">{e.snippet}</blockquote>}
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Company and email">
          <dl className="grid grid-cols-2 gap-2 text-13">
            <div><dt className="text-12 text-mute">Company</dt><dd>{lead.company ?? "unknown"}</dd></div>
            <div><dt className="text-12 text-mute">Domain</dt><dd>{lead.companyDomain ?? "unknown"}</dd></div>
            <div><dt className="text-12 text-mute">Industry</dt><dd>{lead.industry ?? "unknown"}</dd></div>
            <div><dt className="text-12 text-mute">Headcount</dt><dd>{lead.companySize ?? "unknown"}</dd></div>
            <div className="col-span-2"><dt className="text-12 text-mute">Work email</dt><dd className="flex items-center gap-2">{lead.email?.address ?? "not looked up"} <EmailChip status={lead.email?.status} deliverable={lead.email?.deliverable} pending={lead.email?.pending} /></dd>{lead.email && <dd className="text-11 text-faint">Found by {lead.email.findProvider}, checked by {lead.email.verifyProvider}, cost {usdPrecise(lead.email.costMicros)}</dd>}</div>
          </dl>
          <div className="mt-3"><LeadActions leadId={lead.id} linkedinUrl={lead.linkedinUrl} hasEmail={Boolean(lead.email && !lead.email.pending)} /></div>
        </Panel>
        <Panel title="Replies">
          {lead.replies.length === 0 && <p className="text-13 text-mute">No replies recorded. A reply stops any pending steps for this lead.</p>}
          <ul className="space-y-2">{lead.replies.map((r) => <li key={r.messageId ?? r.at} className="rounded-control bg-brand-soft p-2 text-13"><div className="text-11 text-mute">{ago(r.at, now)}</div>{r.text}</li>)}</ul>
          {items.length > 0 && <div className="mt-3 text-12 text-mute">Outbox: {items.map((i) => `${i.step} ${i.status}`).join(", ")}</div>}
        </Panel>
      </div>

      {lead.drafts && <DraftPanel leadId={lead.id} noteMax={cfg.messages.noteMax} canQueue={senderEnabled(ctx)} queuedState={items.length ? items.map((i) => i.status).join(", ") : undefined} draft={{ connectionNote: lead.drafts.connectionNote, followUp: lead.drafts.followUp, emailSubject: lead.drafts.email.subject, emailBody: lead.drafts.email.body, by: lead.drafts.by, signalRef: lead.drafts.signalRef, warnings: lead.drafts.warnings, edited: lead.drafts.edited }} />}
    </div>
  );
}
