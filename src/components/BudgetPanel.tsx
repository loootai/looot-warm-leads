import { usd } from "@/engine/money";
import type { BudgetStatus, PeriodStatus } from "@/engine/budget";
import { Bar } from "./chips";

function Period({ label, p }: { label: string; p: PeriodStatus }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-13 font-medium">{label}</h3>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Budget", usd(p.limitMicros)],
          ["Used", usd(p.usedMicros)],
          ["Reserved", usd(p.reservedMicros)],
          ["Remaining", usd(p.remainingMicros)],
        ].map(([k, v]) => (
          <div key={k}><dt className="text-12 text-mute">{k}</dt><dd className="num text-20 font-medium">{v}</dd></div>
        ))}
      </dl>
      <Bar value={p.usedMicros + p.reservedMicros} max={p.limitMicros} />
    </div>
  );
}

/** Used, reserved and remaining against the daily and monthly budget. */
export function BudgetPanel({ status }: { status: BudgetStatus }) {
  return (
    <section aria-label="Budget" className="grid gap-4 rounded-panel border border-line bg-panel p-4">
      <h2 className="text-16 font-medium">Budget</h2>
      <Period label="Today (UTC)" p={status.day} />
      <Period label="This month (UTC)" p={status.month} />
      <p className="text-12 text-mute">
        Reserved is money held for calls that are running or whose result has not come back. It counts against the budget until the call ends, then becomes used at the real cost or goes back if the call failed.
        {status.isDefault && " These are the default limits. The owner can change them below."}
      </p>
    </section>
  );
}
