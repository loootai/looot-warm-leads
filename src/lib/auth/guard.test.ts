import { describe, expect, it } from "vitest";
import { sameOrigin } from "./guard";

const h = (o: Record<string, string>) => new Headers({ host: "localhost:3000", ...o });

describe("sameOrigin", () => {
  it("accepts the own origin and refuses another site", () => {
    expect(sameOrigin(h({ origin: "http://localhost:3000" }))).toBe(true);
    expect(sameOrigin(h({ origin: "https://evil.example" }))).toBe(false);
  });
  it("treats 'Origin: null' (sent under Referrer-Policy: no-referrer) by Sec-Fetch-Site", () => {
    expect(sameOrigin(h({ origin: "null", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(sameOrigin(h({ origin: "null", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(sameOrigin(h({ origin: "null" }))).toBe(false);
  });
});
