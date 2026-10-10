import { cn } from "@/lib/cn";
import type { Band } from "@/engine/types";

const BAND: Record<Band, string> = { hot: "bg-brand text-brand-ink", warm: "bg-brand-soft text-link", cool: "bg-low-soft text-low" };

/** hot, warm or cool as a pill. */
export function BandChip({ band }: { band: Band }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-12 font-medium", BAND[band])}>{band}</span>;
}

/** A horizontal bar for a value out of a maximum. */
export function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-hover", className)} role="presentation">
      <div className="h-full rounded-full bg-emerald" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Pill({ children, tone = "low" }: { children: React.ReactNode; tone?: "low" | "amber" | "high" | "brand" }) {
  const t = { low: "bg-low-soft text-low", amber: "bg-amber-soft text-amber", high: "bg-high-soft text-high", brand: "bg-brand-soft text-link" }[tone];
  return <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-11 font-medium", t)}>{children}</span>;
}

export function EmailChip({ status, deliverable, pending }: { status?: string; deliverable?: boolean; pending?: boolean }) {
  if (!status) return <span className="text-12 text-faint">not looked up</span>;
  if (pending) return <Pill tone="amber">pending</Pill>;
  if (deliverable) return <Pill tone="brand">verified</Pill>;
  return <Pill tone={status === "not_found" || status === "invalid" ? "high" : "amber"}>{status.replace("_", " ")}</Pill>;
}

export function ago(date: string | null | undefined, now: Date): string {
  if (!date) return "undated";
  const d = Math.round((now.getTime() - Date.parse(date)) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
}
