import type { WarmConfig } from "./config";
import type { Drafts, Lead, SignalEvent } from "./types";

/** The signal as a clause that follows "I saw that you": "commented on a recent Northwind post". */
export function signalPhrase(e: SignalEvent, lead?: Pick<Lead, "company" | "title">): string {
  switch (e.kind) {
    case "competitor_comment": return `commented on a recent ${e.source} post`;
    case "competitor_reaction": return `reacted to a recent ${e.source} post`;
    case "creator_comment": return `commented on a recent post by ${e.source}`;
    case "creator_reaction": return `reacted to a recent post by ${e.source}`;
    case "topic_post": return `posted about ${e.source}`;
    case "topic_comment": return `commented on a post about ${e.source}`;
    case "topic_reaction": return `reacted to a post about ${e.source}`;
    case "post_comment": return "commented on a LinkedIn post I was reading";
    case "post_reaction": return "reacted to a LinkedIn post I was reading";
    case "new_role": return `started as ${lead?.title ?? "a new role"}${lead?.company ? ` at ${lead.company}` : ""}`;
    case "hiring": return `are hiring${lead?.company ? ` at ${lead.company}` : ""}`;
    case "funding": return `raised funding${lead?.company ? ` at ${lead.company}` : ""}`;
  }
}

const TEMPLATE_KEY: Partial<Record<SignalEvent["kind"], string>> = {
  competitor_comment: "competitor",
  competitor_reaction: "competitor",
  topic_post: "topic_post",
  new_role: "new_role",
  hiring: "hiring",
  funding: "funding",
};

/** The event a message should refer to: the one that earned the most points, then the newest. */
export function topEvent(lead: Lead): SignalEvent | null {
  const order = lead.breakdown.filter((b) => b.type === "intent").sort((a, b) => b.points - a.points);
  for (const line of order) {
    const evs = lead.events.filter((e) => e.kind === line.key).sort((a, b) => (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0));
    if (evs[0]) return evs[0];
  }
  return lead.events[0] ?? null;
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Drops trailing sentences until the text fits, or returns it unchanged when even one sentence is too long. */
export function fitTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((s) => s.trim());
  if (!sentences) return text;
  while (sentences.length > 1) {
    sentences.pop();
    const t = sentences.join(" ");
    if (t.length <= max) return t;
  }
  return text;
}

/** Template drafts for one lead: a connection note, a follow-up after acceptance, and an email. No LLM, no network. */
export function draftFor(lead: Lead, cfg: WarmConfig): Drafts {
  const ev = topEvent(lead);
  const s = cfg.sender;
  const vars: Record<string, string> = {
    first_name: lead.firstName || "there",
    last_name: lead.lastName,
    company: lead.company ?? "your team",
    title: lead.title ?? "",
    signal_phrase: ev ? signalPhrase(ev, lead) : "came across your profile",
    topic: ev ? (["topic_post", "topic_comment", "topic_reaction"].includes(ev.kind) ? ev.source : cfg.sources.keywords[0] ?? "your space") : "your space",
    job_title: ev?.kind === "hiring" ? (/hiring: (.+?)(?: and \d+ more)?$/.exec(ev.title)?.[1] ?? "a related role") : "a related role",
    offer: s.offer,
    offer_sentence: `${cap(s.offer)}.`,
    sender_name: s.name,
    sender_company: s.company,
  };
  const key = ev ? TEMPLATE_KEY[ev.kind] ?? "default" : "default";
  const tpl = cfg.messages.templates[key] ?? cfg.messages.templates.default ?? "";
  const note = fitTo(fill(tpl, vars), cfg.messages.noteMax);
  const warnings: string[] = [];
  if (note.length > cfg.messages.noteMax) warnings.push(`The connection note is ${note.length} characters; LinkedIn allows ${cfg.messages.noteMax}. Shorten it before queueing.`);
  const followUp = fill(cfg.messages.followUp, vars);
  const email = { subject: fill(cfg.messages.emailSubject, vars), body: fill(cfg.messages.emailBody, vars) };
  for (const [name, text] of [["note", note], ["follow-up", followUp], ["email", email.body]] as const) {
    const left = /\{[a-z_]+\}/.exec(text);
    if (left) warnings.push(`The ${name} still has the placeholder ${left[0]}. Check the template.`);
  }
  if (!ev) warnings.push("The lead has no signal to refer to.");
  return { connectionNote: note, followUp, email, by: "template", signalRef: ev ? `${ev.title}${ev.url ? ` (${ev.url})` : ""}` : "", warnings, edited: false };
}
