import { createHash, timingSafeEqual } from "node:crypto";

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time check of the Unipile-Auth header against UNIPILE_WEBHOOK_SECRET. False when either is empty. */
export function webhookAuthorized(secret: string | undefined, header: string | null): boolean {
  if (!secret || !header) return false;
  return timingSafeEqual(sha(secret), sha(header));
}
