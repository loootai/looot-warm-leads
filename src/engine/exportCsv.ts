import type { Lead } from "./types";
import { topEvent } from "./draft";

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Spreadsheet formulas in a cell would run when the CSV is opened. A leading = + - @ gets a quote in front. */
export function safeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

const row = (cells: unknown[]) => cells.map((c) => esc(safeCell(c))).join(",");

export const LEADS_HEADER = ["rank", "score", "band", "first_name", "last_name", "title", "company", "company_domain", "linkedin_url", "email", "email_status", "top_signal", "signal_url", "signal_date", "signals", "first_seen", "connection_note"];

/** The daily list as CSV, ranked by score. */
export function leadsCsv(leads: Lead[]): string {
  const lines = [LEADS_HEADER.join(",")];
  leads.forEach((l, i) => {
    const ev = topEvent(l);
    lines.push(row([i + 1, l.score, l.band, l.firstName, l.lastName, l.title, l.company, l.companyDomain, l.linkedinUrl, l.email?.address ?? "", l.email?.status ?? "", ev?.title ?? "", ev?.url ?? "", ev?.date?.slice(0, 10) ?? "", l.events.length, l.firstSeen.slice(0, 10), l.drafts?.connectionNote ?? ""]));
  });
  return `${lines.join("\n")}\n`;
}

export const INSTANTLY_HEADER = ["email", "first_name", "last_name", "company_name", "website", "personalization", "job_title", "linkedin_url", "signal", "score"];

/**
 * CSV for an Instantly campaign import. Only leads with a verified deliverable email are included, because a cold send to an
 * unverified address hurts the sending domain. `personalization` is the first line of the email draft; the extra columns come
 * in as custom variables when you map them in Instantly's import screen.
 */
export function instantlyCsv(leads: Lead[]): { csv: string; included: number; skipped: number } {
  const lines = [INSTANTLY_HEADER.join(",")];
  let included = 0;
  for (const l of leads) {
    if (!l.email?.address || !l.email.deliverable) continue;
    const ev = topEvent(l);
    const opener = l.drafts?.email.body.split("\n").find((x) => x.trim() && !/^hi\b/i.test(x.trim())) ?? "";
    lines.push(row([l.email.address, l.firstName, l.lastName, l.company, l.companyDomain ? `https://${l.companyDomain}` : "", opener, l.title, l.linkedinUrl, ev?.title ?? "", l.score]));
    included += 1;
  }
  return { csv: `${lines.join("\n")}\n`, included, skipped: leads.length - included };
}

/** Markdown summary of leads, for the daily workflow summary and for chat. */
export function leadsMarkdown(leads: Lead[], title: string): string {
  const out = [`# ${title}`, ""];
  if (leads.length === 0) return `${out.join("\n")}No leads.\n`;
  out.push("| # | Score | Name | Title | Company | Top signal | Evidence |", "|---|---|---|---|---|---|---|");
  leads.forEach((l, i) => {
    const ev = topEvent(l);
    const cell = (s: string | undefined) => (s ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
    out.push(`| ${i + 1} | ${l.score} ${l.band} | [${cell(l.name)}](${l.linkedinUrl}) | ${cell(l.title)} | ${cell(l.company)} | ${cell(ev?.title)} | ${ev?.url ? `[link](${ev.url})` : ""} |`);
  });
  return `${out.join("\n")}\n`;
}
