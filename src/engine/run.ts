import { createHash } from "node:crypto";
import type { WarmConfig } from "./config";
import { ENDPOINTS, inputs, type EndpointDef, type StepId } from "./endpoints";
import type { PriceMap, Runner } from "./looot";
import type { Ledger } from "./budget";
import { Meter, normalizeInput } from "./meter";
import { clip, domainOf, normalizeCompanyUrl, normalizeProfileUrl, parseCompany, parseEngagement, parseFunding, parseJobs, parsePosts, parseProfile, type PostRow } from "./parse";
import { firstMatch, scorePerson } from "./score";
import type { Lead, Quote, QuoteLine, RunSummary, SignalEvent, SignalKind, State } from "./types";

export function shortHash(text: string, len = 12): string {
  return createHash("sha256").update(text).digest("hex").slice(0, len);
}

/** Stable lead id from the LinkedIn profile URL. */
export function leadId(linkedinUrl: string): string {
  return `ld_${shortHash(linkedinUrl, 10)}`;
}

/**
 * How long a discovery answer is reused. Inside one period a repeated request is answered from the stored result with no
 * call. The next period is a deliberate fresh request: it gets its own key and can be charged again. LinkedIn posts and
 * their commenters change daily, so the period is one day.
 */
export const REFRESH_PERIOD_MS = 24 * 3_600_000;

/**
 * One key per (endpoint, normalised input, refresh period). The key has no date or clock time in it: the period is a whole
 * number counted from the epoch (floor(time / REFRESH_PERIOD_MS)), so the key holds for the whole period. The same key
 * replays the stored run and never charges twice, so running again in the period, or after a crash, costs nothing for
 * calls that already finished. The input is trimmed, lowercased and key-sorted first, so spelling the same request
 * differently does not pay twice.
 */
export function idempotencyKey(def: EndpointDef, input: Record<string, unknown>, now: Date): string {
  return `warm:v1:${def.endpointId}:${shortHash(JSON.stringify(normalizeInput(input)), 16)}:p${Math.floor(now.getTime() / REFRESH_PERIOD_MS)}`;
}

/** What a run costs at list price, as an upper bound from the limits in the config. Pure: no call is made. */
export function buildQuote(cfg: WarmConfig, prices: PriceMap, priceSource: Quote["priceSource"] = "catalog"): Quote {
  const s = cfg.sources;
  const k = cfg.limits.engagementPostsPerSource;
  const hasSources = s.competitors.length + s.creators.length + s.keywords.length + s.posts.length > 0;
  const counts: Partial<Record<StepId, number>> = {
    company_posts: s.competitors.length,
    profile_posts: s.creators.length,
    post_search: s.keywords.length,
    engagement: (s.competitors.length + s.creators.length + s.keywords.length) * k + s.posts.length,
    profile: hasSources ? cfg.limits.maxEnrich : 0,
    company: hasSources ? cfg.limits.maxEnrich : 0,
    hiring: hasSources && cfg.triggers.hiring ? cfg.limits.maxTriggerCompanies : 0,
    funding: hasSources && cfg.triggers.funding ? cfg.limits.maxTriggerCompanies : 0,
  };
  const lines: QuoteLine[] = [];
  for (const [step, calls] of Object.entries(counts) as [StepId, number][]) {
    if (!calls) continue;
    const d = ENDPOINTS[step];
    const priceMicros = prices[d.endpointId] ?? d.fallbackMicros;
    lines.push({ endpointId: d.endpointId, jobId: d.jobId, provider: d.provider, label: d.label, calls, priceMicros, totalMicros: calls * priceMicros });
  }
  return { lines, totalMicros: lines.reduce((n, l) => n + l.totalMicros, 0), priceSource };
}

async function pool<T>(items: T[], size: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, Math.max(1, items.length)) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i], i);
      }
    }),
  );
}

const ENGAGE_KIND: Record<"competitor" | "creator" | "topic" | "post", { comment: SignalKind; reaction: SignalKind }> = {
  competitor: { comment: "competitor_comment", reaction: "competitor_reaction" },
  creator: { comment: "creator_comment", reaction: "creator_reaction" },
  topic: { comment: "topic_comment", reaction: "topic_reaction" },
  post: { comment: "post_comment", reaction: "post_reaction" },
};

