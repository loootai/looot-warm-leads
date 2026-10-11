import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import { clearLoginFailures, loginLocked, recordLoginFailure, resetLimits } from "./limits";
import { SESSION_TTL_SECONDS, createSession, csrfOk, csrfToken, sessionCookie, verifySession } from "./session";

const env = { WARM_ADMIN_PASSWORD: "correct horse battery" };

describe("password check", () => {
  it("accepts the right password and rejects others", () => {
    expect(verifyPassword("correct horse battery", env)).toBe(true);
    expect(verifyPassword("correct horse batterz", env)).toBe(false);
    expect(verifyPassword("", env)).toBe(false);
    expect(verifyPassword("x".repeat(5000), env)).toBe(false);
  });
  it("works with a scrypt hash", () => {
    const hash = hashPassword("another long password");
    expect(verifyPassword("another long password", { WARM_ADMIN_PASSWORD_HASH: hash })).toBe(true);
    expect(verifyPassword("wrong long password!", { WARM_ADMIN_PASSWORD_HASH: hash })).toBe(false);
    expect(verifyPassword("anything", { WARM_ADMIN_PASSWORD_HASH: "scrypt$zz$zz" })).toBe(false);
  });
  it("accepts nothing when no password is set", () => {
    expect(verifyPassword("", {})).toBe(false);
    expect(verifyPassword("anything", {})).toBe(false);
  });
});

describe("session", () => {
  it("verifies a fresh session and rejects a tampered one", async () => {
    const s = (await createSession(env))!;
    expect(await verifySession(env, s)).not.toBeNull();
    const [exp, sid, sig] = s.split(".");
    expect(await verifySession(env, `${Number(exp) + 100}.${sid}.${sig}`)).toBeNull();
    expect(await verifySession(env, `${exp}.${sid}x.${sig}`)).toBeNull();
    expect(await verifySession(env, `${exp}.${sid}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(await verifySession(env, "garbage")).toBeNull();
    expect(await verifySession(env, undefined)).toBeNull();
  });
  it("expires", async () => {
    const t0 = 1_800_000_000_000;
    const s = (await createSession(env, t0))!;
    expect(await verifySession(env, s, t0 + 1000)).not.toBeNull();
    expect(await verifySession(env, s, t0 + (SESSION_TTL_SECONDS + 1) * 1000)).toBeNull();
  });
  it("a changed password signs everyone out", async () => {
    const s = (await createSession(env))!;
    expect(await verifySession({ WARM_ADMIN_PASSWORD: "a different password!" }, s)).toBeNull();
  });
  it("binds the CSRF token to the session", async () => {
    const a = (await verifySession(env, (await createSession(env))!))!;
    const b = (await verifySession(env, (await createSession(env))!))!;
    const tokA = await csrfToken(env, a.sid);
    expect(await csrfOk(env, a.sid, tokA)).toBe(true);
    expect(await csrfOk(env, b.sid, tokA)).toBe(false);
    expect(await csrfOk(env, a.sid, null)).toBe(false);
    expect(await csrfOk(env, a.sid, "nope")).toBe(false);
  });
  it("sets httpOnly, SameSite=Lax, an expiry, and Secure in production", () => {
    const dev = sessionCookie("v", { NODE_ENV: "development" });
    expect(dev).toMatch(/HttpOnly/);
    expect(dev).toMatch(/SameSite=Lax/);
    expect(dev).toMatch(/Max-Age=\d+/);
    expect(dev).not.toMatch(/Secure/);
    expect(sessionCookie("v", { NODE_ENV: "production" })).toMatch(/; Secure/);
  });
});

describe("login lockout", () => {
  it("locks an address after 5 failures and not before", () => {
    resetLimits();
    for (let i = 0; i < 4; i++) recordLoginFailure("198.51.100.1");
    expect(loginLocked("198.51.100.1")).toBe(0);
    recordLoginFailure("198.51.100.1");
    expect(loginLocked("198.51.100.1")).toBeGreaterThan(0);
    expect(loginLocked("198.51.100.2")).toBe(0);
    clearLoginFailures("198.51.100.1");
    expect(loginLocked("198.51.100.1")).toBe(0);
  });
  it("locks everyone after 40 failures from many addresses", () => {
    resetLimits();
    for (let i = 0; i < 40; i++) recordLoginFailure(`198.51.100.${i}`);
    expect(loginLocked("203.0.113.77")).toBeGreaterThan(0);
  });
});
