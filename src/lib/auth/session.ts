import { adminSecretFromEnv, type Env } from "./policy";

export const SESSION_COOKIE = "warm_session";
export const CSRF_HEADER = "x-warm-csrf";
/** A session lasts 8 hours, then the admin signs in again. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/**
 * The signing key. Derived from WARM_SESSION_SECRET if set, else from the password or its hash,
 * so changing the password signs everyone out. Null when no secret is configured.
 */
async function signingKey(env: Env, usage: "sign" | "verify"): Promise<CryptoKey | null> {
  const secret = env.WARM_SESSION_SECRET?.trim() || adminSecretFromEnv(env)?.value;
  if (!secret) return null;
  const seed = await crypto.subtle.digest("SHA-256", enc.encode(`warm-session-v1|${secret}`));
  return crypto.subtle.importKey("raw", seed, { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

async function mac(env: Env, message: string): Promise<string | null> {
  const key = await signingKey(env, "sign");
  return key ? b64url(await crypto.subtle.sign("HMAC", key, enc.encode(message))) : null;
}

async function macOk(env: Env, message: string, sig: string): Promise<boolean> {
  const key = await signingKey(env, "verify");
  const raw = fromB64url(sig);
  if (!key || !raw) return false;
  return crypto.subtle.verify("HMAC", key, raw as BufferSource, enc.encode(message));
}

/** Makes a signed session value: expiry.sessionId.signature. */
export async function createSession(env: Env, nowMs: number = Date.now()): Promise<string | null> {
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const sid = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const sig = await mac(env, `s|${exp}|${sid}`);
  return sig ? `${exp}.${sid}.${sig}` : null;
}

/** The session id when the value is signed by this server and has not expired. */
export async function verifySession(env: Env, value: string | undefined, nowMs: number = Date.now()): Promise<{ sid: string; exp: number } | null> {
  if (!value || value.length > 300) return null;
  const [expRaw, sid, sig, extra] = value.split(".");
  if (!expRaw || !sid || !sig || extra !== undefined || !/^\d{1,12}$/.test(expRaw)) return null;
  const exp = Number(expRaw);
  if (exp * 1000 <= nowMs || exp * 1000 > nowMs + (SESSION_TTL_SECONDS + 60) * 1000) return null;
  return (await macOk(env, `s|${exp}|${sid}`, sig)) ? { sid, exp } : null;
}

/** The CSRF token for one session. Sent back in the x-warm-csrf header on every state-changing admin request. */
export async function csrfToken(env: Env, sid: string): Promise<string> {
  return (await mac(env, `c|${sid}`)) ?? "";
}

export async function csrfOk(env: Env, sid: string, given: string | null): Promise<boolean> {
  if (!given || given.length > 100) return false;
  return macOk(env, `c|${sid}`, given);
}

/** Reads one cookie from a Cookie header. */
export function cookieFrom(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Set-Cookie value for a new session. httpOnly, SameSite=Lax, Secure in production, with an expiry. */
export function sessionCookie(value: string, env: Env): string {
  const secure = env.NODE_ENV === "production" && env.WARM_COOKIE_SECURE !== "0";
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(env: Env): string {
  const secure = env.NODE_ENV === "production" && env.WARM_COOKIE_SECURE !== "0";
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