const SOURCE_NOUN = { competitor: "post by", creator: "post by", topic: "post about", post: "watched post" } as const;

interface Candidate {
  url: string;
  name: string;
  headline?: string;
  events: SignalEvent[];
}

export interface RunOptions {
  config: WarmConfig;
  looot: Runner;
  prices: PriceMap;
  priceSource?: Quote["priceSource"];
  unpriced?: readonly string[];
  capMicros: number;
  /** Period budget, reservations and stored answers. Left out in demo mode and in tests that do not need it. */
  ledger?: Ledger;
  /** The saved state. Leads already in it keep their first-seen date and their profile data. */
  state: State;
  now?: Date;
  demo?: boolean;
  onProgress?: (stage: string) => void;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? name, lastName: parts.slice(1).join(" ") };
}

/** "Head of Growth at Acme" gives title and company. Used only until the profile is read. */
export function titleCompanyFromHeadline(headline: string | undefined): { title?: string; company?: string } {
  if (!headline) return {};
  const m = /^(.*?)\s+(?:at|@)\s+(.+?)(?:\s*[|·].*)?$/i.exec(headline);
  return m ? { title: m[1].trim(), company: m[2].trim() } : { title: headline };
}

function dedupeEvents(events: SignalEvent[]): SignalEvent[] {
  const seen = new Set<string>();
  const out: SignalEvent[] = [];
  for (const e of events) {
    const key = `${e.kind}|${e.url ?? ""}|${e.title}|${e.date ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Splits a call's cost across the events it produced. The remainder goes to the first events, so the shares add up. */
function share(costMicros: number, events: SignalEvent[]): void {
  if (events.length === 0 || costMicros <= 0) return;
  const each = Math.floor(costMicros / events.length);
  let rest = costMicros - each * events.length;
  for (const e of events) {
    e.costMicros += each + (rest > 0 ? 1 : 0);
    if (rest > 0) rest -= 1;
  }
}

/**
 * Finds people showing intent, reads their profiles, scores them and returns the updated leads.
 * Discovery: posts of competitors, creators and keywords, then the commenters and reactors of the top posts.
 * Enrichment: profile and company reads for the best candidates only, then hiring and funding for the best companies.
 * Every call goes through the Meter, so the spend cannot pass the cap.
 */
export async function runWarm(opts: RunOptions): Promise<{ summary: RunSummary; leads: Record<string, Lead> }> {
  const cfg = opts.config;
  const now = opts.now ?? new Date();
  const startedAt = opts.demo ? now.toISOString() : new Date().toISOString();
  const meter = new Meter({ looot: opts.looot, prices: opts.prices, unpriced: opts.unpriced, capMicros: opts.capMicros, ledger: opts.ledger, now: opts.demo ? undefined : opts.now, demo: opts.demo });
  const quote = buildQuote(cfg, opts.prices, opts.priceSource);
  const notes: string[] = [];
  const cands = new Map<string, Candidate>();
  const suppressed = new Set(opts.state.sender.suppressed);
  const dnc = new Set(opts.state.sender.dnc);

  const call = (def: EndpointDef, input: Record<string, unknown>) => meter.call(def, input, idempotencyKey(def, input, now));
  const addEvents = (people: { url: string; name: string; headline?: string }, events: SignalEvent[]) => {
    const hash = shortHash(people.url, 16);
    if (suppressed.has(hash) || dnc.has(hash)) return;
    const c = cands.get(people.url) ?? { url: people.url, name: people.name, headline: people.headline, events: [] };
    c.headline = c.headline ?? people.headline;
    c.events.push(...events);
    cands.set(people.url, c);
  };

  const lookbackMs = cfg.limits.lookbackDays * 86_400_000;
  const inWindow = (d: string | null) => d === null || now.getTime() - Date.parse(d) <= lookbackMs;

  /** Reads the commenters and reactors of one post and turns them into events. Returns the events made. */
  async function engagersOf(post: { url: string; date: string | null; text: string }, kind: keyof typeof ENGAGE_KIND, sourceName: string): Promise<SignalEvent[]> {
    const def = ENDPOINTS.engagement;
    const r = await call(def, inputs.engagement(post.url, cfg.limits.engagersPerPost));
    if (r.status !== "ok") return [];
    const made: { person: { linkedinUrl: string; name: string; headline?: string }; ev: SignalEvent }[] = [];
    for (const e of parseEngagement(r.result)) {
      const k = ENGAGE_KIND[kind][e.type];
      const date = e.date ?? post.date;
      if (!inWindow(date)) continue;
      const ev: SignalEvent = {
        kind: k,
        provider: def.provider,
        endpointId: def.endpointId,
        date,
        title: e.type === "comment" ? `Commented on a ${SOURCE_NOUN[kind]} ${sourceName}` : `Reacted to a ${SOURCE_NOUN[kind]} ${sourceName}`,
        snippet: e.type === "comment" ? e.text : clip(post.text, 120),
        url: post.url,
        source: sourceName,
        costMicros: 0,
      };
      made.push({ person: e.person, ev });
    }
    share(r.costMicros, made.map((m) => m.ev));
    for (const m of made) addEvents({ url: m.person.linkedinUrl, name: m.person.name, headline: m.person.headline }, [m.ev]);
    return made.map((m) => m.ev);
  }

  /** Newest posts first, then the ones with the most engagement. */
  const pickPosts = (rows: PostRow[]) =>
    rows
      .filter((p) => inWindow(p.date))
      .sort((a, b) => (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0))
      .slice(0, cfg.limits.postsPerSource)
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, cfg.limits.engagementPostsPerSource);

  // 1. Discovery from the sources.
  opts.onProgress?.("sources");
  const tasks: (() => Promise<void>)[] = [];
  for (const c of cfg.sources.competitors) {
    const url = normalizeCompanyUrl(c.linkedinUrl) ?? c.linkedinUrl;
    tasks.push(async () => {
      const list = await call(ENDPOINTS.company_posts, inputs.companyPosts(url));
      if (list.status !== "ok") return;
      const events: SignalEvent[] = [];
      for (const p of pickPosts(parsePosts(list.result))) events.push(...(await engagersOf(p, "competitor", c.name)));
      share(list.costMicros, events);
    });
  }
  for (const c of cfg.sources.creators) {
    const url = normalizeProfileUrl(c.linkedinUrl) ?? c.linkedinUrl;
    tasks.push(async () => {
      const list = await call(ENDPOINTS.profile_posts, inputs.profilePosts(url, cfg.limits.lookbackDays));
      if (list.status !== "ok") return;
      const events: SignalEvent[] = [];
      for (const p of pickPosts(parsePosts(list.result))) events.push(...(await engagersOf(p, "creator", c.name)));
      share(list.costMicros, events);
    });
  }
  for (const kw of cfg.sources.keywords) {
    tasks.push(async () => {
      const list = await call(ENDPOINTS.post_search, inputs.postSearch(kw, cfg.limits.lookbackDays));
      if (list.status !== "ok") return;
      const rows = parsePosts(list.result).filter((p) => inWindow(p.date)).slice(0, cfg.limits.postsPerSource * 2);
      // People posting about the topic: the author of each matching post.
      const authorEvents: SignalEvent[] = [];
      for (const p of rows) {
        if (!p.author) continue;
        const ev: SignalEvent = { kind: "topic_post", provider: ENDPOINTS.post_search.provider, endpointId: ENDPOINTS.post_search.endpointId, date: p.date, title: `Posted about "${kw}"`, snippet: clip(p.text, 160), url: p.url, source: kw, costMicros: 0 };
        authorEvents.push(ev);
        addEvents({ url: p.author.linkedinUrl, name: p.author.name, headline: p.author.headline }, [ev]);
      }
      const engagerEvents: SignalEvent[] = [];
      for (const p of pickPosts(rows)) engagerEvents.push(...(await engagersOf(p, "topic", kw)));
      share(list.costMicros, [...authorEvents, ...engagerEvents]);
    });
  }
  for (const url of cfg.sources.posts) {
    tasks.push(async () => {
      await engagersOf({ url, date: null, text: "" }, "post", url.replace(/^https?:\/\/(www\.)?linkedin\.com\//, "").slice(0, 40));
    });
  }
  await pool(tasks, cfg.limits.concurrency, (t) => t());

  // 2. Choose who to enrich: the best intent first, the ICP title in the headline as a tie-break.
  opts.onProgress?.("rank");
  const prior = opts.state.leads;
  const list = [...cands.values()].filter((c) => !firstMatch(c.headline, cfg.icp.excludeTitles));
  const pre = (c: Candidate) => {
    const s = scorePerson(c.events, { headline: c.headline, enriched: false }, cfg, now);
    return s.intentPoints + (firstMatch(c.headline, cfg.icp.titles) ? 10 : 0);
  };
  list.sort((a, b) => pre(b) - pre(a));
  const fresh = (l: Lead | undefined) => Boolean(l?.enriched) && now.getTime() - Date.parse(l?.lastSeen ?? "") < 30 * 86_400_000;
  const toRead = list.filter((c) => !fresh(prior[leadId(c.url)])).slice(0, cfg.limits.maxEnrich);
  if (list.length > toRead.length + list.filter((c) => fresh(prior[leadId(c.url)])).length) notes.push(`Profiles were read for the best ${toRead.length} of ${list.length} people; raise limits.maxEnrich to read more.`);

  // 3. Profiles.
  opts.onProgress?.("profiles");
  const profiles = new Map<string, ReturnType<typeof parseProfile>>();
  const profileCost = new Map<string, number>();
  await pool(toRead, cfg.limits.concurrency, async (c) => {
    const r = await call(ENDPOINTS.profile, inputs.profile(c.url));
    profileCost.set(c.url, r.costMicros);
    if (r.status === "ok") {
      const p = parseProfile(r.result);
      profiles.set(c.url, p);
      if (!p) notes.push(`A profile came back in a shape the parser does not know (${c.url}).`);
    }
  });

  // 4. Companies for people whose title already fits, then the optional triggers.
  opts.onProgress?.("companies");
  const companyOf = new Map<string, { url: string; data: ReturnType<typeof parseCompany>; cost: number }>();
  const companyUrls = new Map<string, string[]>();
  for (const c of list) {
    const p = profiles.get(c.url);
    const old = prior[leadId(c.url)];
    const url = p?.companyUrl ?? old?.companyLinkedinUrl;
    if (!url) continue;
    const titleFits = Boolean(firstMatch(p?.title ?? p?.headline ?? old?.title ?? c.headline, cfg.icp.titles));
    if (!titleFits && cfg.icp.titles.length > 0) continue;
    companyUrls.set(url, [...(companyUrls.get(url) ?? []), c.url]);
  }
  const needCompany = [...companyUrls.keys()].filter((u) => !Object.values(prior).some((l) => l.companyLinkedinUrl === u && l.companyDomain && fresh(l))).slice(0, cfg.limits.maxEnrich);
  await pool(needCompany, cfg.limits.concurrency, async (url) => {
    const r = await call(ENDPOINTS.company, inputs.company(url));
    if (r.status === "ok") companyOf.set(url, { url, data: parseCompany(r.result), cost: r.costMicros });
    else companyOf.set(url, { url, data: null, cost: r.costMicros });
  });
  const known = (url: string | undefined) => {
    if (!url) return undefined;
    const fromRun = companyOf.get(url)?.data;
    if (fromRun) return fromRun;
    const old = Object.values(prior).find((l) => l.companyLinkedinUrl === url && l.companyDomain);
    return old ? { name: old.company, domain: old.companyDomain, industry: old.industry, size: old.companySize } : undefined;
  };

  // Triggers run only for the companies whose people score best, up to the limit.
  const triggerEvents = new Map<string, SignalEvent[]>();
  const triggerCost = new Map<string, number>();
  if ((cfg.triggers.hiring || cfg.triggers.funding) && cfg.limits.maxTriggerCompanies > 0) {
    opts.onProgress?.("triggers");
    const ranked = [...companyUrls.entries()]
      .map(([url, people]) => ({ url, domain: known(url)?.domain, best: Math.max(...people.map((u) => pre(cands.get(u) as Candidate))), people }))
      .filter((c) => c.domain)
      .sort((a, b) => b.best - a.best)
      .slice(0, cfg.limits.maxTriggerCompanies);
    await pool(ranked, cfg.limits.concurrency, async (c) => {
      const domain = c.domain as string;
      const name = known(c.url)?.name ?? domain;
      if (cfg.triggers.hiring) {
        const r = await call(ENDPOINTS.hiring, inputs.hiring(domain));
        if (r.status === "ok") {
          const rel = parseJobs(r.result).filter((j) => firstMatch(j.title, cfg.scoring.hiringTitles));
          if (rel.length) {
            const newest = [...rel].sort((a, b) => (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0))[0];
            const ev: SignalEvent = { kind: "hiring", provider: ENDPOINTS.hiring.provider, endpointId: ENDPOINTS.hiring.endpointId, date: newest.date, title: `${name} is hiring: ${newest.title}${rel.length > 1 ? ` and ${rel.length - 1} more` : ""}`, url: newest.url, source: name, costMicros: 0 };
            triggerEvents.set(c.url, [...(triggerEvents.get(c.url) ?? []), ev]);
            triggerCost.set(c.url, (triggerCost.get(c.url) ?? 0) + r.costMicros);
          }
        }
      }
      if (cfg.triggers.funding) {
        const since = new Date(now.getTime() - cfg.scoring.fundingDays * 86_400_000).toISOString();
        const r = await call(ENDPOINTS.funding, inputs.funding(domain, since));
        if (r.status === "ok") {
          const recent = parseFunding(r.result).filter((f) => f.date && Date.parse(f.date) >= Date.parse(since));
          if (recent.length) {
            const newest = [...recent].sort((a, b) => (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0))[0];
            const ev: SignalEvent = { kind: "funding", provider: ENDPOINTS.funding.provider, endpointId: ENDPOINTS.funding.endpointId, date: newest.date, title: `${name}: ${newest.title}`, url: newest.url, source: name, costMicros: 0 };
            triggerEvents.set(c.url, [...(triggerEvents.get(c.url) ?? []), ev]);
            triggerCost.set(c.url, (triggerCost.get(c.url) ?? 0) + r.costMicros);
          }
        }
      }
    });
  }

  // 5. Score everyone and merge with the saved leads.
  opts.onProgress?.("score");
  const leads: Record<string, Lead> = {};
  const nowIso = now.toISOString();
  const companyPeople = new Map<string, number>();
  for (const [url, people] of companyUrls) companyPeople.set(url, people.length);
  for (const c of list) {
    const id = leadId(c.url);
    const old = prior[id];
    const p = profiles.get(c.url);
    const fromHeadline = titleCompanyFromHeadline(c.headline);
    const companyUrl = p?.companyUrl ?? old?.companyLinkedinUrl;
    const co = known(companyUrl);
    const events = [...c.events];
    if (cfg.triggers.newRole && p?.roleStart) {
      const ageDays = (now.getTime() - Date.parse(p.roleStart)) / 86_400_000;
      if (ageDays >= 0 && ageDays <= cfg.scoring.newRoleDays) events.push({ kind: "new_role", provider: ENDPOINTS.profile.provider, endpointId: ENDPOINTS.profile.endpointId, date: p.roleStart, title: `Started as ${p.title ?? "a new role"}${p.company ? ` at ${p.company}` : ""}`, url: c.url, source: "profile", costMicros: 0 });
    }
    if (companyUrl) {
      const n = companyPeople.get(companyUrl) ?? 1;
      for (const t of triggerEvents.get(companyUrl) ?? []) events.push({ ...t, costMicros: Math.round((triggerCost.get(companyUrl) ?? 0) / Math.max(1, n) / Math.max(1, (triggerEvents.get(companyUrl) ?? []).length)) });
    }
    const allEvents = dedupeEvents([...(old?.events ?? []).filter((e) => Date.parse(e.date ?? "") >= now.getTime() - 90 * 86_400_000 || !e.date), ...events]);
    const enriched = Boolean(p) || Boolean(old?.enriched);
    const title = p?.title ?? old?.title ?? fromHeadline.title;
    const company = p?.company ?? co?.name ?? old?.company ?? fromHeadline.company;
    const scored = scorePerson(allEvents, { title, headline: p?.headline ?? c.headline, industry: co?.industry ?? old?.industry, companySize: co?.size ?? old?.companySize, location: p?.location ?? old?.location, enriched }, cfg, now);
    const enrichCost = (old?.enrichCostMicros ?? 0) + (profileCost.get(c.url) ?? 0) + (companyUrl && companyOf.has(companyUrl) ? Math.round((companyOf.get(companyUrl)?.cost ?? 0) / Math.max(1, companyPeople.get(companyUrl) ?? 1)) : 0);
    const { firstName, lastName } = splitName(p?.name ?? c.name);
    const eventCost = allEvents.reduce((n, e) => n + e.costMicros, 0);
    leads[id] = {
      id,
      name: p?.name ?? c.name,
      firstName,
      lastName,
      linkedinUrl: c.url,
      headline: p?.headline ?? c.headline ?? old?.headline,
      title,
      company,
      companyLinkedinUrl: companyUrl,
      companyDomain: co?.domain ?? old?.companyDomain,
      industry: co?.industry ?? old?.industry,
      companySize: co?.size ?? old?.companySize,
      location: p?.location ?? old?.location,
      events: allEvents,
      fit: scored.fit,
      fitPoints: scored.fitPoints,
      intentPoints: scored.intentPoints,
      rawIntent: scored.rawIntent,
      score: scored.score,
      band: scored.band,
      breakdown: scored.breakdown,
      reasons: scored.reasons,
      enrichCostMicros: enrichCost,
      costMicros: eventCost + enrichCost,
      enriched,
      firstSeen: old?.firstSeen ?? nowIso,
      lastSeen: nowIso,
      isNew: !(old && !old.excluded && old.score >= cfg.scoring.listMinScore),
      email: old?.email,
      drafts: old?.drafts,
      replies: old?.replies ?? [],
      excluded: scored.excluded,
    };
  }
  // Leads from earlier runs that this run did not touch stay as they were.
  for (const [id, l] of Object.entries(prior)) if (!leads[id]) leads[id] = { ...l, isNew: false };

  const visible = Object.values(leads).filter((l) => !l.excluded && l.score >= cfg.scoring.listMinScore);
  const newIds = visible.filter((l) => l.isNew).map((l) => l.id);
  if (meter.skippedByBudget > 0) notes.push(`${meter.skippedByBudget} calls were skipped because the period budget would have been passed. ${meter.budgetMessage ?? ""}`.trim());
  if (meter.skippedByCap > 0) notes.push(`${meter.skippedByCap} calls were skipped because the cap would have been passed.`);
  if (cands.size === 0 && !meter.aborted) notes.push("The sources returned no people. Check the source URLs and keywords.");
  const summary: RunSummary = {
    runId: `run_${shortHash(startedAt + JSON.stringify(cfg.sources), 10)}`,
    startedAt,
    finishedAt: opts.demo ? now.toISOString() : new Date().toISOString(),
    demo: opts.demo ?? false,
    capMicros: opts.capMicros,
    quotedMicros: quote.totalMicros,
    spentMicros: meter.spent,
    skippedByCap: meter.skippedByCap,
    skippedByBudget: meter.skippedByBudget,
    budgetMessage: meter.budgetMessage,
    pendingCalls: meter.pending,
    failedCalls: meter.failed,
    aborted: meter.aborted,
    quote,
    calls: meter.calls,
    candidates: cands.size,
    enriched: profiles.size,
    leads: visible.length,
    newLeads: newIds.length,
    newLeadIds: newIds,
    notes,
  };
  return { summary, leads };
}

export { domainOf };
