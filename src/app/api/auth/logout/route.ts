import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/auth/guard";
import { clearedSessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";

/** Public by design: it only clears the caller's own cookie. Needs a same-origin request so another site cannot sign you out. */
export async function POST(req: Request) {
  if (!sameOrigin(req.headers)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const res = new Response(null, { status: 303, headers: { Location: "/login", "Cache-Control": "no-store" } });
  res.headers.append("Set-Cookie", clearedSessionCookie(process.env));
  return res;
}
