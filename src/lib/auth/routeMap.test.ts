import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { isPublicPath, ROUTES } from "./routes";

const APP = join(process.cwd(), "src", "app");

/** Walks src/app and returns every page.tsx and route.ts with the URL it serves. */
function discover(): { route: string; file: string; kind: "page" | "api" }[] {
  const out: { route: string; file: string; kind: "page" | "api" }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "page.tsx" || name === "route.ts") {
        const rel = relative(APP, dir).split(sep).join("/");
        out.push({ route: `/${rel}`.replace(/\/$/, "") || "/", file: p, kind: name === "route.ts" ? "api" : "page" });
      }
    }
  };
  walk(APP);
  return out;
}

const found = discover();
const concrete = (route: string) => route.replace("[id]", "abc123");
const KEYS = ["WARM_ADMIN_PASSWORD", "WARM_DEMO", "LOOOT_TOKEN", "WARM_DIR"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  process.env.WARM_DIR = join(process.cwd(), ".vitest", "no-such-dir");
  delete process.env.LOOOT_TOKEN;
  delete process.env.WARM_DEMO;
  delete process.env.WARM_ADMIN_PASSWORD;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("route map", () => {
  it("lists every page and route handler on disk, and nothing else", () => {
    expect(found.map((f) => f.route).sort()).toEqual(Object.keys(ROUTES).sort());
  });
  it("calls the gate in every admin file, and in no public file by accident", () => {
    for (const f of found) {
      const src = readFileSync(f.file, "utf8");
      const gate = f.kind === "api" ? "await requireAdminRoute(req)" : "await requireAdminPage()";
      if (ROUTES[f.route] === "admin") expect(src, `${f.route} must call ${gate}`).toContain(gate);
      else expect(src, `${f.route} is public`).not.toMatch(/requireAdmin(Route|Page)/);
    }
  });
  it("treats an unknown path as admin", () => {
    expect(isPublicPath("/api/does-not-exist")).toBe(false);
    expect(isPublicPath("/api/export.csv")).toBe(false);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/unipile/webhook")).toBe(true);
  });
});

describe("proxy with a password set and no session", () => {
  beforeEach(() => {
    process.env.WARM_ADMIN_PASSWORD = "test-password-123456";
  });
  for (const f of found.filter((x) => ROUTES[x.route] === "admin")) {
    it(`closes ${f.kind === "api" ? "POST" : "GET"} ${f.route}`, async () => {
      const method = f.kind === "api" ? "POST" : "GET";
      const res = await proxy(new NextRequest(`http://localhost:3000${concrete(f.route)}`, { method, headers: { origin: "http://localhost:3000", host: "localhost:3000" } }));
      if (f.kind === "api") expect(res.status).toBe(401);
      else {
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("http://localhost:3000/login");
      }
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  }
  for (const f of found.filter((x) => ROUTES[x.route] === "public")) {
    it(`leaves ${f.route} open`, async () => {
      const res = await proxy(new NextRequest(`http://localhost:3000${f.route}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });
  }
  it("closes an unlisted path too", async () => {
    const res = await proxy(new NextRequest("http://localhost:3000/api/leads.csv", { headers: {} }));
    expect(res.status).toBe(401);
  });
});

describe("proxy with no password", () => {
  it("refuses admin routes with 503 and sends pages to the setup page", async () => {
    const api = await proxy(new NextRequest("http://localhost:3000/api/action", { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000" } }));
    expect(api.status).toBe(503);
    const page = await proxy(new NextRequest("http://localhost:3000/outbox"));
    expect(page.status).toBe(303);
    expect((await proxy(new NextRequest("http://localhost:3000/login"))).status).toBe(200);
  });
  it("demo mode is open when there is no token and no data file", async () => {
    process.env.WARM_DEMO = "1";
    for (const f of found.filter((x) => x.kind === "page")) {
      const res = await proxy(new NextRequest(`http://localhost:3000${concrete(f.route)}`));
      expect(res.status, f.route).toBe(200);
    }
  });
  it("demo mode refuses when LOOOT_TOKEN is set and no password is", async () => {
    process.env.WARM_DEMO = "1";
    process.env.LOOOT_TOKEN = "lt_real_looking_token";
    const res = await proxy(new NextRequest("http://localhost:3000/"));
    expect(res.status).toBe(303);
  });
});
