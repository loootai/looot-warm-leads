import { describe, expect, it } from "vitest";
import { adminPolicy, isAuthConfigured } from "./policy";

const PW = "a-long-enough-password";

describe("adminPolicy", () => {
  it("demo with no token and no data file is open", () => {
    expect(adminPolicy({ WARM_DEMO: "1" }, false)).toEqual({ mode: "open-demo" });
  });
  it("demo next to a real token or data file refuses, unless a password is set", () => {
    expect(adminPolicy({ WARM_DEMO: "1" }, true)).toEqual({ mode: "setup", reason: "demo_with_real_data" });
    expect(adminPolicy({ WARM_DEMO: "1", WARM_ADMIN_PASSWORD: PW }, true).mode).toBe("login");
  });
  it("a normal run with no password is setup, not open", () => {
    expect(adminPolicy({}, false)).toEqual({ mode: "setup", reason: "no_password" });
    expect(adminPolicy({}, true).mode).toBe("setup");
  });
  it("a short password counts as not set", () => {
    expect(adminPolicy({ WARM_ADMIN_PASSWORD: "short" }, false)).toEqual({ mode: "setup", reason: "short_password" });
    expect(isAuthConfigured({ WARM_ADMIN_PASSWORD: "short" })).toBe(false);
  });
  it("a password or a hash turns on login", () => {
    expect(adminPolicy({ WARM_ADMIN_PASSWORD: PW }, false).mode).toBe("login");
    expect(adminPolicy({ WARM_ADMIN_PASSWORD_HASH: "scrypt$aa$bb" }, false).mode).toBe("login");
  });
});
