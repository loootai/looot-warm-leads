import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SIGNAL_KINDS, type SignalKind } from "./types";

const kindWeight = z.object({
  /** Most points this signal can add to the intent part of the score. */
  weight: z.number().min(0).max(100),
  /** Days until the signal counts half. */
  halfLifeDays: z.number().positive(),
  label: z.string(),
});

const nameUrl = z.object({ name: z.string().min(1), linkedinUrl: z.string().min(1), domain: z.string().optional() });

const Schema = z.object({
  icp: z.object({
    description: z.string(),
    titles: z.array(z.string()),
    excludeTitles: z.array(z.string()),
    seniority: z.array(z.string()),
    industries: z.array(z.string()),
    countries: z.array(z.string()),
    companySize: z.object({ min: z.number().min(0), max: z.number().min(0) }),
  }),
  sources: z.object({
    competitors: z.array(nameUrl),
    creators: z.array(nameUrl),
    keywords: z.array(z.string().min(1)),
    posts: z.array(z.string().min(1)),
  }),
  triggers: z.object({ newRole: z.boolean(), hiring: z.boolean(), funding: z.boolean() }),
  scoring: z.object({
    /** Points available to ICP fit. Fit plus intent is the score, so keep the two summing to 100. */
    fitMax: z.number().min(0).max(100),
    intentMax: z.number().min(0).max(100),
    fit: z.object({ title: z.number(), seniority: z.number(), industry: z.number(), location: z.number(), company_size: z.number() }),
    hotAt: z.number(),
    warmAt: z.number(),
    /** Leads below this score are kept but hidden from the daily list. */
    listMinScore: z.number(),
    signals: z.record(z.string(), kindWeight),
    /** Extra events of one signal add this share of the weight each, up to three extra. */
    repeatBonus: z.number().min(0).max(1),
    newRoleDays: z.number().positive(),
    hiringTitles: z.array(z.string()),
    fundingDays: z.number().positive(),
  }),
  limits: z.object({
    lookbackDays: z.number().positive(),
    postsPerSource: z.number().int().min(1),
    engagementPostsPerSource: z.number().int().min(0),
    engagersPerPost: z.number().int().min(1).max(100),
    maxEnrich: z.number().int().min(0),
    maxTriggerCompanies: z.number().int().min(0),
    concurrency: z.number().int().min(1).max(10),
  }),
  endpoints: z.object({ emailFind: z.string(), emailVerify: z.string() }),
  sender: z.object({
    name: z.string(),
    company: z.string(),
    offer: z.string(),
  }),
  messages: z.object({
    /** LinkedIn allows 300 characters with a connection note on a paid account and 200 on a free one. */
    noteMax: z.number().int().positive(),
    templates: z.record(z.string(), z.string()),
    followUp: z.string(),
    emailSubject: z.string(),
    emailBody: z.string(),
  }),
  outbox: z.object({
    /** Nothing leaves the app while this is true. The default. */
    dryRun: z.boolean(),
    dailyInvites: z.number().int().min(0),
    dailyMessages: z.number().int().min(0),
    dailyProfileChecks: z.number().int().min(0),
    minGapSeconds: z.number().int().min(0),
    maxGapSeconds: z.number().int().min(0),
    workingHours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24), days: z.array(z.number().int().min(0).max(6)), utcOffsetMinutes: z.number().int() }),
    followUpDelayHours: z.number().min(0),
  }),
  privacy: z.object({ retentionDays: z.number().int().min(1) }),
  /** Spend ceilings the web app uses. The browser cannot raise them. */
  spend: z.object({ runCapUsd: z.number().positive().max(1000), emailCapUsd: z.number().positive().max(1000) }),
});

export type WarmConfig = z.infer<typeof Schema>;

export const DEFAULT_CONFIG_PATH = "config/warm.config.json";

const NOTE_DEFAULT =
  "Hi {first_name}, I saw you {signal_phrase}. I work on {offer}. Would be good to be connected.";

