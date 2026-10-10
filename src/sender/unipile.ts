/**
 * Client for the Unipile API, used only for the optional LinkedIn sender. Unipile is a paid third-party service, not part of
 * looot. Endpoints and field names are from https://developer.unipile.com (read 2026-10-10):
 *   POST /api/v1/hosted/accounts/link    hosted auth link, the only way an account is connected
 *   GET  /api/v1/users/{identifier}      profile, gives provider_id and network_distance
 *   POST /api/v1/users/invite            connection request, optional message up to 300 characters
 *   POST /api/v1/chats                   start a chat (multipart: account_id, attendees_ids, text)
 *   POST /api/v1/chats/{chat_id}/messages  send in an existing chat (multipart: text)
 *   GET  /api/v1/chats/{chat_id}/messages  list messages (is_sender, text, timestamp)
 *   POST /api/v1/webhooks                create a webhook (source, request_url, name, headers)
 * Auth header is X-API-KEY. Nothing here touches a LinkedIn password, cookie or browser.
 */

export class UnipileError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Unipile's `type` field when it sends one, for example "errors/too_many_characters". */
    readonly type?: string,
  ) {
    super(message);
    this.name = "UnipileError";
  }
}

/** Reads UNIPILE_DSN, UNIPILE_API_KEY, UNIPILE_ACCOUNT_ID and UNIPILE_WEBHOOK_SECRET. */
export type UnipileEnv = Record<string, string | undefined>;

/** true when the sender is switched on: the DSN and key are set. The account id may come from the hosted auth callback. */
export function unipileConfigured(env: UnipileEnv = process.env): boolean {
  return Boolean(env.UNIPILE_DSN && env.UNIPILE_API_KEY);
}

export interface UnipileOptions {
  dsn: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export interface InviteInput {
  accountId: string;
  providerId: string;
  /** At most 300 characters; Unipile answers 400 errors/too_many_characters above that. */
  message?: string;
}

export interface UnipileMessage {
  messageId: string;
  text: string;
  isSender: boolean;
  timestamp: string | null;
  senderId?: string;
}

export interface UnipileProfile {
  providerId: string;
  publicIdentifier?: string;
  /** FIRST_DEGREE when the person is already a connection. */
  networkDistance?: string;
}

/** Thin client over fetch. Every method is one HTTP call. */
export class UnipileClient {
  readonly baseUrl: string;
  readonly #key: string;
  readonly #fetch: typeof fetch;

  constructor(opts: UnipileOptions) {
    const dsn = opts.dsn.trim().replace(/\/+$/, "");
    this.baseUrl = /^https?:\/\//.test(dsn) ? dsn : `https://${dsn}`;
    this.#key = opts.apiKey;
    this.#fetch = opts.fetch ?? fetch;
  }

