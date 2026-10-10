import { defaultConfig, merge, type WarmConfig } from "./config";
import type { LoootRun, Runner } from "./looot";
import { SIGNAL_KINDS } from "./types";

/**
 * Sample data for demo mode. Every person, company, post and URL here is invented. No call is made and nothing is charged.
 * The shapes follow what the parsers read, so the demo runs through the same engine as a live run.
 */

export const DEMO_NOW = new Date("2026-10-09T10:00:00Z");

const daysAgo = (d: number) => new Date(DEMO_NOW.getTime() - d * 86_400_000).toISOString();
const li = (slug: string) => `https://www.linkedin.com/in/${slug}`;
const co = (slug: string) => `https://www.linkedin.com/company/${slug}`;

interface DemoCompany { slug: string; name: string; domain: string; industry: string; size: number; hiring?: string; fundedDaysAgo?: number }
interface DemoPerson { slug: string; name: string; headline: string; title: string; company: string; location: string; roleStartDaysAgo: number }

const COMPANIES: DemoCompany[] = [
  { slug: "brightloop", name: "Brightloop", domain: "brightloop.example", industry: "Software Development", size: 120, hiring: "Growth Marketing Manager", fundedDaysAgo: 40 },
  { slug: "fernwood-labs", name: "Fernwood Labs", domain: "fernwoodlabs.example", industry: "Software Development", size: 45, hiring: "Demand Generation Lead" },
  { slug: "quillbase", name: "Quillbase", domain: "quillbase.example", industry: "Internet Publishing", size: 210 },
  { slug: "tallow-systems", name: "Tallow Systems", domain: "tallowsystems.example", industry: "Software Development", size: 18 },
  { slug: "palisade-metrics", name: "Palisade Metrics", domain: "palisademetrics.example", industry: "Information Technology", size: 340, fundedDaysAgo: 75 },
  { slug: "halcyon-works", name: "Halcyon Works", domain: "halcyonworks.example", industry: "Industrial Machinery Manufacturing", size: 800 },
  { slug: "ostrava-cloud", name: "Ostrava Cloud", domain: "ostravacloud.example", industry: "Information Technology", size: 95, hiring: "Revenue Operations Manager" },
];

const PEOPLE: DemoPerson[] = [
  { slug: "mara-lindqvist-d1", name: "Mara Lindqvist", headline: "Head of Growth at Brightloop", title: "Head of Growth", company: "brightloop", location: "Stockholm, Sweden", roleStartDaysAgo: 24 },
  { slug: "tomas-okafor-d2", name: "Tomas Okafor", headline: "VP Marketing at Fernwood Labs", title: "VP Marketing", company: "fernwood-labs", location: "Lagos, Nigeria", roleStartDaysAgo: 700 },
  { slug: "ines-vargas-d3", name: "Ines Vargas", headline: "Director of Demand Generation at Quillbase", title: "Director of Demand Generation", company: "quillbase", location: "Madrid, Spain", roleStartDaysAgo: 400 },
  { slug: "daniel-reyes-d4", name: "Daniel Reyes", headline: "Founder at Tallow Systems", title: "Founder", company: "tallow-systems", location: "Austin, United States", roleStartDaysAgo: 900 },
  { slug: "hana-sato-d5", name: "Hana Sato", headline: "Head of Revenue Operations at Brightloop", title: "Head of Revenue Operations", company: "brightloop", location: "Tokyo, Japan", roleStartDaysAgo: 300 },
  { slug: "oskar-berg-d6", name: "Oskar Berg", headline: "CMO at Palisade Metrics", title: "CMO", company: "palisade-metrics", location: "Oslo, Norway", roleStartDaysAgo: 50 },
  { slug: "leila-haddad-d7", name: "Leila Haddad", headline: "Growth Lead at Fernwood Labs", title: "Growth Lead", company: "fernwood-labs", location: "Casablanca, Morocco", roleStartDaysAgo: 200 },
  { slug: "marcus-webb-d8", name: "Marcus Webb", headline: "Account Executive at Quillbase", title: "Account Executive", company: "quillbase", location: "Leeds, United Kingdom", roleStartDaysAgo: 150 },
  { slug: "sofia-petrova-d9", name: "Sofia Petrova", headline: "VP Growth at Tallow Systems", title: "VP Growth", company: "tallow-systems", location: "Sofia, Bulgaria", roleStartDaysAgo: 600 },
  { slug: "ravi-menon-d10", name: "Ravi Menon", headline: "Marketing Manager at Palisade Metrics", title: "Marketing Manager", company: "palisade-metrics", location: "Pune, India", roleStartDaysAgo: 500 },
  { slug: "chloe-martin-d11", name: "Chloe Martin", headline: "Recruiter at Brightloop", title: "Recruiter", company: "brightloop", location: "Lyon, France", roleStartDaysAgo: 100 },
  { slug: "jonas-keller-d12", name: "Jonas Keller", headline: "Head of Product Marketing at Halcyon Works", title: "Head of Product Marketing", company: "halcyon-works", location: "Zurich, Switzerland", roleStartDaysAgo: 800 },
  { slug: "amara-nwosu-d13", name: "Amara Nwosu", headline: "Director of Marketing at Halcyon Works", title: "Director of Marketing", company: "halcyon-works", location: "Accra, Ghana", roleStartDaysAgo: 90 },
  { slug: "pieter-devries-d14", name: "Pieter de Vries", headline: "Student at a business school", title: "Student", company: "", location: "Utrecht, Netherlands", roleStartDaysAgo: 30 },
  { slug: "yuki-tanaka-d15", name: "Yuki Tanaka", headline: "Head of Demand Generation at Ostrava Cloud", title: "Head of Demand Generation", company: "ostrava-cloud", location: "Osaka, Japan", roleStartDaysAgo: 35 },
  { slug: "elena-rossi-d16", name: "Elena Rossi", headline: "CRO at Ostrava Cloud", title: "CRO", company: "ostrava-cloud", location: "Milan, Italy", roleStartDaysAgo: 1200 },
  { slug: "gabriel-costa-d17", name: "Gabriel Costa", headline: "Freelance growth consultant", title: "Freelance consultant", company: "", location: "Lisbon, Portugal", roleStartDaysAgo: 400 },
  { slug: "nadia-karim-d18", name: "Nadia Karim", headline: "Head of Growth at Quillbase", title: "Head of Growth", company: "quillbase", location: "Cairo, Egypt", roleStartDaysAgo: 260 },
];

