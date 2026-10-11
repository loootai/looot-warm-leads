import { NextResponse } from "next/server";
import { checkAdmin, denied, requireAdminRoute } from "@/lib/auth/guard";
import { dispatch } from "@/server/actions";
import { makeCtx } from "@/server/service";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Admin. One dispatcher for quote, run, queue, approve, send, erase and config. Needs the session and the CSRF token. */
export async function POST(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  // Second look, to read the session id for the per-session spend limit.
  const check = await checkAdmin(req.method, req.headers);
  if (!check.ok) return denied(check);
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const data = await dispatch(await makeCtx(), body, { sid: check.sid });
    return NextResponse.json({ ok: true, data }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400, headers: NO_STORE });
  }
}
