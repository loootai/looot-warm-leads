/**
 * Every route the app serves, and who may reach it. A test reads src/app from disk and fails if a
 * route is missing here, or if an admin route does not call the gate. New route: add a line.
 *
 * public: reachable with no sign-in, on purpose, and each one is hardened for that (see README).
 * admin: needs a session when auth is configured, and refuses to serve when it is not.
 */
export type RouteKind = "public" | "admin";

export const ROUTES: Record<string, RouteKind> = {
  // Pages
  "/": "admin",
  "/cost": "admin",
  "/icp": "admin",
  "/leads/[id]": "admin",
  "/outbox": "admin",
  "/sources": "admin",
  "/login": "public",
  // API
  "/api/action": "admin",
  "/api/export": "admin",
  "/api/health": "public",
  "/api/auth/login": "public",
  "/api/auth/logout": "public",
  // Unipile calls this. It checks its own shared secret (Unipile-Auth header) and rejects anything else.
  "/api/unipile/webhook": "public",
};

/** Static files in /public. Served with no sign-in. */
export const PUBLIC_FILES = ["/favicon.ico", "/brand/"];

export const PUBLIC_PATHS: string[] = Object.entries(ROUTES)
  .filter(([, k]) => k === "public")
  .map(([p]) => p);

/** true for the public routes and public static files. Everything else is admin, including a path no route matches. */
export function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith("/_next/")) return true;
  if (PUBLIC_FILES.some((f) => (f.endsWith("/") ? pathname.startsWith(f) : pathname === f))) return true;
  return PUBLIC_PATHS.includes(pathname);
}