interface DemoPost { id: string; url: string; text: string; daysAgo: number; likes: number; comments: number; author?: string }
const post = (id: string, text: string, d: number, likes: number, comments: number, author?: string): DemoPost => ({ id, url: `https://www.linkedin.com/posts/demo_${id}`, text, daysAgo: d, likes, comments, author });

export const DEMO_COMPETITORS = [
  { name: "Northwind Analytics", linkedinUrl: co("northwind-analytics"), domain: "northwind-analytics.example" },
  { name: "Lumen CRM", linkedinUrl: co("lumen-crm"), domain: "lumen-crm.example" },
];
export const DEMO_CREATORS = [{ name: "Kasper Holm", linkedinUrl: li("kasper-holm-d0") }];
export const DEMO_KEYWORDS = ["product-led growth", "pipeline attribution"];

const COMPANY_POSTS: Record<string, DemoPost[]> = {
  "northwind-analytics": [
    post("northwind_1", "We shipped multi-touch attribution for self-serve funnels.", 3, 140, 22),
    post("northwind_2", "How three SaaS teams cut reporting time in half.", 6, 60, 9),
    post("northwind_3", "Webinar recap: forecasting with messy data.", 13, 20, 2),
  ],
  "lumen-crm": [
    post("lumen_1", "Lumen 4.0: a CRM that fits a two-person sales team.", 2, 90, 14),
    post("lumen_2", "Pricing change: the starter plan is now free up to 3 seats.", 9, 30, 11),
  ],
};
const CREATOR_POSTS: Record<string, DemoPost[]> = {
  "kasper-holm-d0": [post("kasper_1", "Most growth teams measure the wrong thing in month one.", 4, 210, 31), post("kasper_2", "A template for a weekly growth review.", 10, 80, 6)],
};
const KEYWORD_POSTS: Record<string, DemoPost[]> = {
  "product-led growth": [
    post("plg_1", "We moved from sales-led to product-led growth in 9 months. What we got wrong.", 5, 120, 18, "jonas-keller-d12"),
    post("plg_2", "Product-led growth needs a pricing page that a developer can read.", 8, 45, 7, "leila-haddad-d7"),
    post("plg_3", "Our PLG onboarding teardown, with numbers.", 11, 70, 12, "ines-vargas-d3"),
  ],
  "pipeline attribution": [
    post("attr_1", "Pipeline attribution without a data team: what we use.", 6, 95, 20, "oskar-berg-d6"),
    post("attr_2", "Why last-touch attribution fails for long B2B cycles.", 12, 40, 5, "tomas-okafor-d2"),
  ],
};

