import type { PriceMap } from "./looot";

export const PRICES_AS_OF = "2026-10-10";

export type StepId = "company_posts" | "profile_posts" | "post_search" | "engagement" | "profile" | "company" | "hiring" | "funding" | "email_find" | "email_verify";

export interface EndpointDef {
  step: StepId;
  label: string;
  provider: string;
  /** looot job id this endpoint belongs to in the catalog overview. */
  jobId: string;
  /** The pinned looot endpoint this app runs. No provider fallback, so the quoted price is the price. */
  endpointId: string;
  /** Per-call price in micro-dollars from the public catalog on PRICES_AS_OF. */
  fallbackMicros: number;
}

/** Every looot endpoint this app calls. Job ids and prices come from the free public catalog. */
export const ENDPOINTS: Record<StepId, EndpointDef> = {
  company_posts: { step: "company_posts", label: "Competitor page posts", provider: "scrapecreators", jobId: "linkedin.company.posts", endpointId: "scrapecreators-linkedin-company-posts", fallbackMicros: 1_880 },
  profile_posts: { step: "profile_posts", label: "Creator posts", provider: "harvestapi", jobId: "linkedin.person.posts", endpointId: "harvestapi-profile-posts", fallbackMicros: 4_000 },
  post_search: { step: "post_search", label: "Topic post search", provider: "harvestapi", jobId: "linkedin.post.search", endpointId: "harvestapi-post-search", fallbackMicros: 4_000 },
  engagement: { step: "engagement", label: "Post comments and reactions", provider: "fetchin", jobId: "linkedin.post.engagement", endpointId: "fetchin-post-engagement", fallbackMicros: 3_000 },
  profile: { step: "profile", label: "Profile read", provider: "fetchin", jobId: "linkedin.person.profile", endpointId: "fetchin-profile", fallbackMicros: 1_500 },
  company: { step: "company", label: "Company read", provider: "fetchin", jobId: "linkedin.company.profile", endpointId: "fetchin-company", fallbackMicros: 1_500 },
  hiring: { step: "hiring", label: "Open roles", provider: "predictleads", jobId: "jobs.company", endpointId: "predictleads-companies-job-openings", fallbackMicros: 10_000 },
  funding: { step: "funding", label: "Funding events", provider: "predictleads", jobId: "company.funding", endpointId: "predictleads-companies-financing-events", fallbackMicros: 10_000 },
  email_find: { step: "email_find", label: "Work email find", provider: "anysite", jobId: "people.email.find", endpointId: "anysite-api-linkedin-user-email", fallbackMicros: 3_598 },
  email_verify: { step: "email_verify", label: "Email verify", provider: "millionverifier", jobId: "people.email.verify", endpointId: "millionverifier-verify", fallbackMicros: 1_780 },
};

/** Fallback prices keyed by endpoint id, used only when the live catalog read fails. */
export const FALLBACK_PRICES: PriceMap = Object.fromEntries(Object.values(ENDPOINTS).map((e) => [e.endpointId, e.fallbackMicros]));

/** The endpoint definition for a step, with the email step overridden by the config. */
export function endpointFor(step: StepId, override?: { emailFind?: string; emailVerify?: string }): EndpointDef {
  const base = ENDPOINTS[step];
  if (step === "email_find" && override?.emailFind && override.emailFind !== base.endpointId) return { ...base, endpointId: override.emailFind, provider: override.emailFind.split("-")[0], fallbackMicros: 0 };
  if (step === "email_verify" && override?.emailVerify && override.emailVerify !== base.endpointId) return { ...base, endpointId: override.emailVerify, provider: override.emailVerify.split("-")[0], fallbackMicros: 0 };
  return base;
}

/** Inputs for each step. The parameter names are the ones the public catalog lists for the endpoint. */
export const inputs = {
  companyPosts: (url: string) => ({ url }),
  profilePosts: (profile: string, lookbackDays: number) => ({ profile, postedLimit: lookbackToLimit(lookbackDays) }),
  postSearch: (search: string, lookbackDays: number) => ({ search, postedLimit: lookbackToLimit(lookbackDays), sortBy: "date" }),
  engagement: (postUrlOrUrn: string, perPost: number) => ({ postUrlOrUrn, commentCount: perPost, reactionCount: perPost }),
  profile: (profileUrlOrUrn: string) => ({ profileUrlOrUrn }),
  company: (companyUrlOrUrn: string) => ({ companyUrlOrUrn }),
  hiring: (domain: string) => ({ company_id_or_domain: domain, active_only: true, limit: 25 }),
  funding: (domain: string, sinceIso: string) => ({ company_id_or_domain: domain, first_seen_at_from: sinceIso.slice(0, 10), limit: 10 }),
  emailFind: (profile: string) => ({ profile }),
  emailVerify: (email: string) => ({ email }),
};

/** harvestapi accepts 24h, week or month. The smallest value that covers the look-back. */
export function lookbackToLimit(days: number): "24h" | "week" | "month" {
  if (days <= 1) return "24h";
  if (days <= 7) return "week";
  return "month";
}
