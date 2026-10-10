import type { WarmConfig } from "./config";
import type { Drafts, Lead } from "./types";
import { topEvent } from "./draft";

export type LlmEnv = Record<string, string | undefined>;

/** true when the optional LLM step is switched on and has what it needs. */
export function llmEnabled(env: LlmEnv = process.env): boolean {
  return env.WARM_LLM === "anthropic" && Boolean(env.ANTHROPIC_API_KEY) && Boolean(env.WARM_LLM_MODEL);
}

/**
 * Optional step: asks an LLM to rewrite the template drafts so they read less like a template.
 * It is off unless WARM_LLM=anthropic, ANTHROPIC_API_KEY and WARM_LLM_MODEL are all set. It sends the lead's first name,
 * title, company and the one signal sentence, nothing else. Any failure keeps the template draft and adds a warning.
 */
export async function llmRewrite(lead: Lead, base: Drafts, cfg: WarmConfig, env: LlmEnv = process.env, f: typeof fetch = fetch): Promise<Drafts> {
  if (!llmEnabled(env)) return base;
  const ev = topEvent(lead);
  const prompt = [
    "Rewrite these three outreach drafts. Keep every fact. Refer to the signal below, do not invent others.",
    "Plain words, no flattery, no hype, no em dashes. One short ask at most.",
    `The connection note must be at most ${cfg.messages.noteMax} characters.`,
    'Answer with JSON only: {"connectionNote": string, "followUp": string, "emailSubject": string, "emailBody": string}.',
    "",
    `Recipient: ${lead.firstName}, ${lead.title ?? "role unknown"} at ${lead.company ?? "company unknown"}.`,
    `Signal: ${ev?.title ?? "none"}.`,
    `Sender: ${cfg.sender.name} at ${cfg.sender.company}, who works on ${cfg.sender.offer}.`,
    "",
    `Connection note: ${base.connectionNote}`,
    `Follow-up: ${base.followUp}`,
    `Email subject: ${base.email.subject}`,
    `Email body: ${base.email.body}`,
  ].join("\n");
  try {
    const res = await f("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY as string, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.WARM_LLM_MODEL, max_tokens: 900, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((c) => c.type === "text")?.text ?? "";
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const s = (k: string) => (typeof json[k] === "string" && (json[k] as string).trim() ? (json[k] as string).trim() : null);
    const note = s("connectionNote");
    const followUp = s("followUp");
    const subject = s("emailSubject");
    const bodyText = s("emailBody");
    if (!note || !followUp || !subject || !bodyText) throw new Error("incomplete answer");
    if (note.length > cfg.messages.noteMax) throw new Error(`note too long (${note.length})`);
    return { ...base, connectionNote: note, followUp, email: { subject, body: bodyText }, by: "llm" };
  } catch (e) {
    return { ...base, warnings: [...base.warnings, `The LLM step failed (${(e as Error).message}); the template draft was kept.`] };
  }
}
