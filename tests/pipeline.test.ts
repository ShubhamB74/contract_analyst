import { describe, it, expect } from "vitest";
import fs from "fs";
import { extractPdf } from "../src/lib/extract";
import { buildIndex, findQuote } from "../src/lib/quotes";
import { planHighlight } from "../src/lib/highlight";

/**
 * Real-PDF check of the whole chain: server extraction -> verification -> locating the quote
 * again in pdf.js text items (what the browser viewer sees).
 */
describe("real PDF pipeline", async () => {
  const buf = fs.readFileSync("tests/fixtures/sample.pdf");
  const ex = await extractPdf(buf);
  const idx = buildIndex(ex.text, ex.pages);

  // pdf.js text items per page, as the browser sees them (legacy build runs in Node)
  // unpdf registers its own bundled pdf.js worker globally; drop it so the browser-version worker is used.
  delete (globalThis as Record<string, unknown>).pdfjsWorker;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const pageStrs = async (n: number) =>
    (await (await pdf.getPage(n)).getTextContent()).items.filter((i) => "str" in i).map((i) => (i as { str: string }).str);

  it("extracts 2 pages", () => expect(ex.pageCount).toBe(2));

  it("verifies and highlights a quote wrapped over several lines", async () => {
    const q = "total liability under this Agreement shall not exceed AED 100,000 in any calendar year";
    const f = findQuote(idx, q);
    expect(f.status).toBe("verified");
    if (f.status !== "verified") return;
    const plan = planHighlight([await pageStrs(f.matches[0].page!)], q);
    expect(plan?.complete).toBe(true);
  });

  it("verifies and highlights a quote that crosses the page break", async () => {
    const q = "without the prior written consent of the Disclosing Party for a period of five years";
    const f = findQuote(idx, q);
    expect(f.status).toBe("verified");
    if (f.status !== "verified") return;
    const start = f.matches[0].page!;
    const plan = planHighlight([await pageStrs(start), await pageStrs(start + 1)], q);
    expect(start).toBe(1);
    expect(plan?.complete).toBe(true);
    expect(plan?.plans.map((p) => p.page)).toEqual([0, 1]); // highlighted on both pages
  });
});
