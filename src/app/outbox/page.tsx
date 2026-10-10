import { OutboxPanel, type OutboxRow, type OutboxView } from "@/components/OutboxPanel";
import { checksToday, inWorkingHours, sentToday, textHash } from "@/sender/outbox";
import { accountId, makeCtx, plan } from "@/server/service";
import { unipileConfigured } from "@/sender/unipile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outbox" };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function OutboxPage() {
  const ctx = await makeCtx();
  const cfg = ctx.getConfig();
  const state = ctx.read();
  const now = ctx.now();
  const p = plan(ctx);
  const wh = cfg.outbox.workingHours;
  const rows: OutboxRow[] = state.sender.items.map((i) => ({ id: i.id, leadId: i.leadId, leadName: state.leads[i.leadId]?.name ?? "(erased)", step: i.step, status: i.status, text: i.text, hash: textHash(i.text), message: i.message, notBefore: i.notBefore, sentAt: i.sentAt }));
  const view: OutboxView = {
    paused: state.sender.paused,
    demo: ctx.demo,
    configured: unipileConfigured(ctx.env),
    dryRun: cfg.outbox.dryRun,
    accountConnected: Boolean(accountId(ctx, state)),
    caps: { invites: [sentToday(state, "invite", now, cfg), cfg.outbox.dailyInvites], messages: [sentToday(state, "followup", now, cfg), cfg.outbox.dailyMessages], checks: [checksToday(state, now, cfg)] as unknown as [number, number] },
    window: `${wh.days.map((d) => DAYS[d]).join(", ")} ${String(wh.start).padStart(2, "0")}:00 to ${String(wh.end).padStart(2, "0")}:00 (UTC${wh.utcOffsetMinutes >= 0 ? "+" : ""}${wh.utcOffsetMinutes / 60})`,
    inWindow: inWorkingHours(now, cfg),
    gap: `${cfg.outbox.minGapSeconds} to ${cfg.outbox.maxGapSeconds} s`,
    nextReason: p.reason,
    nextText: p.item ? `${p.item.step === "invite" ? "Connection request" : "Follow-up"} to ${state.leads[p.item.leadId]?.name}: ${p.item.text}` : undefined,
    dncCount: state.sender.dnc.length,
  };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-20 font-medium">LinkedIn outbox</h1>
        <p className="text-13 text-mute">
          Optional. Messages go through Unipile with your own LinkedIn account. Nothing sends without your approval of the exact text, caps and spacing apply, and a reply stops the sequence.{" "}
          {ctx.demo ? "Demo mode uses a stand-in client that sends nothing." : "Sending volume is your responsibility under LinkedIn's terms."}
        </p>
      </div>
      <OutboxPanel rows={rows} view={view} />
    </div>
  );
}