type Eng = [slug: string, type: "comment" | "reaction", text: string | null, daysAgo: number];
const ENGAGEMENT: Record<string, Eng[]> = {
  northwind_1: [
    ["mara-lindqvist-d1", "comment", "We are looking at this for our self-serve funnel. How does it handle a free trial that converts after 30 days?", 3],
    ["hana-sato-d5", "reaction", null, 3],
    ["nadia-karim-d18", "comment", "Would like to see a comparison against last-touch.", 2],
    ["marcus-webb-d8", "reaction", null, 3],
    ["chloe-martin-d11", "reaction", null, 3],
    ["pieter-devries-d14", "reaction", null, 2],
  ],
  northwind_2: [
    ["oskar-berg-d6", "comment", "Half is generous, but the direction is right.", 5],
    ["ravi-menon-d10", "reaction", null, 5],
    ["nadia-karim-d18", "reaction", null, 6],
  ],
  lumen_1: [
    ["tomas-okafor-d2", "reaction", null, 2],
    ["yuki-tanaka-d15", "comment", "Two-person sales teams are exactly our situation right now.", 1],
    ["daniel-reyes-d4", "reaction", null, 2],
    ["gabriel-costa-d17", "comment", "Great launch, congratulations.", 2],
  ],
  lumen_2: [
    ["sofia-petrova-d9", "reaction", null, 8],
    ["yuki-tanaka-d15", "reaction", null, 8],
    ["elena-rossi-d16", "reaction", null, 7],
  ],
  kasper_1: [
    ["mara-lindqvist-d1", "reaction", null, 4],
    ["leila-haddad-d7", "comment", "Month one is all about activation for us, not traffic.", 3],
    ["amara-nwosu-d13", "reaction", null, 4],
  ],
  kasper_2: [["hana-sato-d5", "reaction", null, 9]],
  plg_1: [["ines-vargas-d3", "comment", "The pricing page point is the one we ignored longest.", 4], ["nadia-karim-d18", "reaction", null, 5]],
  plg_2: [["mara-lindqvist-d1", "reaction", null, 7]],
  plg_3: [["oskar-berg-d6", "reaction", null, 10]],
  attr_1: [["tomas-okafor-d2", "comment", "We run this on a spreadsheet and a webhook. Not pretty, works.", 5], ["ravi-menon-d10", "reaction", null, 5]],
  attr_2: [["hana-sato-d5", "reaction", null, 11]],
};

const allPosts = [...Object.values(COMPANY_POSTS).flat(), ...Object.values(CREATOR_POSTS).flat(), ...Object.values(KEYWORD_POSTS).flat()];
const byUrl = new Map(allPosts.map((p) => [p.url, p]));
const person = (slug: string) => PEOPLE.find((p) => p.slug === slug);
const personRow = (slug: string) => ({ name: person(slug)?.name, headline: person(slug)?.headline, linkedinUrl: li(slug) });

function postRow(p: DemoPost) {
  return { linkedinUrl: p.url, content: p.text, postedAt: { timestamp: Date.parse(daysAgo(p.daysAgo)), date: daysAgo(p.daysAgo) }, engagement: { likes: p.likes, comments: p.comments }, ...(p.author ? { author: personRow(p.author) } : {}) };
}

