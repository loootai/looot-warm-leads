import { describe, expect, it } from "vitest";
import { findEmail, normalizeCompanyUrl, normalizeProfileUrl, parseCompany, parseEngagement, parsePosts, parseProfile, parseVerify, personOf } from "./parse";

describe("urls", () => {
  it("normalizes personal profile URLs and rejects company pages", () => {
    expect(normalizeProfileUrl("https://uk.linkedin.com/in/Jane-Doe-1/?trk=x")).toBe("https://www.linkedin.com/in/jane-doe-1");
    expect(normalizeProfileUrl("https://www.linkedin.com/company/acme")).toBeNull();
    expect(normalizeCompanyUrl("https://www.linkedin.com/company/Acme/")).toBe("https://www.linkedin.com/company/acme");
  });
});

describe("engagement", () => {
  it("reads commenters and reactors from nested wrappers and drops company actors", () => {
    const body = {
      comments: [{ author: { name: "Ann Example", headline: "Head of Growth at X", linkedinUrl: "https://www.linkedin.com/in/ann" }, text: "Nice", createdAt: "2026-10-01T00:00:00Z" }],
      reactions: [{ reactor: { name: "Bob Example", publicIdentifier: "bob" }, type: "LIKE" }, { reactor: { name: "Acme", linkedinUrl: "https://www.linkedin.com/company/acme" } }],
    };
    const r = parseEngagement(body);
    expect(r.map((x) => [x.person.name, x.type])).toEqual([["Ann Example", "comment"], ["Bob Example", "reaction"]]);
    expect(r[0].text).toBe("Nice");
    expect(r[0].date).toBe("2026-10-01T00:00:00.000Z");
  });
  it("finds the lists one level down under data", () => {
    expect(parseEngagement({ data: { comments: [{ author: { name: "A B", url: "https://www.linkedin.com/in/ab" }, text: "x" }] } })).toHaveLength(1);
  });
  it("returns nothing for a shape it does not know", () => {
    expect(parseEngagement({ weird: true })).toEqual([]);
    expect(personOf({ name: "No Url" })).toBeNull();
  });
});

describe("posts", () => {
  it("keeps rows with a post URL and reads the date object and engagement counts", () => {
    const rows = parsePosts({ elements: [{ linkedinUrl: "https://www.linkedin.com/posts/a_1", content: "Hello", postedAt: { date: "2026-10-02T00:00:00Z" }, engagement: { likes: 10, comments: 2 }, author: { name: "Cy Example", linkedinUrl: "https://www.linkedin.com/in/cy" } }, { content: "no url" }] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: "Hello", engagement: 12, date: "2026-10-02T00:00:00.000Z" });
    expect(rows[0].author?.name).toBe("Cy Example");
  });
});

describe("profile and company", () => {
  it("reads the current role, its start date and the company page", () => {
    const p = parseProfile({ firstName: "Dee", lastName: "Example", headline: "Growth", location: { name: "Paris, France" }, experiences: [{ title: "Old", companyName: "Past", startDate: "2020-01-01", endDate: "2022-01-01" }, { title: "Head of Growth", companyName: "Acme", companyUrl: "https://www.linkedin.com/company/acme", startDate: { year: 2026, month: 9 } }] });
    expect(p).toMatchObject({ name: "Dee Example", title: "Head of Growth", company: "Acme", companyUrl: "https://www.linkedin.com/company/acme", roleStart: "2026-09-01T00:00:00.000Z", location: "Paris, France" });
  });
  it("reads a company from a nested body", () => {
    expect(parseCompany({ data: { name: "Acme", website: "https://www.acme.example/about", industries: [{ name: "Software" }], employeeCount: "51-200 employees" } })).toEqual({ name: "Acme", domain: "acme.example", industry: "Software", size: 51 });
  });
});

describe("email", () => {
  it("finds the first address anywhere and lower-cases it", () => {
    expect(findEmail({ result: { emails: [{ email: "Jo@example.com", deliverability: "ok" }] } })).toBe("jo@example.com");
    expect(findEmail({ emails: [] })).toBeNull();
  });
  it("maps the verifier word to deliverable", () => {
    expect(parseVerify({ result: "ok", quality: "good" })).toEqual({ status: "ok", deliverable: true });
    expect(parseVerify({ data: { status: "catch_all" } })).toEqual({ status: "catch_all", deliverable: false });
    expect(parseVerify({ nothing: 1 })).toBeNull();
  });
});
