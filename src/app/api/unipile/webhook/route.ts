import { NextResponse } from "next/server";
import { webhookAuthorized } from "@/lib/auth/webhook";
import { handleWebhook, makeCtx } from "@/server/service";
import type { UnipileWebhookBody } from "@/sender/outbox";

export const dynamic = "force-dynamic";

/**
 * Public on purpose: Unipile calls it for new messages (replies) and new relations (accepted invitations).
 * Unipile lets you add a custom header with a secret when you create the webhook; this route accepts a request only when the
 * `Unipile-Auth` header equals UNIPILE_WEBHOOK_SECRET, compared in constant time. The docs describe no other signature, so none is checked.
 * Anything else, and every call when the secret is not set, gets 401 and touches nothing.
 */
export async function POST(req: Request) {
  if (!webhookAuthorized(process.env.UNIPILE_WEBHOOK_SECRET, req.headers.get("unipile-auth"))) return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const len = Number(req.headers.get("content-length"));
  if (Number.isFinite(len) && len > 200_000) return NextResponse.json({ ok: false }, { status: 413, headers: { "Cache-Control": "no-store" } });
  const body = (await req.json().catch(() => null)) as UnipileWebhookBody | null;
  if (!body || typeof body !== "object") return NextResponse.json({ ok: false }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const r = handleWebhook(await makeCtx(), body);
  return NextResponse.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
}
