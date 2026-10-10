import { describe, expect, it } from "vitest";
import { defaultConfig, parseConfig } from "./config";
import { decay, firstMatch, scoreFit, scoreIntent, scorePerson } from "./score";
import type { SignalEvent } from "./types";

const NOW = new Date("2026-10-10T00:00:00Z");
const cfg = defaultConfig();
const ev = (kind: SignalEvent["kind"], daysAgo: number | null, costMicros = 0): SignalEvent => ({ kind, provider: "fetchin", endpointId: "fetchin-post-engagement", date: daysAgo === null ? null : new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(), title: "t", url: "https://www.linkedin.com/posts/x", source: "src", costMicros });

describe("fit", () => {
  it("matches whole words only", () => {
    expect(firstMatch("Head of Growth", ["head of"])).toBe("head of");
    expect(firstMatch("Overhead", ["head"])).toBeNull();
  });
  it("scales the criteria the ICP sets to the fit maximum and skips the rest", () => {
    const c = defaultConfig();
    c.icp.industries = [];
    c.icp.companySize = { min: 0, max: 0 };
    const r = scoreFit({ title: "Head of Growth", enriched: true }, c);
    expect(r.lines.map((l) => l.criterion)).toEqual(["title", "seniority"]);
    expect(r.points).toBe(c.scoring.fitMax);
  });
  it("gives zero and says so when the data is missing", () => {
    const r = scoreFit({ title: "Head of Growth", enriched: true }, cfg);
    const ind = r.lines.find((l) => l.criterion === "industry");
    expect(ind).toMatchObject({ points: 0, detail: "no industry in the data" });
  });
  it("excludes a banned title", () => {
    expect(scoreFit({ headline: "Recruiter at Acme", enriched: false }, cfg).excluded).toMatch(/recruiter/);
  });
});

describe("intent", () => {
  it("halves a signal at its half-life and counts an undated one as half", () => {
    expect(decay(new Date(NOW.getTime() - 21 * 86_400_000).toISOString(), NOW, 21)).toBeCloseTo(0.5, 5);
    expect(decay(null, NOW, 21)).toBe(0.5);
  });
  it("lists one line per signal with provider, weight, points, cost and evidence", () => {
    const r = scoreIntent([ev("competitor_comment", 0, 700), ev("competitor_comment", 1, 300)], cfg, NOW);
    expect(r.lines).toHaveLength(1);
    const l = r.lines[0];
    expect(l).toMatchObject({ key: "competitor_comment", provider: "fetchin", maxPoints: cfg.scoring.signals.competitor_comment.weight, eventCount: 2, costMicros: 1000 });
    expect(l.points).toBeGreaterThan(0);
    expect(l.evidence[0].url).toContain("linkedin.com");
  });
  it("caps intent at the maximum and keeps the raw sum for ordering", () => {
    const many = (["competitor_comment", "topic_post", "new_role", "hiring", "funding"] as const).map((k) => ev(k, 0));
    const r = scoreIntent(many, cfg, NOW);
    expect(r.points).toBe(cfg.scoring.intentMax);
    expect(r.raw).toBeGreaterThan(r.points);
  });
  it("scores a fresher event higher than an older one", () => {
    expect(scoreIntent([ev("topic_post", 1)], cfg, NOW).points).toBeGreaterThan(scoreIntent([ev("topic_post", 40)], cfg, NOW).points);
  });
});

describe("whole score", () => {
  it("adds fit and intent, bands the result and writes plain reasons", () => {
    const s = scorePerson([ev("competitor_comment", 1)], { title: "Head of Growth", industry: "Software", companySize: 100, enriched: true }, cfg, NOW);
    expect(s.score).toBe(Math.round(s.fitPoints + s.intentPoints));
    expect(["hot", "warm", "cool"]).toContain(s.band);
    expect(s.reasons[0]).toMatch(/points, from fetchin/);
  });
  it("rejects a config that lacks a signal weight", () => {
    const bad = JSON.parse(JSON.stringify(cfg));
    delete bad.scoring.signals.funding;
    expect(() => parseConfig(bad)).toThrow(/funding/);
  });
});
