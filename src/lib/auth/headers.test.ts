import { describe, expect, it } from "vitest";
// @ts-expect-error next.config.mjs has no type declarations
import config from "../../../next.config.mjs";

describe("security headers", () => {
  it("are set on every path", async () => {
    const rules = await (config as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> }).headers();
    const h = Object.fromEntries(rules[0].headers.map((x) => [x.key.toLowerCase(), x.value]));
    expect(rules[0].source).toBe("/:path*");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toContain("default-src 'self'");
    expect(h["content-security-policy"]).toContain("object-src 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("no-referrer");
  });
});
