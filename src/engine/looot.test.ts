import { describe, expect, it, vi } from "vitest";
import { LoootClient, LoootError, fetchPrices, hasLoootToken, loootFromEnv, priceOfItem } from "./looot";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("LoootClient", () => {
  it("posts the endpoint, input and idempotency key with the bearer token", async () => {
    const f = vi.fn(async () => json({ runId: "run_1", status: "completed", result: { data: [] }, actualCost: 0.01 }));
    const client = new LoootClient({ token: "tok_test", fetch: f as unknown as typeof fetch });
    const run = await client.run("predictleads-companies-job-openings", { company_id_or_domain: "acme.com" }, "k1");
    expect(run.status).toBe("completed");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.looot.ai/v1/runs?wait=30");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok_test");
    expect(JSON.parse(init.body as string)).toEqual({ endpointId: "predictleads-companies-job-openings", input: { company_id_or_domain: "acme.com" }, idempotencyKey: "k1" });
  });
  it("polls a run that is not finished until it ends", async () => {
    const answers = [json({ runId: "r", status: "running" }), json({ runId: "r", status: "completed", actualCost: "0.01" })];
    const f = vi.fn(async () => answers.shift()!);
    const client = new LoootClient({ token: "t", fetch: f as unknown as typeof fetch, sleep: async () => {} });
    expect((await client.runAndWait("e", {}, "k")).status).toBe("completed");
    expect((f.mock.calls[1] as unknown as [string])[0]).toBe("https://api.looot.ai/v1/runs/r");
  });
  it("hands back an unfinished run at the poll timeout instead of throwing", async () => {
    const f = vi.fn(async () => json({ runId: "r", status: "pending_provider" }));
    const client = new LoootClient({ token: "t", fetch: f as unknown as typeof fetch, sleep: async () => {}, pollTimeoutMs: 0 });
    expect((await client.runAndWait("e", {}, "k")).status).toBe("pending_provider");
  });
  it("turns an HTTP error into a LoootError with looot's code", async () => {
    const f = vi.fn(async () => json({ error: { code: "insufficient_funds", message: "Top up." } }, 402));
    const client = new LoootClient({ token: "t", fetch: f as unknown as typeof fetch });
    await expect(client.run("e", {}, "k")).rejects.toMatchObject({ name: "LoootError", status: 402, code: "insufficient_funds" });
  });
  it("needs LOOOT_TOKEN and never serialises it", () => {
    expect(() => loootFromEnv({})).toThrow(LoootError);
    expect(hasLoootToken({ LOOOT_TOKEN: "x" })).toBe(true);
    expect(JSON.stringify(loootFromEnv({ LOOOT_TOKEN: "tok_secret" }))).not.toContain("tok_secret");
  });
});

describe("prices", () => {
  it("reads a known per-call price and rejects the rest", () => {
    expect(priceOfItem({ price: { state: "known", amountMicros: 10000, unit: "call" } })).toBe(10000);
    expect(priceOfItem({ price: { state: "known", amountMicros: 10000, unit: "result" } })).toBeNull();
    expect(priceOfItem({ price: { state: "unknown" } })).toBeNull();
  });
  it("keeps the fallback and names the endpoint when the catalog cannot be read", async () => {
    const f = vi.fn(async (url: string) => (url.endsWith("/a") ? json({ price: { state: "known", amountMicros: 7000, unit: "call" } }) : json({}, 404)));
    const r = await fetchPrices({ a: 1, b: 2 }, { fetch: f as unknown as typeof fetch });
    expect(r.prices).toEqual({ a: 7000, b: 2 });
    expect(r.unread).toEqual(["b"]);
    expect(r.source).toBe("fallback");
  });
});
