export type Env = Record<string, string | undefined>;

/** Shortest admin password the app accepts. A shorter one counts as not set. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * open-demo: sample data, no token, no real data file. Admin pages are open and carry a badge.
 * login: an admin password is set, so every admin route needs a session.
 * setup: no usable password. Admin routes refuse to serve and /login explains what to set.
 */
export type AdminMode = "open-demo" | "login" | "setup";

export interface AdminPolicy {
  mode: AdminMode;
  /** Why the mode is "setup", in words for the setup page. */
  reason?: "no_password" | "short_password" | "demo_with_real_data";
}

export const isDemoEnv = (env: Env): boolean => env.WARM_DEMO === "1";

/** The plain password, or the scrypt hash, whichever is set. The hash wins. */
export function adminSecretFromEnv(env: Env): { kind: "hash" | "plain"; value: string } | null {
  const hash = env.WARM_ADMIN_PASSWORD_HASH?.trim();
  if (hash) return { kind: "hash", value: hash };
  const plain = env.WARM_ADMIN_PASSWORD;
  if (plain && plain.length > 0) return { kind: "plain", value: plain };
  return null;
}

/** true when an admin password (or hash) is set and long enough. */
export function isAuthConfigured(env: Env): boolean {
  const s = adminSecretFromEnv(env);
  return s !== null && (s.kind === "hash" || s.value.length >= MIN_PASSWORD_LENGTH);
}

/**
 * Decides how admin routes behave. `hasRealData` is true when a LOOOT_TOKEN or a data file exists.
 * Demo mode with real data and no password is refused, because the badge would be a lie.
 */
export function adminPolicy(env: Env, hasRealData: boolean): AdminPolicy {
  if (isAuthConfigured(env)) return { mode: "login" };
  const s = adminSecretFromEnv(env);
  if (isDemoEnv(env)) return hasRealData ? { mode: "setup", reason: "demo_with_real_data" } : { mode: "open-demo" };
  return { mode: "setup", reason: s ? "short_password" : "no_password" };
}
