import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Every API route handler is found on disk, not listed by hand, so a new route with no gate fails here.
 * With an admin password set and no session cookie, each admin handler must answer 401.
 */
const PUBLIC_API = new Set(["/api/health", "/api/auth/login", "/api/auth/logout", "/api/unipile/webhook"]);

const modules = import.meta.glob("/src/app/api/**/route.ts") as Record<string, () => Promise<Record<string, unknown>>>;
const routeOf = (file: string) => file.replace("/src/app", "").replace(/\/route\.ts$/, "");

beforeAll(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".vitest", "gate-"));
  process.env.WARM_DIR = dir;
  process.env.WARM_CONFIG = join(dir, "config.json");
  process.env.WARM_ADMIN_PASSWORD = "test-password-123456";
  delete process.env.WARM_DEMO;
});

describe("admin API handlers refuse a request with no session", () => {
  const admin = Object.keys(modules).filter((f) => !PUBLIC_API.has(routeOf(f)));
  it("finds the admin routes", () => expect(admin.length).toBeGreaterThanOrEqual(2));
  for (const file of admin) {
    it(`${routeOf(file)} answers 401 for every method it exports`, async () => {
      const mod = await modules[file]();
      const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => typeof mod[m] === "function");
      expect(methods.length).toBeGreaterThan(0);
      for (const m of methods) {
        const init: RequestInit = m === "GET" ? { method: m } : { method: m, headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ action: "purge" }) };
        const res = await (mod[m] as (r: Request) => Promise<Response>)(new Request(`http://localhost${routeOf(file)}`, init));
        expect(res.status, `${m} ${routeOf(file)}`).toBe(401);
      }
    });
  }
});

describe("the Unipile webhook rejects a call without the secret", () => {
  it("answers 401 with no header, a wrong header, and no secret configured", async () => {
    const mod = await modules["/src/app/api/unipile/webhook/route.ts"]();
    const post = mod.POST as (r: Request) => Promise<Response>;
    const call = (h: Record<string, string>) => post(new Request("http://localhost/api/unipile/webhook", { method: "POST", headers: { "content-type": "application/json", ...h }, body: "{}" }));
    process.env.UNIPILE_WEBHOOK_SECRET = "s3cret-s3cret-s3cret";
    expect((await call({})).status).toBe(401);
    expect((await call({ "unipile-auth": "wrong" })).status).toBe(401);
    expect((await call({ "unipile-auth": "s3cret-s3cret-s3cret" })).status).toBe(200);
    delete process.env.UNIPILE_WEBHOOK_SECRET;
    expect((await call({ "unipile-auth": "" })).status).toBe(401);
  });
});
