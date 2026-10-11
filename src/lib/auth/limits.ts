/** A small in-memory limiter. One process only. Behind several instances, rate limit at the proxy too. */
interface Bucket {
  count: number;
  resetAt: number;
}

const g = globalThis as unknown as { __warmBuckets?: Map<string, Bucket> };
const buckets = (): Map<string, Bucket> => (g.__warmBuckets ??= new Map());

/** Counts one hit for `key`. Returns false once `limit` hits land inside `windowMs`. */
export function allow(key: string, limit: number, windowMs: number, now: number = Date.now()): boolean {
  const map = buckets();
  if (map.size > 10_000) for (const [k, b] of map) if (b.resetAt <= now) map.delete(k);
  const b = map.get(key);
  if (!b || b.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= limit;
}

/** Seconds until `key` is free again, or 0. */
export function retryAfter(key: string, now: number = Date.now()): number {
  const b = buckets().get(key);
  return b && b.resetAt > now ? Math.ceil((b.resetAt - now) / 1000) : 0;
}

export function resetLimits(): void {
  buckets().clear();
}

/** Failed-sign-in lockout. 5 failures from one address in 15 minutes lock that address for the rest of the window. 40 failures from anywhere lock everyone. */
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_MAX_PER_IP = 5;
export const LOGIN_MAX_GLOBAL = 40;

export function loginLocked(ip: string, now: number = Date.now()): number {
  const per = buckets().get(`login:${ip}`);
  const all = buckets().get("login:*");
  const wait = (b: Bucket | undefined, max: number) => (b && b.resetAt > now && b.count >= max ? Math.ceil((b.resetAt - now) / 1000) : 0);
  return Math.max(wait(per, LOGIN_MAX_PER_IP), wait(all, LOGIN_MAX_GLOBAL));
}

export function recordLoginFailure(ip: string, now: number = Date.now()): void {
  for (const key of [`login:${ip}`, "login:*"]) {
    const b = buckets().get(key);
    if (!b || b.resetAt <= now) buckets().set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    else b.count++;
  }
}

export function clearLoginFailures(ip: string): void {
  buckets().delete(`login:${ip}`);
}

/** The client address as the existing collect route reads it: first x-forwarded-for entry, then x-real-ip. */
export function clientIp(headers: Headers): string {
  return (headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || headers.get("x-real-ip") || "unknown";
}
