/** The kinds of intent signal this app scores. Weights and half-lives for each live in config/warm.config.json. */
export type SignalKind =
  | "competitor_comment"
  | "competitor_reaction"
  | "creator_comment"
  | "creator_reaction"
  | "topic_post"
  | "topic_comment"
  | "topic_reaction"
  | "post_comment"
  | "post_reaction"
  | "new_role"
  | "hiring"
  | "funding";

export const SIGNAL_KINDS: SignalKind[] = [
  "competitor_comment",
  "competitor_reaction",
  "creator_comment",
  "creator_reaction",
  "topic_post",
  "topic_comment",
  "topic_reaction",
  "post_comment",
  "post_reaction",
  "new_role",
  "hiring",
  "funding",
];

export type Band = "hot" | "warm" | "cool";

/** One thing a person or their company did, with the provider that reported it and a link to check it. */
export interface SignalEvent {
  kind: SignalKind;
  provider: string;
  endpointId: string;
  /** ISO date the thing happened. null when the provider gave none. */
  date: string | null;
  /** What happened, in one line: "Commented on a post by Northwind". */
  title: string;
  /** Short quote from the comment or post, at most 160 characters. */
  snippet?: string;
  /** Where to check it: the post, the job ad, the funding news. */
  url?: string;
  /** The source the user set up that produced it: a competitor, a creator, a keyword. */
  source: string;
  /** This event's share of the cost of the call that found it, in micro-dollars. */
  costMicros: number;
}

/** A person found by a source, before the profile is read. */
export interface Candidate {
  linkedinUrl: string;
  name: string;
  headline?: string;
  events: SignalEvent[];
}

export interface FitLine {
  criterion: "title" | "seniority" | "industry" | "location" | "company_size";
  label: string;
  maxPoints: number;
  points: number;
  /** What was compared, or why nothing could be: "Head of Growth matches Head of", "no industry in the data". */
  detail: string;
}

/** One line of the breakdown: the signal or fit criterion, who supplied it, its weight, what it added and what it cost. */
export interface BreakdownLine {
  type: "intent" | "fit";
  /** A signal kind for intent lines, a fit criterion for fit lines. */
  key: string;
  label: string;
  provider: string;
  endpointId: string;
  /** The most this line can add, from its weight. */
  maxPoints: number;
  points: number;
  eventCount: number;
  /** Most recent event date on this line. */
  date: string | null;
  costMicros: number;
  summary: string;
  /** Links to check the evidence, newest first, at most three. */
  evidence: { url: string; date: string | null; title: string }[];
}

export interface EmailResult {
  address: string | null;
  /** The verifier's own word: ok, catch_all, unknown, invalid, disposable. */
  status: string;
  deliverable: boolean;
  findProvider: string;
  verifyProvider: string;
  costMicros: number;
  at: string;
  /** Set when a step is still running at the provider. Not a failure. */
  pending?: boolean;
}

export interface Drafts {
  connectionNote: string;
  followUp: string;
  email: { subject: string; body: string };
  /** "template" or "llm". */
  by: string;
  /** Names the signal the draft refers to. */
  signalRef: string;
  /** Set when the connection note is longer than LinkedIn allows. */
  warnings: string[];
  edited: boolean;
}

export interface Reply {
  at: string;
  text: string;
  chatId?: string;
  messageId?: string;
}

export interface Lead {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  linkedinUrl: string;
  headline?: string;
  title?: string;
  company?: string;
  companyLinkedinUrl?: string;
  companyDomain?: string;
  industry?: string;
  companySize?: number;
  location?: string;
  events: SignalEvent[];
  fit: FitLine[];
  fitPoints: number;
  intentPoints: number;
  /** Intent before the maximum is applied, for ordering leads that tie at the cap. */
  rawIntent: number;
  score: number;
  band: Band;
  breakdown: BreakdownLine[];
  /** Plain sentences naming the signals behind the score, strongest first. */
  reasons: string[];
  /** Profile and company reads. Not part of any event. */
  enrichCostMicros: number;
  costMicros: number;
  /** false when the profile could not be read: fit is then only what the headline shows. */
  enriched: boolean;
  firstSeen: string;
  lastSeen: string;
  /** true when the lead was not in the list at the start of the latest run. */
  isNew: boolean;
  email?: EmailResult;
  drafts?: Drafts;
  replies: Reply[];
  /** Why the lead is out of the list: do-not-contact, excluded title. Empty when it is in. */
  excluded?: string;
}

