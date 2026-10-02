import { describe, it, expect } from "vitest";
import { buildIndex, findQuote } from "../src/lib/quotes";

const text =
  "12.1 The Supplier's total liabil-\nity under this Agreement shall not exceed\n  AED 100,000 in any\ncalendar year.\n\n13. Governing Law. This Agreement is governed by the laws of the UAE. " +
  "Either party may terminate on 30 days written notice. Either party may terminate on 30 days written notice.";
const pages = [{ page: 1, start: 0, end: 120 }, { page: 2, start: 120, end: text.length }];
const idx = buildIndex(text, pages);

describe("findQuote", () => {
  it("matches across line breaks, double spaces and hyphenation", () => {
    const r = findQuote(idx, "total liability under this Agreement shall not exceed AED 100,000 in any calendar year");
    expect(r.status).toBe("verified");
  });
  it("maps back to original offsets", () => {
    const r = findQuote(idx, "governed by the laws of the UAE");
    if (r.status !== "verified") throw new Error("expected verified");
    expect(text.slice(r.matches[0].start, r.matches[0].end)).toBe("governed by the laws of the UAE");
  });
  it("rejects a changed number", () => {
    expect(findQuote(idx, "shall not exceed AED 1,000,000 in any calendar year").status).toBe("unverified");
  });
  it("rejects paraphrase", () => {
    expect(findQuote(idx, "liability is capped at one hundred thousand dirhams").status).toBe("unverified");
  });
  it("returns every occurrence of a repeated quote", () => {
    const r = findQuote(idx, "Either party may terminate on 30 days written notice");
    if (r.status !== "verified") throw new Error("expected verified");
    expect(r.matches).toHaveLength(2);
  });
  it("rejects very short quotes", () => {
    expect(findQuote(idx, "the UAE").status).toBe("unverified");
  });
});
