import fs from "node:fs";
import path from "node:path";
import { shortHash } from "./run";
import { normalizeProfileUrl } from "./parse";
import type { SenderState, State } from "./types";

/** Where data is kept: WARM_DIR, or .looot-warm in the working directory. */
export function dataDir(env: Record<string, string | undefined> = process.env): string {
  return path.resolve(/*turbopackIgnore: true*/ env.WARM_DIR ?? ".looot-warm");
}

export function stateFile(env: Record<string, string | undefined> = process.env): string {
  return path.join(dataDir(env), "state.json");
}

export function emptySender(): SenderState {
  return { paused: false, items: [], dnc: [], sentLog: [], checkLog: [], suppressed: [] };
}

export function emptyState(): State {
  return { leads: {}, lastRun: null, runs: [], spendLog: [], sender: emptySender() };
}

/** Reads the saved state. An empty state when there is none or the file is unreadable. */
export function readState(file: string = stateFile()): State {
  try {
    const raw = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as Partial<State>;
    return { ...emptyState(), ...raw, sender: { ...emptySender(), ...(raw.sender ?? {}) } };
  } catch {
    return emptyState();
  }
}

/** Writes the state through a temp file so a crash cannot leave half a file. */
export function writeState(state: State, file: string = stateFile()): void {
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify(state));
  fs.renameSync(/*turbopackIgnore: true*/ tmp, file);
}

/** Hash used for the do-not-contact and erasure lists. Only the hash is kept, never the address or URL. */
export function contactHash(value: string): string {
  const v = value.trim().toLowerCase();
  const url = normalizeProfileUrl(v);
  return shortHash(url ?? v, 16);
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** Adds a person to the do-not-contact list by LinkedIn URL, email or company domain. */
export function addDnc(state: State, value: string): void {
  const h = contactHash(value);
  if (!state.sender.dnc.includes(h)) state.sender.dnc.push(h);
  for (const item of state.sender.items) {
    const lead = state.leads[item.leadId];
    if (lead && isLeadDnc(state, lead.linkedinUrl, lead.email?.address ?? undefined, lead.companyDomain) && ["draft", "approved"].includes(item.status)) {
      item.status = "cancelled";
      item.message = "Do-not-contact";
    }
  }
}

export function isLeadDnc(state: State, linkedinUrl: string, email?: string, domain?: string): boolean {
  const set = new Set(state.sender.dnc);
  return set.has(contactHash(linkedinUrl)) || Boolean(email && set.has(contactHash(email))) || Boolean(domain && set.has(contactHash(domain)));
}

/**
 * Erasure on request: removes the person from leads and the outbox, and keeps only a hash so later runs do not add them back.
 * Returns how many leads were removed.
 */
export function forget(state: State, value: string): number {
  const h = contactHash(value);
  let removed = 0;
  for (const [id, lead] of Object.entries(state.leads)) {
    const match = contactHash(lead.linkedinUrl) === h || (lead.email?.address && contactHash(lead.email.address) === h);
    if (match) {
      delete state.leads[id];
      state.sender.items = state.sender.items.filter((i) => i.leadId !== id);
      removed += 1;
    }
  }
  if (!state.sender.suppressed.includes(h)) state.sender.suppressed.push(h);
  return removed;
}

/**
 * Retention: deletes leads not seen for `days` days. A lead that was contacted is deleted too, but its hash is kept
 * on the suppression list so a later run never adds the same person back and contacts them twice.
 */
export function purge(state: State, days: number, now: Date = new Date()): number {
  let removed = 0;
  const cutoff = now.getTime() - days * 86_400_000;
  for (const [id, lead] of Object.entries(state.leads)) {
    if (Date.parse(lead.lastSeen) >= cutoff) continue;
    const contacted = state.sender.items.some((i) => i.leadId === id && ["sent", "sending", "unknown"].includes(i.status));
    if (contacted) {
      const h = contactHash(lead.linkedinUrl);
      if (!state.sender.suppressed.includes(h)) state.sender.suppressed.push(h);
    }
    delete state.leads[id];
    state.sender.items = state.sender.items.filter((i) => i.leadId !== id);
    removed += 1;
  }
  return removed;
}
