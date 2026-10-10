import type { WarmConfig } from "./config";
import type { Band, BreakdownLine, FitLine, SignalEvent, SignalKind } from "./types";
import { SIGNAL_KINDS } from "./types";

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** The first term that appears as a whole word or phrase in the text. Empty terms never match. */
export function firstMatch(text: string | undefined, terms: string[]): string | null {
  if (!text) return null;
  const t = words(text);
  for (const term of terms) {
    const w = words(term).trim();
    if (w && t.includes(` ${w} `)) return term;
  }
  return null;
}

export interface FitInput {
  title?: string;
  headline?: string;
  industry?: string;
  companySize?: number;
  location?: string;
  /** false when the profile could not be read. */
  enriched: boolean;
}

export interface FitResult {
  lines: FitLine[];
  points: number;
  /** Set when the person must be left out of the list. */
  excluded?: string;
}

/**
 * ICP fit. A criterion that the ICP does not set is left out and the rest are scaled to the fit maximum.
 * A criterion whose data is missing scores zero and says so; nothing is guessed.
 */
export function scoreFit(input: FitInput, cfg: WarmConfig): FitResult {
  const icp = cfg.icp;
  const w = cfg.scoring.fit;
  const titleText = input.title ?? input.headline;
  const excluded = firstMatch(`${input.title ?? ""} ${input.headline ?? ""}`, icp.excludeTitles);
  const lines: FitLine[] = [];
  const add = (criterion: FitLine["criterion"], label: string, configured: boolean, got: { ok: boolean; detail: string }) => {
    if (!configured) return;
    lines.push({ criterion, label, maxPoints: w[criterion], points: got.ok ? w[criterion] : 0, detail: got.detail });
  };

  const titleHit = firstMatch(titleText, icp.titles);
  add("title", "Job title", icp.titles.length > 0, { ok: Boolean(titleHit), detail: !titleText ? "no title in the data" : titleHit ? `"${titleText}" matches "${titleHit}"` : `"${titleText}" matches none of the ICP titles` });
  const senHit = firstMatch(titleText, icp.seniority);
  add("seniority", "Seniority", icp.seniority.length > 0, { ok: Boolean(senHit), detail: !titleText ? "no title in the data" : senHit ? `"${titleText}" contains "${senHit}"` : `"${titleText}" has no seniority term` });
  const indHit = firstMatch(input.industry, icp.industries);
  add("industry", "Industry", icp.industries.length > 0, { ok: Boolean(indHit), detail: !input.industry ? "no industry in the data" : indHit ? `"${input.industry}" matches "${indHit}"` : `"${input.industry}" is not in the ICP industries` });
  const locHit = firstMatch(input.location, icp.countries);
  add("location", "Location", icp.countries.length > 0, { ok: Boolean(locHit), detail: !input.location ? "no location in the data" : locHit ? `"${input.location}" matches "${locHit}"` : `"${input.location}" is outside the ICP countries` });
  const { min, max } = icp.companySize;
  const sizeSet = max > 0;
  const sizeOk = input.companySize !== undefined && input.companySize >= min && input.companySize <= max;
  add("company_size", "Company size", sizeSet, { ok: sizeOk, detail: input.companySize === undefined ? "no headcount in the data" : sizeOk ? `${input.companySize} people is inside ${min} to ${max}` : `${input.companySize} people is outside ${min} to ${max}` });

  const maxSum = lines.reduce((n, l) => n + l.maxPoints, 0);
  const got = lines.reduce((n, l) => n + l.points, 0);
  const points = maxSum > 0 ? (got / maxSum) * cfg.scoring.fitMax : 0;
  return { lines, points: Math.round(points * 10) / 10, excluded: excluded ? `Excluded title: "${excluded}"` : undefined };
}

/** Share of a signal still counted after `ageDays`: 1 today, 0.5 at one half-life. An undated event counts 0.5. */
export function decay(date: string | null, now: Date, halfLifeDays: number): number {
  if (!date) return 0.5;
  const age = Math.max(0, (now.getTime() - Date.parse(date)) / 86_400_000);
  if (!Number.isFinite(age)) return 0.5;
  return Math.pow(0.5, age / halfLifeDays);
}