function respond(endpointId: string, input: Record<string, unknown>): unknown {
  switch (endpointId) {
    case "scrapecreators-linkedin-company-posts": {
      const slug = /company\/([^/?#]+)/.exec(String(input.url))?.[1] ?? "";
      return { posts: (COMPANY_POSTS[slug] ?? []).map(postRow) };
    }
    case "harvestapi-profile-posts": {
      const slug = /in\/([^/?#]+)/.exec(String(input.profile))?.[1] ?? "";
      return { elements: (CREATOR_POSTS[slug] ?? []).map(postRow) };
    }
    case "harvestapi-post-search":
      return { elements: (KEYWORD_POSTS[String(input.search)] ?? []).map(postRow) };
    case "fetchin-post-engagement": {
      const url = String(input.postUrlOrUrn);
      const post = byUrl.get(url);
      const id = post ? Object.keys(ENGAGEMENT).find((k) => url.endsWith(`demo_${k}`)) : undefined;
      const rows = id ? ENGAGEMENT[id] : [];
      return {
        comments: rows.filter((r) => r[1] === "comment").map((r) => ({ author: personRow(r[0]), text: r[2], createdAt: daysAgo(r[3]) })),
        reactions: rows.filter((r) => r[1] === "reaction").map((r) => ({ reactor: personRow(r[0]), type: "LIKE" })),
      };
    }
    case "fetchin-profile": {
      const p = person(/in\/([^/?#]+)/.exec(String(input.profileUrlOrUrn))?.[1] ?? "");
      if (!p) return {};
      const c = COMPANIES.find((x) => x.slug === p.company);
      return {
        firstName: p.name.split(" ")[0],
        lastName: p.name.split(" ").slice(1).join(" "),
        headline: p.headline,
        location: p.location,
        experiences: c ? [{ title: p.title, companyName: c.name, companyUrl: co(c.slug), startDate: daysAgo(p.roleStartDaysAgo) }] : [{ title: p.title, startDate: daysAgo(p.roleStartDaysAgo) }],
      };
    }
    case "fetchin-company": {
      const c = COMPANIES.find((x) => String(input.companyUrlOrUrn).endsWith(`/${x.slug}`));
      return c ? { name: c.name, website: `https://www.${c.domain}`, industry: c.industry, employeeCount: c.size } : {};
    }
    case "predictleads-companies-job-openings": {
      const c = COMPANIES.find((x) => x.domain === input.company_id_or_domain);
      return { data: c?.hiring ? [{ id: "j1", type: "job_opening", attributes: { title: c.hiring, first_seen_at: daysAgo(9), url: `https://${c.domain}/careers` } }] : [] };
    }
    case "predictleads-companies-financing-events": {
      const c = COMPANIES.find((x) => x.domain === input.company_id_or_domain);
      return { data: c?.fundedDaysAgo ? [{ id: "f1", type: "financing_event", attributes: { financing_type: "Series A", effective_date: daysAgo(c.fundedDaysAgo), url: `https://${c.domain}/news` } }] : [] };
    }
    case "anysite-api-linkedin-user-email": {
      const slug = /in\/([^/?#]+)/.exec(String(input.profile))?.[1] ?? "";
      const p = person(slug);
      const c = COMPANIES.find((x) => x.slug === p?.company);
      if (!p || !c || p.slug.includes("d4")) return { emails: [] };
      return { emails: [{ email: `${p.name.toLowerCase().split(" ")[0]}@${c.domain}` }] };
    }
    case "millionverifier-verify":
      return { email: input.email, result: String(input.email).startsWith("ravi") ? "catch_all" : "ok", quality: "good" };
    default:
      return {};
  }
}

/** A runner that answers from the sample data. It charges nothing. */
export function demoRunner(): Runner {
  let n = 0;
  return {
    async runAndWait(endpointId, input, idempotencyKey): Promise<LoootRun> {
      n += 1;
      void idempotencyKey;
      return { runId: `demo_${n}`, status: "completed", result: respond(endpointId, input), actualCost: 0 };
    },
  };
}

/** The config the demo scores with: sample ICP, sources and triggers on. */
export function demoConfig(): WarmConfig {
  const cfg = merge(defaultConfig(), {
    icp: {
      description: "Heads of growth, demand generation and revenue at B2B software companies with 20 to 500 people.",
      titles: ["head of growth", "vp growth", "head of demand generation", "director of demand generation", "director of marketing", "head of revenue operations", "growth lead", "founder", "cmo", "vp marketing"],
      excludeTitles: ["intern", "student", "recruiter", "freelance", "account executive"],
      seniority: ["head of", "vp", "director", "chief", "founder", "cmo", "cro", "lead"],
      industries: ["software", "information technology", "internet"],
      countries: [],
      companySize: { min: 20, max: 500 },
    },
    sources: { competitors: DEMO_COMPETITORS, creators: DEMO_CREATORS, keywords: DEMO_KEYWORDS, posts: [] },
    triggers: { newRole: true, hiring: true, funding: true },
    sender: { name: "Alex Demo", company: "Acme Analytics", offer: "attribution reporting for self-serve SaaS funnels" },
    limits: { engagementPostsPerSource: 3, postsPerSource: 5 },
  });
  for (const k of SIGNAL_KINDS) if (!cfg.scoring.signals[k]) throw new Error(`missing ${k}`);
  return cfg;
}
