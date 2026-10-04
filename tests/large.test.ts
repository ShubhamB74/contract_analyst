import { describe, it, expect } from "vitest";
import fs from "fs";
import { extractPdf } from "../src/lib/extract";
import { chunkText } from "../src/lib/chunk";
import { splitClauses } from "../src/lib/clauses";
import { getPassages, searchPassages } from "../src/lib/search";
import { buildIndex, findQuote } from "../src/lib/quotes";
import { config } from "../src/lib/config";

/** A 148-page agreement with three clauses buried on pages 66, 88 and 115. */
describe("150-page document", async () => {
  const ex = await extractPdf(fs.readFileSync("samples/master_services_agreement_long.pdf"));

  it("extracts every page and is far too big for one request", () => {
    expect(ex.pageCount).toBeGreaterThanOrEqual(140);
    expect(ex.text.length).toBeGreaterThan(config.fullContextChars * 5);
  });
  it("chunks it with no gaps", () => {
    const c = chunkText(ex.text, ex.pages, config.chunkChars, config.chunkOverlap);
    expect(c.length).toBeGreaterThan(30);
    expect(c[0].start).toBe(0);
    expect(c.at(-1)!.end).toBe(ex.text.length);
    for (let i = 1; i < c.length; i++) expect(c[i].start).toBeLessThanOrEqual(c[i - 1].end);
  });
  it("splits ~760 numbered clauses", () => {
    expect(splitClauses(ex.text).length).toBeGreaterThan(700);
  });
  it("agent search finds the buried clauses", () => {
    const top = (q: string) => searchPassages(getPassages({ id: "L", text: ex.text, pages: ex.pages }), q)[0].passage;
    expect(top("personal data breach notification").key).toBe("340");
    expect(top("liability cap").key).toBe("450");
    expect(top("early termination fee").key).toBe("590");
  });
  it("verifies a buried quote and reports the right page", () => {
    const idx = buildIndex(ex.text, ex.pages);
    const r = findQuote(idx, "notify the Customer of any Personal Data breach without undue delay and in any event within 72 hours");
    expect(r.status).toBe("verified");
    if (r.status === "verified") expect(r.matches[0].page).toBeGreaterThan(60);
    expect(findQuote(idx, "notify the Customer of any Personal Data breach within 24 hours").status).toBe("unverified");
  });
});
