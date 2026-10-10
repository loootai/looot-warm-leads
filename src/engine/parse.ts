import { dateOf, isRec, rowsOf, str, type Rec } from "./read";

/**
 * Readers for provider response bodies. They are written from each endpoint's documented parameters and description,
 * not from captured responses (no paid run was made), so they accept several likely field names and return nothing
 * on a shape they do not know. A parse that finds no rows is reported as "no data", never as a failure.
 */

/** Canonical form of a personal LinkedIn profile URL, or null for anything else (company pages, posts, junk). */
export function normalizeProfileUrl(input: string | undefined | null): string | null {
  if (!input) return null;
  const m = /linkedin\.com\/in\/([^/?#\s]+)/i.exec(input.trim());
  if (!m) return null;
  let slug = m[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    /* keep the raw slug */
  }
  return `https://www.linkedin.com/in/${slug.toLowerCase()}`;
}

/** Canonical LinkedIn company page URL, or null. */
export function normalizeCompanyUrl(input: string | undefined | null): string | null {
  if (!input) return null;
  const m = /linkedin\.com\/(?:company|school)\/([^/?#\s]+)/i.exec(input.trim());
  return m ? `https://www.linkedin.com/company/${m[1].toLowerCase()}` : null;
}

export function clip(s: string | undefined, n = 160): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
}

const PERSON_WRAPPERS = ["author", "actor", "reactor", "commenter", "profile", "user", "member", "person", "from"];

export interface Person {
  linkedinUrl: string;
  name: string;
  headline?: string;
}

/** The person behind a comment, reaction or post row. null when no personal profile URL can be found. */
export function personOf(row: Rec): Person | null {
  let rec: Rec = row;
  for (const k of PERSON_WRAPPERS) {
    const inner = row[k];
    if (isRec(inner)) {
      rec = { ...row, ...inner };
      break;
    }
  }
  const urlText = str(rec, "linkedinUrl", "linkedin_url", "profileUrl", "profile_url", "url", "link", "profileLink");
  const slug = str(rec, "publicIdentifier", "public_identifier", "vanityName", "username");
  const url = normalizeProfileUrl(urlText) ?? (slug ? normalizeProfileUrl(`https://www.linkedin.com/in/${slug}`) : null);
  if (!url) return null;
  const name = str(rec, "name", "fullName", "full_name", "authorName") ?? [str(rec, "firstName", "first_name"), str(rec, "lastName", "last_name")].filter(Boolean).join(" ");
  if (!name) return null;
  return { linkedinUrl: url, name, headline: clip(str(rec, "headline", "occupation", "title", "position", "jobTitle"), 140) };
}

export interface PostRow {
  url: string;
  text: string;
  date: string | null;
  engagement: number;
  author: Person | null;
}

function postDate(r: Rec): string | null {
  const direct = dateOf(r, "postedAt", "posted_at", "createdAt", "created_at", "publishedAt", "published_at", "date", "time", "timestamp");
  if (direct) return direct;
  for (const k of ["postedAt", "posted_at", "createdAt", "published"]) {
    const v = r[k];
    if (isRec(v)) {
      const d = dateOf(v, "date", "timestamp", "iso", "value");
      if (d) return d;
    }
  }
  return null;
}

function engagementCount(r: Rec): number {
  let n = 0;
  const nested = isRec(r.engagement) ? r.engagement : r;
  for (const k of ["likes", "numLikes", "likeCount", "reactions", "reactionCount", "comments", "numComments", "commentCount", "commentsCount", "shares", "numShares"]) {
    const v = nested[k] ?? r[k];
    if (typeof v === "number" && Number.isFinite(v)) n += v;
  }
  return n;
}

/** Posts from a company-posts, profile-posts or post-search body. Rows without a post URL are dropped. */
export function parsePosts(result: unknown): PostRow[] {
  const out: PostRow[] = [];
  for (const r of rowsOf(result, ["posts", "data", "items", "results", "elements"])) {
    const url = str(r, "linkedinUrl", "postUrl", "post_url", "url", "link", "shareUrl", "share_url", "permalink");
    if (!url || !/linkedin\.com/i.test(url)) continue;
    out.push({ url, text: str(r, "content", "text", "commentary", "description", "title") ?? "", date: postDate(r), engagement: engagementCount(r), author: personOf(r) });
  }
  return out;
}

export interface Engager {
  person: Person;
  type: "comment" | "reaction";
  text?: string;
  date: string | null;
}

function listUnder(result: unknown, keys: string[]): Rec[] {
  if (!isRec(result)) return [];
  for (const k of keys) {
    const v = result[k];
    if (Array.isArray(v)) return v.filter(isRec);
    if (isRec(v)) {
      const inner = listUnder(v, ["items", "data", "elements", "results"]);
      if (inner.length) return inner;
    }
  }
  for (const k of ["data", "result", "body"]) {
    const inner = result[k];
    if (isRec(inner)) {
      const rows = listUnder(inner, keys);
      if (rows.length) return rows;
    }
  }
  return [];
}

/** Commenters and reactors from a post-engagement body (`comments` and `reactions` lists). */
export function parseEngagement(result: unknown): Engager[] {
  const out: Engager[] = [];
  for (const r of listUnder(result, ["comments"])) {
    const person = personOf(r);
    if (person) out.push({ person, type: "comment", text: clip(str(r, "text", "comment", "commentary", "content", "message")), date: dateOf(r, "createdAt", "created_at", "postedAt", "date", "timestamp") });
  }
  for (const r of listUnder(result, ["reactions", "likes", "reactors"])) {
    const person = personOf(r);
    if (person) out.push({ person, type: "reaction", date: dateOf(r, "createdAt", "created_at", "date", "timestamp") });
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A loose date: ISO text, "Jan 2026", {year, month}, epoch. Returns ISO or null. */
export function looseDate(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return new Date(t).toISOString();
    const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/.exec(v);
    if (m) {
      const mi = MONTHS.indexOf(m[1].toLowerCase());
      if (mi >= 0) return new Date(Date.UTC(Number(m[2]), mi, 1)).toISOString();
    }
    return null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e11 ? v * 1000 : v).toISOString();
  if (isRec(v)) {
    const y = typeof v.year === "number" ? v.year : Number(v.year);
    if (Number.isFinite(y) && y > 1900) {
      const mo = typeof v.month === "number" ? v.month : Number(v.month);
      return new Date(Date.UTC(y, Number.isFinite(mo) && mo >= 1 ? mo - 1 : 0, 1)).toISOString();
    }
  }
  return null;
}

export interface ProfileData {
  name?: string;
  headline?: string;
  title?: string;
  company?: string;
  companyUrl?: string;
  /** When the current role started, ISO. null when the profile does not say. */
  roleStart: string | null;
  location?: string;
}

function placeText(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (isRec(v)) return str(v, "name", "city", "country", "text", "full", "default");
  return undefined;
}

/** Name, headline, current title and company, role start date and location from a profile body. */
export function parseProfile(result: unknown): ProfileData | null {
  let root: unknown = result;
  if (isRec(root)) for (const k of ["data", "result", "profile"]) if (isRec(root) && isRec(root[k])) root = root[k];
  if (!isRec(root)) return null;
  const obj: Record<string, unknown> = root;
  const firstName = str(root, "firstName", "first_name");
  const lastName = str(root, "lastName", "last_name");
  const name = str(root, "name", "fullName", "full_name") ?? ([firstName, lastName].filter(Boolean).join(" ") || undefined);
  const exps = ["experiences", "experience", "positions", "workExperience"].map((k) => obj[k]).find(Array.isArray) as unknown[] | undefined;
  const list = (exps ?? []).filter(isRec);
  const current = list.find((e) => e.isCurrent === true || e.current === true || !(e.endDate ?? e.end ?? e.endedOn ?? e.end_date)) ?? list[0];
  let company = current ? str(current, "companyName", "company_name", "company", "organization") : undefined;
  let companyUrl: string | undefined;
  if (current) {
    companyUrl = normalizeCompanyUrl(str(current, "companyUrl", "company_url", "companyLinkedinUrl", "companyLink", "linkedinUrl")) ?? undefined;
    if (isRec(current.company)) {
      company = company ?? str(current.company, "name");
      companyUrl = companyUrl ?? normalizeCompanyUrl(str(current.company, "url", "linkedinUrl", "link")) ?? undefined;
    }
  }
  const roleStart = current ? looseDate(current.startDate ?? current.start ?? current.startedOn ?? current.start_date ?? current.from) ?? looseDate(isRec(current.dateRange) ? current.dateRange.start : undefined) : null;
  const headline = clip(str(root, "headline", "occupation", "summary"), 140);
  const title = (current ? str(current, "title", "position", "jobTitle", "role") : undefined) ?? undefined;
  if (!name && !headline && !title) return null;
  return { name, headline, title, company, companyUrl, roleStart, location: placeText(root.location ?? root.geo ?? root.country) };
}

export interface CompanyData {
  name?: string;
  domain?: string;
  industry?: string;
  size?: number;
}

/** Domain from a website URL: lower-case host without "www.". */
export function domainOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const h = url.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : undefined;
}

/** Name, website domain, industry and headcount from a company body. */
export function parseCompany(result: unknown): CompanyData | null {
  let root: unknown = result;
  if (isRec(root)) for (const k of ["data", "result", "company"]) if (isRec(root) && isRec(root[k])) root = root[k];
  if (!isRec(root)) return null;
  const name = str(root, "name", "companyName", "localizedName");
  const industryRaw = root.industry ?? root.industries;
  const industry = Array.isArray(industryRaw) ? (typeof industryRaw[0] === "string" ? industryRaw[0] : isRec(industryRaw[0]) ? str(industryRaw[0], "name") : undefined) : typeof industryRaw === "string" ? industryRaw : isRec(industryRaw) ? str(industryRaw, "name") : undefined;
  let size: number | undefined;
  for (const k of ["employeeCount", "employee_count", "staffCount", "staff_count", "employees", "headcount", "companySize"]) {
    const v = root[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      size = v;
      break;
    }
    if (typeof v === "string") {
      const m = /(\d[\d,]*)/.exec(v);
      if (m) {
        size = Number(m[1].replace(/,/g, ""));
        break;
      }
    }
  }
  const domain = domainOf(str(root, "website", "websiteUrl", "website_url", "domain", "companyUrl"));
  if (!name && !domain) return null;
  return { name, domain, industry, size };
}

export interface JobRow {
  title: string;
  date: string | null;
  url?: string;
}

/** Open roles from a PredictLeads-style body (JSON:API rows with `attributes`). */
export function parseJobs(result: unknown): JobRow[] {
  return rowsOf(result)
    .map((raw): JobRow | null => {
      const r = isRec(raw.attributes) ? { ...raw, ...raw.attributes } : raw;
      const title = str(r, "title", "job_title");
      return title ? { title, date: dateOf(r, "first_seen_at", "posted_at", "last_seen_at"), url: str(r, "url", "source_url") } : null;
    })
    .filter((x): x is JobRow => x !== null);
}

export interface FundingRow {
  title: string;
  date: string | null;
  url?: string;
}

/** Financing events from a PredictLeads-style body. */
export function parseFunding(result: unknown): FundingRow[] {
  return rowsOf(result)
    .map((raw): FundingRow | null => {
      const r = isRec(raw.attributes) ? { ...raw, ...raw.attributes } : raw;
      const date = dateOf(r, "effective_date", "announced_on", "date", "first_seen_at");
      const type = str(r, "financing_type", "type", "round", "category_code");
      const amount = str(r, "financing_type_amount", "amount", "financing_amount");
      if (!date && !type && !amount) return null;
      return { title: ["Funding", type, amount].filter(Boolean).join(": "), date, url: str(r, "url", "source_url", "source") };
    })
    .filter((x): x is FundingRow => x !== null);
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** The first email address found anywhere in a finder response. */
export function findEmail(v: unknown, depth = 0): string | null {
  if (depth > 8) return null;
  if (typeof v === "string") return EMAIL_RE.exec(v)?.[0]?.toLowerCase() ?? null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const e = findEmail(x, depth + 1);
      if (e) return e;
    }
  } else if (isRec(v)) {
    for (const k of ["email", "emails", "work_email", "workEmail", "address"]) {
      if (k in v) {
        const e = findEmail(v[k], depth + 1);
        if (e) return e;
      }
    }
    for (const x of Object.values(v)) {
      const e = findEmail(x, depth + 1);
      if (e) return e;
    }
  }
  return null;
}

const VERIFY_STATES = new Set(["ok", "catch_all", "unknown", "invalid", "disposable", "valid", "deliverable", "risky", "undeliverable"]);

/** The verifier's verdict: its own status word, and whether the address is safe to send to. */
export function parseVerify(result: unknown): { status: string; deliverable: boolean } | null {
  const find = (v: unknown, depth = 0): string | null => {
    if (depth > 6) return null;
    if (isRec(v)) {
      for (const k of ["result", "status", "state"]) {
        const x = v[k];
        if (typeof x === "string" && VERIFY_STATES.has(x.toLowerCase())) return x.toLowerCase();
      }
      for (const x of Object.values(v)) {
        const r = find(x, depth + 1);
        if (r) return r;
      }
    }
    return null;
  };
  const status = find(result);
  if (!status) return null;
  return { status, deliverable: status === "ok" || status === "valid" || status === "deliverable" };
}
