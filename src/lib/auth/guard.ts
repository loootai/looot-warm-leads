import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { adminPolicy, type AdminPolicy, type Env } from "./policy";
import { hasRealData } from "./realData";
import { CSRF_HEADER, SESSION_COOKIE, cookieFrom, csrfOk, csrfToken, verifySession } from "./session";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type GateResult = { ok: true; policy: AdminPolicy; sid?: string } | { ok: false; status: 401 | 403 | 503; error: string; reason: "no_session" | "setup" | "csrf" | "origin"; policy: AdminPolicy };

/** true when a request that changes state comes from this app's own origin. */
export function sameOrigin(h: Headers): boolean {
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const origin = h.get("origin");
  if (origin) {
    try {
      return !!host && new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const site = h.get("sec-fetch-site");
  return site === "same-origin" || site === "none";
}

/**
 * The one admin check. Pure apart from reading the data file once for demo mode.
 * Open demo passes. Setup mode refuses. Login mode needs a valid session, and for a state-changing
 * method also a same-origin request and the CSRF token that belongs to that session.
 */
export async function checkAdmin(method: string, h: Headers, env: Env = process.env, realData: boolean = hasRealData(env)): Promise<GateResult> {
  const policy = adminPolicy(env, realData);
  const writes = !SAFE_METHODS.has(method.toUpperCase());
  if (policy.mode === "setup") return { ok: false, status: 503, error: "Admin sign-in is not set up. See /login for what to set.", reason: "setup", policy };
  if (policy.mode === "open-demo") return writes && !sameOrigin(h) ? { ok: false, status: 403, error: "Cross-site request refused.", reason: "origin", policy } : { ok: true, policy };
  const session = await verifySession(env, cookieFrom(h.get("cookie"), SESSION_COOKIE));
  if (!session) return { ok: false, status: 401, error: "Sign in required.", reason: "no_session", policy };
  if (writes && !sameOrigin(h)) return { ok: false, status: 403, error: "Cross-site request refused.", reason: "origin", policy };
  if (writes && !(await csrfOk(env, session.sid, h.get(CSRF_HEADER)))) return { ok: false, status: 403, error: "Missing or wrong CSRF token. Reload the page.", reason: "csrf", policy };
  return { ok: true, policy, sid: session.sid };
}

/** The JSON refusal an admin API route returns. Never cached. */
export function denied(r: Extract<GateResult, { ok: false }>): NextResponse {
  return NextResponse.json({ error: r.error }, { status: r.status, headers: { "Cache-Control": "no-store" } });
}

/** First line of every admin route handler. Returns a response to send back, or null to carry on. */
export async function requireAdminRoute(req: Request): Promise<NextResponse | null> {
  const r = await checkAdmin(req.method, req.headers);
  return r.ok ? null : denied(r);
}

/** First line of every admin page and of the root layout. Sends the browser to /login when it has no session. */
export async function requireAdminPage(): Promise<GateResult & { ok: true }> {
  const c = await cookies();
  const merged = new Headers({ cookie: c.toString() });
  const r = await checkAdmin("GET", merged);
  if (!r.ok) redirect("/login");
  return r;
}

/** The CSRF token for the current session, for the layout to put in a meta tag. Empty in open demo. */
export async function currentCsrf(env: Env = process.env): Promise<string> {
  const c = await cookies();
  const s = await verifySession(env, c.get(SESSION_COOKIE)?.value);
  return s ? csrfToken(env, s.sid) : "";
}
