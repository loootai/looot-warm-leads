"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { adminFetch } from "./adminFetch";

/** Posts one action to the app's API and returns its data. Throws the server's message on failure. */
export async function act<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await adminFetch("/api/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  const j = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!j.ok) throw new Error(j.error ?? "Request failed");
  return j.data as T;
}

/** Runs an async action with a busy flag and an error message. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

export function Panel({ title, aside, children, className }: { title?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-panel border border-line bg-panel p-4", className)}>
      {(title || aside) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-16 font-medium">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "ghost" | "danger" };
export function Btn({ tone = "ghost", className, ...p }: BtnProps) {
  const t = { primary: "bg-brand text-brand-ink hover:opacity-90", ghost: "border border-line-strong bg-panel text-ink hover:bg-hover", danger: "border border-line-strong bg-panel text-high hover:bg-high-soft" }[tone];
  return <button type="button" {...p} className={cn("inline-flex h-8 items-center gap-1.5 rounded-control px-3 text-13 font-medium disabled:opacity-50", t, className)} />;
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? <p role="alert" className="mt-2 rounded-control bg-high-soft px-2 py-1.5 text-12 text-high">{message}</p> : null;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-12 font-medium text-mute">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-11 text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls = "mt-1 block w-full rounded-control border border-line-strong bg-page px-2 py-1.5 text-13 text-ink";
