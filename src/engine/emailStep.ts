import type { WarmConfig } from "./config";
import { endpointFor, inputs, type EndpointDef } from "./endpoints";
import type { PriceMap, Runner } from "./looot";
import type { Ledger } from "./budget";
import { Meter } from "./meter";
import { findEmail, parseVerify } from "./parse";
import { shortHash } from "./run";
import type { EmailResult, Lead, Quote, QuoteLine } from "./types";

function defs(cfg: WarmConfig): { find: EndpointDef; verify: EndpointDef } {
  return { find: endpointFor("email_find", { emailFind: cfg.endpoints.emailFind }), verify: endpointFor("email_verify", { emailVerify: cfg.endpoints.emailVerify }) };
}

/** Endpoint ids the email step needs prices for. */
export function emailEndpointIds(cfg: WarmConfig): string[] {
  const d = defs(cfg);
  return [d.find.endpointId, d.verify.endpointId];
}

/**
 * Quote for finding and verifying emails for the picked leads. The verify call runs only when the finder returns an address,
 * so the quote is the upper bound. Leads that already have a verified result are not counted.
 */
export function emailQuote(leads: Lead[], cfg: WarmConfig, prices: PriceMap, priceSource: Quote["priceSource"] = "catalog"): Quote & { leads: number } {
  const d = defs(cfg);
  const todo = leads.filter((l) => !l.email || l.email.pending).length;
  const mk = (def: EndpointDef): QuoteLine => {
    const priceMicros = prices[def.endpointId] ?? def.fallbackMicros;
    return { endpointId: def.endpointId, jobId: def.jobId, provider: def.provider, label: def.label, calls: todo, priceMicros, totalMicros: priceMicros * todo };
  };
  const lines = [mk(d.find), mk(d.verify)];
  return { lines, totalMicros: lines.reduce((n, l) => n + l.totalMicros, 0), priceSource, leads: todo };
}

export interface EmailRunOptions {
  leads: Lead[];
  config: WarmConfig;
  looot: Runner;
  prices: PriceMap;
  unpriced?: readonly string[];
  capMicros: number;
  /** Period budget, reservations and stored answers. Left out in demo mode and in tests that do not need it. */
  ledger?: Ledger;
  now?: Date;
  demo?: boolean;
}

export interface EmailRunResult {
  spentMicros: number;
  skippedByCap: number;
  skippedByBudget: number;
  budgetMessage: string | null;
  pending: number;
  /** Updated results by lead id. */
  results: Record<string, EmailResult>;
  aborted: string | null;
}

/**
 * Finds then verifies a work email for each lead. Each call is metered against the cap and carries a stable idempotency key
 * of (lead, step), so a retry replays the stored run for free. A step still running is "pending", not a failure.
 */
export async function runEmails(o: EmailRunOptions): Promise<EmailRunResult> {
  const d = defs(o.config);
  const now = o.now ?? new Date();
  const meter = new Meter({ looot: o.looot, prices: o.prices, unpriced: o.unpriced, capMicros: o.capMicros, ledger: o.ledger, now: o.demo ? undefined : o.now, demo: o.demo });
  const results: Record<string, EmailResult> = {};
  for (const lead of o.leads) {
    if (lead.email && !lead.email.pending) continue;
    const key = (step: string, v: string) => `warm:v1:${step}:${shortHash(`${lead.id}:${v.trim().toLowerCase()}`, 16)}`;
    const findInput = inputs.emailFind(lead.linkedinUrl);
    const found = await meter.call(d.find, findInput, key(d.find.endpointId, lead.linkedinUrl));
    let cost = found.costMicros;
    // A call that was refused (cap, budget, price) did not run. Leave the lead as it was so a later run tries again.
    if (found.status === "skipped_cap" || found.status === "skipped_budget" || found.status === "skipped_price") continue;
    if (found.status === "pending") {
      results[lead.id] = { address: null, status: "pending", deliverable: false, findProvider: d.find.provider, verifyProvider: d.verify.provider, costMicros: cost, at: now.toISOString(), pending: true };
      continue;
    }
    const address = found.status === "ok" ? findEmail(found.result) : null;
    if (!address) {
      results[lead.id] = { address: null, status: found.status === "ok" ? "not_found" : "find_failed", deliverable: false, findProvider: d.find.provider, verifyProvider: d.verify.provider, costMicros: cost, at: now.toISOString() };
      continue;
    }
    const ver = await meter.call(d.verify, inputs.emailVerify(address), key(d.verify.endpointId, address));
    cost += ver.costMicros;
    if (ver.status === "skipped_cap" || ver.status === "skipped_budget" || ver.status === "skipped_price") {
      // The address is found and paid for. Keep it as pending so the next run only has to verify it (the find replays free).
      results[lead.id] = { address, status: "pending", deliverable: false, findProvider: d.find.provider, verifyProvider: d.verify.provider, costMicros: cost, at: now.toISOString(), pending: true };
      continue;
    }
    if (ver.status === "pending") {
      results[lead.id] = { address, status: "pending", deliverable: false, findProvider: d.find.provider, verifyProvider: d.verify.provider, costMicros: cost, at: now.toISOString(), pending: true };
      continue;
    }
    const v = ver.status === "ok" ? parseVerify(ver.result) : null;
    results[lead.id] = { address, status: v?.status ?? "unverified", deliverable: v?.deliverable ?? false, findProvider: d.find.provider, verifyProvider: d.verify.provider, costMicros: cost, at: now.toISOString() };
  }
  return { spentMicros: meter.spent, skippedByCap: meter.skippedByCap, skippedByBudget: meter.skippedByBudget, budgetMessage: meter.budgetMessage, pending: meter.pending, results, aborted: meter.aborted };
}
