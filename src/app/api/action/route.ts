import { NextResponse } from "next/server";
import { dispatch } from "@/server/actions";
import { makeCtx } from "@/server/service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const data = await dispatch(await makeCtx(), body);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
