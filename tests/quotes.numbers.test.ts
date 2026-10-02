import { describe, it, expect } from "vitest";
import { buildIndex, findQuote, numbersAgree } from "../src/lib/quotes";

const text = "The fee is 10.5 percent per annum. The penalty is 1.000 USD per day. The cap is AED 100,000 in total.";
const idx = buildIndex(text, [{ page: 1, start: 0, end: text.length }]);

describe("numeric guard", () => {
  it("accepts identical numbers", () => {
    expect(findQuote(idx, "The cap is AED 100,000 in total").status).toBe("verified");
  });
  it("rejects 10.5 vs 105", () => {
    expect(findQuote(idx, "The fee is 105 percent per annum").status).toBe("unverified");
  });
  it("rejects 1.000 vs 1,000", () => {
    expect(findQuote(idx, "The penalty is 1,000 USD per day").status).toBe("unverified");
  });
  it("re-joins digit groups split by extraction spaces", () => {
    expect(numbersAgree("1000,5 EUR", "1 000,5 EUR")).toBe(true);
  });
  it("still rejects a genuinely different number", () => {
    expect(numbersAgree("1,000,000", "100,000")).toBe(false);
  });
});
