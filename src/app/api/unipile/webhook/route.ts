import { NextResponse } from "next/server";
import { handleWebhook, makeCtx } from "@/server/service";
import type { UnipileWebhookBody } from "@/sender/outbox";

export const dynamic = "force-dynamic";

/**
 * Receives Unipile webhooks: new messages (replies) and new relations (accepted invitations).
 * Unipile lets you add a custom header with a secret when you create the webhook; this route accepts a request only when the
 * `Unipile-Auth` header equals UNIPILE_WEBHOOK_SECRET. The docs do not describe any other signature, so none is checked.
 */
export async function POST(req: Request) {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET;
  if (!secret || req.headers.get("unipile-auth") !== secret) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json()) as UnipileWebhookBody;
  const r = handleWebhook(await makeCtx(), body);
  return NextResponse.json({ ok: true, ...r });
}