  async #request<T>(method: string, path: string, opts: { query?: Record<string, string | number | undefined>; json?: unknown; form?: FormData } = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { "X-API-KEY": this.#key, accept: "application/json" };
    if (opts.json !== undefined) headers["content-type"] = "application/json";
    const res = await this.#fetch(url.toString(), { method, headers, body: opts.form ?? (opts.json === undefined ? undefined : JSON.stringify(opts.json)) });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const b = (body ?? {}) as { title?: string; detail?: string; type?: string };
      throw new UnipileError(b.detail ?? b.title ?? `Unipile returned HTTP ${res.status}`, res.status, b.type);
    }
    return body as T;
  }

  /** Returns the hosted auth URL for connecting a LinkedIn account. The user signs in on Unipile's page; this app never sees credentials. */
  async createHostedAuthLink(o: { name: string; successRedirectUrl?: string; failureRedirectUrl?: string; notifyUrl?: string; expiresInMinutes?: number; now?: Date }): Promise<{ url: string }> {
    const expires = new Date((o.now ?? new Date()).getTime() + (o.expiresInMinutes ?? 30) * 60_000).toISOString();
    const r = await this.#request<{ url: string }>("POST", "/api/v1/hosted/accounts/link", {
      json: {
        type: "create",
        providers: ["LINKEDIN"],
        api_url: this.baseUrl,
        expiresOn: expires,
        name: o.name,
        ...(o.successRedirectUrl ? { success_redirect_url: o.successRedirectUrl } : {}),
        ...(o.failureRedirectUrl ? { failure_redirect_url: o.failureRedirectUrl } : {}),
        ...(o.notifyUrl ? { notify_url: o.notifyUrl } : {}),
      },
    });
    return { url: r.url };
  }

  /** Reads a profile from a public identifier or provider id. Counts as a profile visit for LinkedIn (about 100 a day is Unipile's recommendation). */
  async getProfile(accountId: string, identifier: string): Promise<UnipileProfile> {
    const r = await this.#request<{ provider_id: string; public_identifier?: string; network_distance?: string }>("GET", `/api/v1/users/${encodeURIComponent(identifier)}`, { query: { account_id: accountId } });
    return { providerId: r.provider_id, publicIdentifier: r.public_identifier, networkDistance: r.network_distance };
  }

  /** Sends a connection request, with a note when `message` is set. */
  async sendInvitation(i: InviteInput): Promise<{ invitationId: string }> {
    const r = await this.#request<{ invitation_id: string }>("POST", "/api/v1/users/invite", { json: { provider_id: i.providerId, account_id: i.accountId, ...(i.message ? { message: i.message } : {}) } });
    return { invitationId: r.invitation_id };
  }

  /** Starts a 1:1 chat with a connection and sends the first message. Returns the chat id. */
  async startChat(o: { accountId: string; providerId: string; text: string }): Promise<{ chatId: string | null; messageId: string | null }> {
    const form = new FormData();
    form.set("account_id", o.accountId);
    form.set("text", o.text);
    form.set("attendees_ids", o.providerId);
    const r = await this.#request<{ chat_id: string | null; message_id: string | null }>("POST", "/api/v1/chats", { form });
    return { chatId: r.chat_id, messageId: r.message_id };
  }

  /** Sends a message in an existing chat. */
  async sendMessage(chatId: string, text: string): Promise<{ messageId: string | null }> {
    const form = new FormData();
    form.set("text", text);
    const r = await this.#request<{ message_id?: string }>("POST", `/api/v1/chats/${encodeURIComponent(chatId)}/messages`, { form });
    return { messageId: r.message_id ?? null };
  }

  /** Lists messages of a chat, newest first as Unipile returns them. */
  async listMessages(chatId: string, o: { limit?: number; after?: string } = {}): Promise<UnipileMessage[]> {
    const r = await this.#request<{ items?: { message_id: string; text?: string | null; is_sender?: number | boolean; timestamp?: string; sender_id?: string }[] }>("GET", `/api/v1/chats/${encodeURIComponent(chatId)}/messages`, { query: { limit: o.limit ?? 20, after: o.after } });
    return (r.items ?? []).map((m) => ({ messageId: m.message_id, text: m.text ?? "", isSender: Boolean(m.is_sender), timestamp: m.timestamp ?? null, senderId: m.sender_id }));
  }

  /** Registers a webhook. `source` is "messaging" for new messages or "users" for new relations. The secret goes in the Unipile-Auth header. */
  async createWebhook(o: { source: "messaging" | "users"; requestUrl: string; name: string; secret: string }): Promise<unknown> {
    return this.#request("POST", "/api/v1/webhooks", {
      json: { source: o.source, request_url: o.requestUrl, name: o.name, headers: [{ key: "Content-Type", value: "application/json" }, { key: "Unipile-Auth", value: o.secret }] },
    });
  }
}

/** The calls the outbox needs. The real client and the demo client both fit it. */
export type SenderClient = Pick<UnipileClient, "getProfile" | "sendInvitation" | "startChat" | "sendMessage" | "listMessages">;

/** Builds a client from UNIPILE_DSN and UNIPILE_API_KEY. Throws when either is missing. */
export function unipileFromEnv(env: UnipileEnv = process.env, f?: typeof fetch): UnipileClient {
  if (!env.UNIPILE_DSN || !env.UNIPILE_API_KEY) throw new Error("UNIPILE_DSN and UNIPILE_API_KEY must be set to use the LinkedIn sender.");
  return new UnipileClient({ dsn: env.UNIPILE_DSN, apiKey: env.UNIPILE_API_KEY, fetch: f });
}
