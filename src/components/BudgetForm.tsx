"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminFetch } from "@/components/adminFetch";

const inputCls = "num w-full rounded-control border border-line-strong bg-page px-2 py-1.5 text-13";

/** The owner sets the daily and monthly budget in dollars. A run request cannot carry these values. */
export function BudgetForm({ dailyUsd, monthlyUsd, disabled }: { dailyUsd: number; monthlyUsd: number; disabled: boolean }) {
  const router = useRouter();
  const [daily, setDaily] = useState(String(dailyUsd));
  const [monthly, setMonthly] = useState(String(monthlyUsd));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch("/api/budget", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dailyUsd: Number(daily), monthlyUsd: Number(monthly) }) });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMsg({ ok: true, text: "Budget saved." });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3 rounded-panel border border-line bg-panel p-4" aria-label="Change the budget">
      <h2 className="text-16 font-medium">Change the budget</h2>
      <div className="grid max-w-md grid-cols-2 gap-3">
        <label className="grid gap-1"><span className="text-12 font-medium text-mute">Daily, dollars</span><input type="number" min="0.01" step="0.01" value={daily} onChange={(e) => setDaily(e.target.value)} disabled={disabled} className={inputCls} /></label>
        <label className="grid gap-1"><span className="text-12 font-medium text-mute">Monthly, dollars</span><input type="number" min="0.01" step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} disabled={disabled} className={inputCls} /></label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || disabled} className="rounded-control bg-brand px-3 py-1.5 font-medium text-brand-ink hover:opacity-90 disabled:opacity-40">Save budget</button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-12 text-mute" : "text-12 text-high"}>{msg.text}</p>}
      </div>
      <p className="text-12 text-mute">
        {disabled ? "Demo mode has no budget to change." : "Only the signed-in owner can change this. A run request cannot raise it. The daily budget cannot be above the monthly one. The looot token balance is the final limit, so fund a token with only what you are willing to spend."}
      </p>
    </form>
  );
}
