import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as action } from "@/app/api/action/route";
import { GET as budgetGet, PUT as budgetPut } from "@/app/api/budget/route";
import { POST as login } from "@/app/api/auth/login/route";
import { demoConfig } from "@/engine/demo";
import { saveConfig, type WarmConfig } from "@/engine/config";
import { resetLimits } from "@/lib/auth/limits";
import { CSRF_HEADER, csrfToken, verifySession } from "@/lib/auth/session";
import { makeCtx } from "./service";

const PW = "test-password-123456";
const KEYS = ["LOOOT_TOKEN", "LOOOT_API_URL", "WARM_DIR", "WARM_CONFIG", "WARM_ADMIN_PASSWORD", "WARM_DEMO", "WARM_DAILY_USD", "WARM_MONTHLY_USD"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let server: Server;
let paidRuns = 0;
let configFile = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url?.startsWith("/v1/public-catalog/")) return void res.end(JSON.stringify({ price: { state: "known", amountMicros: 2_000, unit: "call" } }));
    if (req.method === "POST") paidRuns++;
    res.statusCode = req.method === "POST" ? 200 : 404;
    res.end(JSON.stringify({ runId: `r${paidRuns}`, status: "completed", result: {}, actualCost: 0.002 }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOOOT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function writeConfig(patch: (c: WarmConfig) => WarmConfig = (c) => c) {
  saveConfig(patch(demoConfig()), configFile);
}

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-route-"));
  process.env.WARM_DIR = dir;
  configFile = join(dir, "config.json");
  process.env.WARM_CONFIG = configFile;
  process.env.WARM_ADMIN_PASSWORD = PW;
  process.env.LOOOT_TOKEN = "lt_test_token";
  delete process.env.WARM_DEMO;
  delete process.env.WARM_DAILY_USD;
  delete process.env.WARM_MONTHLY_USD;
  writeConfig((c) => ({ ...c, spend: { runCapUsd: 50, emailCapUsd: 50 } }));
  paidRuns = 0;
  resetLimits();
});

const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
async function session() {
  const res = await login(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ password: PW }) }));
  const cookie = /warm_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")![0];
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, token: await csrfToken(process.env, s.sid) };
}
type S = Awaited<ReturnType<typeof session>>;
const call = (fn: (req: Request) => Promise<Response>, method: string, path: string, body: unknown, s: S) => fn(new Request(`http://localhost:3000${path}`, { method, headers: { ...H, cookie: s.cookie, [CSRF_HEADER]: s.token }, body: body === undefined ? undefined : JSON.stringify(body) }));
const getBudget = async (s: S) => (await (await budgetGet(new Request("http://localhost:3000/api/budget", { headers: { ...H, cookie: s.cookie } }))).json()) as { limits: { dailyMicros: number; monthlyMicros: number }; day: { limitMicros: number; usedMicros: number; reservedMicros: number; remainingMicros: number } };

describe("budget over HTTP", () => {
  it("shows used, reserved and remaining", async () => {
    const s = await session();
    const res = await budgetGet(new Request("http://localhost:3000/api/budget", { headers: { ...H, cookie: s.cookie } }));
    const j = (await res.json()) as { day: { limitMicros: number; remainingMicros: number } };
    expect(res.status).toBe(200);
    expect(j.day.remainingMicros).toBe(j.day.limitMicros);
  });

  it("closes the budget routes without a session", async () => {
    expect((await budgetGet(new Request("http://localhost:3000/api/budget", { headers: H }))).status).toBe(401);
    const res = await budgetPut(new Request("http://localhost:3000/api/budget", { method: "PUT", headers: H, body: JSON.stringify({ dailyUsd: 1000, monthlyUsd: 5000 }) }));
    expect(res.status).toBe(401);
  });

  it("refuses a change without the CSRF token", async () => {
    const s = await session();
    const res = await budgetPut(new Request("http://localhost:3000/api/budget", { method: "PUT", headers: { ...H, cookie: s.cookie }, body: JSON.stringify({ dailyUsd: 1000, monthlyUsd: 5000 }) }));
    expect(res.status).toBe(403);
  });

  it("lets the signed-in owner change the budget", async () => {
    const s = await session();
    const res = await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 1, monthlyUsd: 3 }, s);
    expect(res.status).toBe(200);
    expect((await getBudget(s)).limits).toEqual({ dailyMicros: 1_000_000, monthlyMicros: 3_000_000 });
  });

  it("starts from the server's environment defaults", async () => {
    process.env.WARM_DAILY_USD = "2";
    process.env.WARM_MONTHLY_USD = "7";
    const s = await session();
    expect((await getBudget(s)).limits).toEqual({ dailyMicros: 2_000_000, monthlyMicros: 7_000_000 });
  });
});

describe("paid actions over HTTP", () => {
  it("ignores a cap sent in the request and uses the one in the server config", async () => {
    writeConfig((c) => ({ ...c, spend: { runCapUsd: 0.001, emailCapUsd: 0.001 } }));
    const s = await session();
    const res = await call(action, "POST", "/api/action", { action: "run", capUsd: 1_000_000, runCapUsd: 1_000_000, spend: { runCapUsd: 1_000_000 }, partial: false }, s);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/above the cap/);
    expect(paidRuns).toBe(0);
  });

  it("ignores a budget sent in a run request", async () => {
    const s = await session();
    await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 0.001, monthlyUsd: 0.002 }, s);
    const res = await call(action, "POST", "/api/action", { action: "run", dailyUsd: 1e9, monthlyUsd: 1e9, budget: { dailyUsd: 1e9 }, limits: { dailyMicros: 1e15 } }, s);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(paidRuns).toBe(0);
    expect((await getBudget(s)).limits.dailyMicros).toBe(1_000);
  });

  it("does not charge a repeated identical run twice", async () => {
    const s = await session();
    const first = await call(action, "POST", "/api/action", { action: "run" }, s);
    expect(first.status).toBe(200);
    const after1 = paidRuns;
    expect(after1).toBeGreaterThan(0);
    const used = (await getBudget(s)).day.usedMicros;
    expect(used).toBeGreaterThan(0);
    const again = await call(action, "POST", "/api/action", { action: "run" }, s);
    expect(again.status).toBe(200);
    expect(paidRuns).toBe(after1);
    expect((await getBudget(s)).day.usedMicros).toBe(used);
  });

  it("refuses a run whose quote is above what is left of the budget, with a message that names it", async () => {
    const s = await session();
    await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 0.01, monthlyUsd: 0.01 }, s);
    const res = await call(action, "POST", "/api/action", { action: "run" }, s);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(paidRuns).toBe(0);
  });

  it("refuses an email run above what is left of the budget", async () => {
    const ctx = await makeCtx(process.env);
    const state = ctx.read();
    state.leads.a = { id: "a", name: "A B", firstName: "A", lastName: "B", linkedinUrl: "https://www.linkedin.com/in/a", events: [], fit: [], fitPoints: 0, intentPoints: 0, rawIntent: 0, score: 50, band: "warm", breakdown: [], reasons: [], enrichCostMicros: 0, costMicros: 0, enriched: true, firstSeen: "", lastSeen: "", isNew: false, replies: [] };
    ctx.write(state);
    const s = await session();
    await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 0.001, monthlyUsd: 0.001 }, s);
    const res = await call(action, "POST", "/api/action", { action: "emailRun", ids: ["a"], capUsd: 1000 }, s);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(paidRuns).toBe(0);
  });
});
