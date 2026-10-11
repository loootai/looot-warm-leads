import { NextResponse, type NextRequest } from "next/server";
import { checkAdmin, denied } from "@/lib/auth/guard";
import { isPublicPath } from "@/lib/auth/routes";

/**
 * First line of defence, not the only one. Every admin page and route handler checks again with the
 * same function, so a path this matcher misses is still closed.
 * Public paths pass. Everything else needs an admin session. Admin answers are never cached.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const forward = new Headers(req.headers);
  forward.set("x-warm-path", pathname);
  if (isPublicPath(pathname)) return NextResponse.next({ request: { headers: forward } });
  const r = await checkAdmin(req.method, req.headers);
  if (!r.ok) {
    if (pathname.startsWith("/api/")) return denied(r);
    const to = req.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    const res = NextResponse.redirect(to, 303);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
  const res = NextResponse.next({ request: { headers: forward } });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
