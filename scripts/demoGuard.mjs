// Runs before `npm run demo`. The demo has no sign-in, so it refuses to start next to real data
// unless an admin password is set. Same rule as src/lib/auth/policy.ts.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const env = process.env;
const hasAuth = !!(env.WARM_ADMIN_PASSWORD_HASH?.trim() || (env.WARM_ADMIN_PASSWORD && env.WARM_ADMIN_PASSWORD.length >= 12));
const dataFile = resolve((env.WARM_DIR ?? ".looot-warm") + "/state.json");
const real = [];
if (env.LOOOT_TOKEN?.trim()) real.push("LOOOT_TOKEN is set");
if (existsSync(dataFile)) real.push(`${dataFile} exists`);
if (real.length > 0 && !hasAuth) {
  console.error(`The demo has no sign-in and will not start next to real data (${real.join(", ")}).`);
  console.error("Run it where neither exists, or set WARM_ADMIN_PASSWORD (12+ characters) to sign in.");
  process.exit(1);
}