/** The shipped defaults. A config file only has to name what it changes. */
export function defaultConfig(): WarmConfig {
  return {
    icp: {
      description: "Heads of growth and revenue at B2B SaaS companies with 20 to 500 people.",
      titles: ["head of growth", "vp growth", "head of demand generation", "director of marketing", "head of revenue operations", "founder", "cmo"],
      excludeTitles: ["intern", "student", "recruiter", "freelance"],
      seniority: ["head of", "vp", "director", "chief", "founder", "cmo", "cro"],
      industries: ["software", "saas", "internet", "information technology"],
      countries: [],
      companySize: { min: 20, max: 500 },
    },
    sources: { competitors: [], creators: [], keywords: [], posts: [] },
    triggers: { newRole: true, hiring: false, funding: false },
    scoring: {
      fitMax: 40,
      intentMax: 60,
      fit: { title: 20, seniority: 8, industry: 6, location: 3, company_size: 3 },
      hotAt: 70,
      warmAt: 45,
      listMinScore: 30,
      repeatBonus: 0.2,
      newRoleDays: 90,
      fundingDays: 180,
      hiringTitles: ["growth", "demand", "sales", "revenue", "marketing"],
      signals: {
        competitor_comment: { weight: 28, halfLifeDays: 21, label: "Commented on a competitor post" },
        competitor_reaction: { weight: 14, halfLifeDays: 14, label: "Reacted to a competitor post" },
        creator_comment: { weight: 16, halfLifeDays: 21, label: "Commented on a creator post" },
        creator_reaction: { weight: 7, halfLifeDays: 14, label: "Reacted to a creator post" },
        topic_post: { weight: 20, halfLifeDays: 21, label: "Posted about the topic" },
        topic_comment: { weight: 12, halfLifeDays: 21, label: "Commented on a topic post" },
        topic_reaction: { weight: 6, halfLifeDays: 14, label: "Reacted to a topic post" },
        post_comment: { weight: 16, halfLifeDays: 21, label: "Commented on a watched post" },
        post_reaction: { weight: 7, halfLifeDays: 14, label: "Reacted to a watched post" },
        new_role: { weight: 18, halfLifeDays: 60, label: "Started a new role" },
        hiring: { weight: 10, halfLifeDays: 45, label: "Company is hiring for a related role" },
        funding: { weight: 10, halfLifeDays: 120, label: "Company raised funding" },
      },
    },
    limits: { lookbackDays: 14, postsPerSource: 5, engagementPostsPerSource: 2, engagersPerPost: 50, maxEnrich: 60, maxTriggerCompanies: 20, concurrency: 4 },
    endpoints: { emailFind: "anysite-api-linkedin-user-email", emailVerify: "millionverifier-verify" },
    sender: { name: "Your name", company: "Your company", offer: "what your company does, in one short phrase" },
    messages: {
      noteMax: 300,
      templates: {
        default: NOTE_DEFAULT,
        competitor: "Hi {first_name}, I saw you {signal_phrase}. I work on {offer}. Happy to share what we see in the space if useful.",
        topic_post: "Hi {first_name}, your post on {topic} caught my eye. I work on {offer}. Would be good to connect.",
        new_role: "Hi {first_name}, congrats on the new role at {company}. I work on {offer}. Would be good to connect.",
        hiring: "Hi {first_name}, I noticed {company} is hiring for {job_title}. I work on {offer}. Would be good to connect.",
        funding: "Hi {first_name}, congrats on the round at {company}. I work on {offer}. Would be good to connect.",
      },
      followUp: "Thanks for connecting, {first_name}. I work on {offer}. If it is useful for {company}, I can send a short example. If not, no problem.",
      emailSubject: "{company} and {topic}",
      emailBody:
        "Hi {first_name},\n\nI noticed that you {signal_phrase}. I work on {offer}.\n\nIf that is relevant for {company}, I can send a short example. If not, tell me and I will not write again.\n\n{sender_name}\n{sender_company}",
    },
    outbox: {
      dryRun: true,
      dailyInvites: 20,
      dailyMessages: 40,
      dailyProfileChecks: 20,
      minGapSeconds: 120,
      maxGapSeconds: 480,
      workingHours: { start: 9, end: 18, days: [1, 2, 3, 4, 5], utcOffsetMinutes: 0 },
      followUpDelayHours: 24,
    },
    privacy: { retentionDays: 90 },
    spend: { runCapUsd: 2, emailCapUsd: 1 },
  };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep merge: objects merge, arrays and scalars in `over` replace the base. */
export function merge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge((base as Json)[k], v) : v;
  return out as T;
}

/** Reads a config file over the defaults and checks it. Throws with the field names that are wrong. */
export function loadConfig(file?: string): WarmConfig {
  const p = file ?? process.env.WARM_CONFIG ?? DEFAULT_CONFIG_PATH;
  let over: unknown = {};
  if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
    try {
      over = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8"));
    } catch (e) {
      throw new Error(`Config ${p} is not valid JSON: ${(e as Error).message}`);
    }
  } else if (file) {
    throw new Error(`Config file not found: ${file}`);
  }
  return parseConfig(merge(defaultConfig(), over), p);
}

/** Checks a full config object. */
export function parseConfig(raw: unknown, label = "config"): WarmConfig {
  const r = Schema.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`Invalid ${label}: ${issues}`);
  }
  for (const k of SIGNAL_KINDS) if (!r.data.scoring.signals[k]) throw new Error(`Invalid ${label}: scoring.signals.${k} is missing`);
  return r.data;
}

/** Writes a config next to the saved state, through a temp file. Used by the source and ICP editors. */
export function saveConfig(cfg: WarmConfig, file: string): void {
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(/*turbopackIgnore: true*/ tmp, `${JSON.stringify(cfg, null, 2)}\n`);
  fs.renameSync(/*turbopackIgnore: true*/ tmp, file);
}

export function signalDef(cfg: WarmConfig, kind: SignalKind) {
  return cfg.scoring.signals[kind];
}