const PROVIDER_OF = (e: SignalEvent) => e.provider;

function ago(date: string | null, now: Date): string {
  if (!date) return "undated";
  const d = Math.round((now.getTime() - Date.parse(date)) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
}

export interface IntentResult {
  lines: BreakdownLine[];
  points: number;
  /** The sum before the intent maximum is applied. Used only to order leads that tie at the cap. */
  raw: number;
}

/** Intent points: one line per signal kind present, the newest event decayed by its half-life, plus a bonus for repeats. */
export function scoreIntent(events: SignalEvent[], cfg: WarmConfig, now: Date): IntentResult {
  const lines: BreakdownLine[] = [];
  for (const kind of SIGNAL_KINDS) {
    const evs = events.filter((e) => e.kind === kind);
    if (evs.length === 0) continue;
    const def = cfg.scoring.signals[kind];
    const best = Math.max(...evs.map((e) => decay(e.date, now, def.halfLifeDays)));
    const strength = Math.min(1, best + cfg.scoring.repeatBonus * Math.min(3, evs.length - 1));
    const points = Math.round(def.weight * strength * 10) / 10;
    const sorted = [...evs].sort((a, b) => (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0));
    const top = sorted[0];
    lines.push({
      type: "intent",
      key: kind,
      label: def.label,
      provider: [...new Set(evs.map(PROVIDER_OF))].join(", "),
      endpointId: [...new Set(evs.map((e) => e.endpointId))].join(", "),
      maxPoints: def.weight,
      points,
      eventCount: evs.length,
      date: top.date,
      costMicros: evs.reduce((n, e) => n + e.costMicros, 0),
      summary: `${top.title} (${ago(top.date, now)})${evs.length > 1 ? `, ${evs.length} events` : ""}`,
      evidence: sorted.filter((e) => e.url).slice(0, 3).map((e) => ({ url: e.url as string, date: e.date, title: e.title })),
    });
  }
  const total = Math.min(cfg.scoring.intentMax, lines.reduce((n, l) => n + l.points, 0));
  return { lines: lines.sort((a, b) => b.points - a.points), points: Math.round(total * 10) / 10, raw: lines.reduce((n, l) => n + l.points, 0) };
}

export function bandOf(score: number, cfg: WarmConfig): Band {
  return score >= cfg.scoring.hotAt ? "hot" : score >= cfg.scoring.warmAt ? "warm" : "cool";
}

export interface Scored {
  fit: FitLine[];
  fitPoints: number;
  intentPoints: number;
  rawIntent: number;
  score: number;
  band: Band;
  breakdown: BreakdownLine[];
  reasons: string[];
  excluded?: string;
}

/** The whole score for one person: fit, intent, breakdown and the plain reasons. */
export function scorePerson(events: SignalEvent[], fitInput: FitInput, cfg: WarmConfig, now: Date): Scored {
  const fit = scoreFit(fitInput, cfg);
  const intent = scoreIntent(events, cfg, now);
  const fitLines: BreakdownLine[] = fit.lines.map((l) => ({
    type: "fit",
    key: l.criterion,
    label: l.label,
    provider: fitInput.enriched ? "fetchin" : "search result headline",
    endpointId: fitInput.enriched ? "fetchin-profile, fetchin-company" : "",
    maxPoints: l.maxPoints,
    points: l.points,
    eventCount: 0,
    date: null,
    costMicros: 0,
    summary: l.detail,
    evidence: [],
  }));
  const score = Math.max(0, Math.min(100, Math.round(fit.points + intent.points)));
  const reasons = intent.lines.filter((l) => l.points > 0).map((l) => `${l.summary}: +${l.points} of ${l.maxPoints} points, from ${l.provider}.`);
  const fitHits = fit.lines.filter((l) => l.points > 0).map((l) => l.label.toLowerCase());
  if (fitHits.length) reasons.push(`Fits the ICP on ${fitHits.join(", ")}: +${fit.points} of ${cfg.scoring.fitMax} points.`);
  return { fit: fit.lines, fitPoints: fit.points, intentPoints: intent.points, rawIntent: intent.raw, score, band: bandOf(score, cfg), breakdown: [...intent.lines, ...fitLines], reasons, excluded: fit.excluded };
}

export type { SignalKind };
