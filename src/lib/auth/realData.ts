import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "./policy";

/** The data file the app reads outside the demo. */
export function dataFile(env: Env = process.env): string {
  return resolve(/* turbopackIgnore: true */ (env.WARM_DIR ?? ".looot-warm") + "/state.json");
}

/** true when a real looot token is set or a data file exists. Server only. */
export function hasRealData(env: Env = process.env): boolean {
  if (env.LOOOT_TOKEN && env.LOOOT_TOKEN.trim() !== "") return true;
  return existsSync(dataFile(env));
}
