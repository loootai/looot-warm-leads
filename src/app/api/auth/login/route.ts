import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/auth/guard";
import { clearLoginFailures, clientIp, loginLocked, recordLoginFailure } from "@/lib/auth/limits";
import { verifyPassword } from "@/lib/auth/password";
import { adminPolicy } from "@/lib/auth/policy";
import { hasRealData } from "@/lib/auth/realData";
import { createSession, sessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/** Only same-site paths. Anything else goes to the feed. */
function safeNext(v: unknown): string {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") && !v.startsWith("/login") && !v.startsWith("/api/") ? v.slice(0, 200) : "/";
}

/** A 303 with a relative Location, so it works behind a proxy that rewrites the host. */
const see = (to: string, headers: Record<string, string> = {}) => new Response(null, { status: 303, headers: { Location: to, ...NO_STORE, ...headers } });

/**
 * Public by design: it is the sign-in. Accepts a form post or JSON { password }.
 * Wrong passwords are counted per address and overall. Five failures lock an address for 15 minutes.
 */
export async function POST(req: Request) {
  const env = process.env;
  const wantsJson = (req.headers.get("content-type") ?? "").includes("application/json");
  const fail = (status: number, message: string, headers: Record<string, string> = {}) =>
    wantsJson ? NextResponse.json({ error: message }, { status, headers: { ...NO_STORE, ...headers } }) : see(`/login?error=${status === 429 ? "locked" : "wrong"}`, headers);

  const policy = adminPolicy(env, hasRealData(env));
  if (policy.mode === "setup") return NextResponse.json({ error: "Admin sign-in is not set up." }, { status: 503, headers: NO_STORE });
  if (policy.mode === "open-demo") return NextResponse.json({ error: "The demo has no sign-in." }, { status: 400, headers: NO_STORE });
  if (!sameOrigin(req.headers)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403, headers: NO_STORE });

  const ip = clientIp(req.headers);
  const wait = loginLocked(ip);
  if (wait > 0) return fail(429, "Too many attempts. Try again later.", { "Retry-After": String(wait) });

  let password = "";
  let next = "/";
  if (wantsJson) {
    const body = (await req.json().catch(() => null)) as { password?: unknown; next?: unknown } | null;
    password = typeof body?.password === "string" ? body.password : "";
    next = safeNext(body?.next);
  } else {
    const form = await req.formData().catch(() => null);
    const p = form?.get("password");
    password = typeof p === "string" ? p : "";
    next = safeNext(form?.get("next"));
  }
  if (!verifyPassword(password, env)) {
    recordLoginFailure(ip);
    return fail(401, "Wrong password.");
  }
  clearLoginFailures(ip);
  const session = await createSession(env);
  if (!session) return NextResponse.json({ error: "Could not start a session." }, { status: 500, headers: NO_STORE });
  const res = wantsJson ? NextResponse.json({ ok: true }, { headers: NO_STORE }) : see(next);
  res.headers.append("Set-Cookie", sessionCookie(session, env));
  return res;
}
