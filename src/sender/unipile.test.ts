import { describe, expect, it, vi } from "vitest";
import { UnipileClient, UnipileError, unipileConfigured, unipileFromEnv } from "./unipile";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const mk = (handler: (url: string, init: RequestInit) => Response) => {
  const f = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  return { f, client: new UnipileClient({ dsn: "api1.unipile.example:13111", apiKey: "key_test", fetch: f as unknown as typeof fetch }) };
};
const call = (f: ReturnType<typeof vi.fn>, i = 0) => f.mock.calls[i] as unknown as [string, RequestInit];

describe("UnipileClient request shapes (from developer.unipile.com, no real call)", () => {
  it("builds the base URL from the DSN and sends X-API-KEY", async () => {
    const { f, client } = mk(() => json({ provider_id: "ACo1", network_distance: "SECOND_DEGREE" }));
    await client.getProfile("acc1", "jane-doe");
    const [url, init] = call(f);
    expect(url).toBe("https://api1.unipile.example:13111/api/v1/users/jane-doe?account_id=acc1");
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("key_test");
    expect(init.method).toBe("GET");
  });
  it("creates a hosted auth link for LinkedIn only", async () => {
    const { f, client } = mk(() => json({ object: "HostedAuthURL", url: "https://account.unipile.example/abc" }));
    const r = await client.createHostedAuthLink({ name: "warm", notifyUrl: "https://me.example/hook", successRedirectUrl: "https://me.example/ok", now: new Date("2026-10-10T00:00:00Z") });
    expect(r.url).toBe("https://account.unipile.example/abc");
    const [url, init] = call(f);
    expect(url).toBe("https://api1.unipile.example:13111/api/v1/hosted/accounts/link");
    expect(JSON.parse(init.body as string)).toEqual({ type: "create", providers: ["LINKEDIN"], api_url: "https://api1.unipile.example:13111", expiresOn: "2026-10-10T00:30:00.000Z", name: "warm", success_redirect_url: "https://me.example/ok", notify_url: "https://me.example/hook" });
  });
  it("sends an invitation with provider_id, account_id and the note as JSON", async () => {
    const { f, client } = mk(() => json({ object: "UserInvitationSent", invitation_id: "inv_1" }));
    expect(await client.sendInvitation({ accountId: "acc1", providerId: "ACo1", message: "Hi" })).toEqual({ invitationId: "inv_1" });
    const [url, init] = call(f);
    expect(url).toBe("https://api1.unipile.example:13111/api/v1/users/invite");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ provider_id: "ACo1", account_id: "acc1", message: "Hi" });
  });
  it("starts a chat with multipart account_id, attendees_ids and text", async () => {
    const { f, client } = mk(() => json({ object: "ChatStarted", chat_id: "chat_1", message_id: "m_1" }));
    expect(await client.startChat({ accountId: "acc1", providerId: "ACo1", text: "Hello" })).toEqual({ chatId: "chat_1", messageId: "m_1" });
    const [url, init] = call(f);
    expect(url).toBe("https://api1.unipile.example:13111/api/v1/chats");
    const form = init.body as FormData;
    expect([form.get("account_id"), form.get("attendees_ids"), form.get("text")]).toEqual(["acc1", "ACo1", "Hello"]);
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();
  });
  it("lists messages and maps is_sender", async () => {
    const { f, client } = mk(() => json({ object: "MessageList", items: [{ message_id: "m1", text: "Yes", is_sender: 0, timestamp: "2026-10-10T10:00:00Z" }, { message_id: "m2", text: "Hi", is_sender: 1 }] }));
    const msgs = await client.listMessages("chat 1", { limit: 5 });
    expect(call(f)[0]).toBe("https://api1.unipile.example:13111/api/v1/chats/chat%201/messages?limit=5");
    expect(msgs.map((m) => [m.messageId, m.isSender])).toEqual([["m1", false], ["m2", true]]);
  });
  it("registers a webhook with the secret in the Unipile-Auth header", async () => {
    const { f, client } = mk(() => json({ object: "Webhook" }));
    await client.createWebhook({ source: "messaging", requestUrl: "https://me.example/api/unipile/webhook", name: "replies", secret: "s3" });
    const body = JSON.parse(call(f)[1].body as string);
    expect(body.source).toBe("messaging");
    expect(body.headers).toContainEqual({ key: "Unipile-Auth", value: "s3" });
  });
  it("turns an error body into UnipileError with status and type", async () => {
    const { client } = mk(() => json({ title: "Bad", detail: "Too long", type: "errors/too_many_characters", status: 400 }, 400));
    await expect(client.sendInvitation({ accountId: "a", providerId: "p", message: "x" })).rejects.toMatchObject({ name: "UnipileError", status: 400, type: "errors/too_many_characters", message: "Too long" });
    expect(new UnipileError("x", 429).status).toBe(429);
  });
  it("is configured only with a DSN and a key, and never serialises the key", () => {
    expect(unipileConfigured({})).toBe(false);
    expect(unipileConfigured({ UNIPILE_DSN: "d", UNIPILE_API_KEY: "k" })).toBe(true);
    expect(() => unipileFromEnv({ UNIPILE_DSN: "d" })).toThrow(/UNIPILE_API_KEY/);
    expect(JSON.stringify(unipileFromEnv({ UNIPILE_DSN: "d", UNIPILE_API_KEY: "secret_key" }))).not.toContain("secret_key");
  });
});