export type CallStatus = "ok" | "failed" | "pending" | "skipped_cap" | "skipped_budget" | "skipped_price" | "parse_error";

export interface CallRecord {
  endpointId: string;
  stage: string;
  status: CallStatus;
  listPriceMicros: number;
  costMicros: number;
  runId?: string;
  message?: string;
}

export interface QuoteLine {
  endpointId: string;
  jobId: string;
  provider: string;
  label: string;
  /** The most calls the run can make for this step, from the limits in the config. */
  calls: number;
  priceMicros: number;
  totalMicros: number;
}

export interface Quote {
  lines: QuoteLine[];
  /** Upper bound at list price. The run usually costs less: it stops at the limits only when the sources return enough. */
  totalMicros: number;
  priceSource: "catalog" | "fallback";
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  demo: boolean;
  capMicros: number;
  quotedMicros: number;
  spentMicros: number;
  skippedByCap: number;
  /** Calls not made because the period budget would have been passed. */
  skippedByBudget?: number;
  /** The refusal text when the period budget stopped a call. */
  budgetMessage?: string | null;
  pendingCalls: number;
  failedCalls: number;
  aborted: string | null;
  quote: Quote;
  calls: CallRecord[];
  candidates: number;
  enriched: number;
  leads: number;
  newLeads: number;
  /** Ids of leads first seen in this run. */
  newLeadIds: string[];
  /** Why the run stopped short, in plain words. */
  notes: string[];
}

export interface OutboxItem {
  /** Idempotency key: lead id and step. One per lead and step, so a retry never creates a second message. */
  id: string;
  leadId: string;
  step: "invite" | "followup";
  text: string;
  /** Hash of the text the user reviewed. Approval is void when the text no longer matches. */
  approvedHash?: string;
  status: "draft" | "approved" | "sending" | "sent" | "failed" | "unknown" | "cancelled" | "skipped";
  approvedAt?: string;
  /** For a follow-up: not before this time. Set when the invitation is accepted. */
  notBefore?: string;
  sentAt?: string;
  chatId?: string;
  invitationId?: string;
  /** LinkedIn's internal id for the person, read from their profile through Unipile before the first send. */
  providerId?: string;
  /** When acceptance was last checked, for the daily check limit and random spacing. */
  lastCheckedAt?: string;
  message?: string;
}

export interface SenderState {
  paused: boolean;
  /** Next time any send is allowed, set after each send to a random gap. */
  nextSendAt?: string;
  items: OutboxItem[];
  /** Unipile account id, set by the hosted auth callback. */
  accountId?: string;
  /** Hashes of do-not-contact entries: LinkedIn URLs, emails, domains. */
  dnc: string[];
  /** Sent-action log used for the daily caps. */
  sentLog: { at: string; step: "invite" | "followup" }[];
  /** Profile visits made to check acceptance, for the daily limit. */
  checkLog: string[];
  /** Hashes of people erased on request. They are not added back by later runs. */
  suppressed: string[];
}

export interface State {
  leads: Record<string, Lead>;
  lastRun: RunSummary | null;
  runs: RunSummary[];
  /** Email lookups and other paid steps outside a discovery run. */
  spendLog: { at: string; what: string; micros: number }[];
  sender: SenderState;
  /** Admin actions that change what the app may do: the live-send switch and every live send. Newest last. */
  audit?: AuditEntry[];
}

export interface AuditEntry {
  at: string;
  /** Who: "admin" with a short session id, or "cli" for a command run on the machine. */
  actor: string;
  action: "live_send_on" | "live_send_off" | "live_send_refused" | "live_tick";
  detail: string;
}
