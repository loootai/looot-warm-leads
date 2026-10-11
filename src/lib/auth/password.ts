import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { adminSecretFromEnv, type Env } from "./policy";

/** Hash format for WARM_ADMIN_PASSWORD_HASH: scrypt$<salt hex>$<key hex>. Make one with `npm run hash-password`. */
export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 32).toString("hex")}`;
}

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time check of a typed password against the configured password or hash. */
export function verifyPassword(typed: string, env: Env): boolean {
  const secret = adminSecretFromEnv(env);
  if (!secret || typed.length > 1024) return false;
  if (secret.kind === "plain") return timingSafeEqual(sha(typed), sha(secret.value));
  const [scheme, saltHex, keyHex] = secret.value.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex || !/^[0-9a-f]+$/i.test(saltHex + keyHex)) return false;
  const want = Buffer.from(keyHex, "hex");
  const got = scryptSync(typed, Buffer.from(saltHex, "hex"), want.length);
  return want.length === got.length && timingSafeEqual(want, got);
}
