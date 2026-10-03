import { describe, it, expect } from "vitest";
import { processAnswer } from "../src/lib/answer";
import { uniqueLabels } from "../src/lib/labels";

const A = { id: "uuid-a", text: "The Supplier's total liability shall not exceed AED 100,000 in any calendar year.", pages: [{ page: 1, start: 0, end: 200 }] };
const B = { id: "uuid-b", text: "The Supplier's total liability shall not exceed AED 1,000,000 in any calendar year.", pages: [{ page: 1, start: 0, end: 200 }] };
const aliases = { D1: "uuid-a", D2: "uuid-b" };

describe("multi-document verification", () => {
  it("verifies each quote against its own document and stores real ids", () => {
    const raw = `A caps at <quote doc="D1">total liability shall not exceed AED 100,000 in any calendar year</quote>, B at <quote doc="D2">total liability shall not exceed AED 1,000,000 in any calendar year</quote>.`;
    const { quotes, content } = processAnswer(raw, [A, B], aliases);
    expect(quotes.map((q) => [q.docId, q.status])).toEqual([["uuid-a", "verified"], ["uuid-b", "verified"]]);
    expect(content).toBe("A caps at [[q:0]], B at [[q:1]].");
  });

  it("rejects a quote attributed to the wrong document", () => {
    // Text exists in A, but the model says it came from B.
    const raw = `<quote doc="D2">total liability shall not exceed AED 100,000 in any calendar year</quote>`;
    expect(processAnswer(raw, [A, B], aliases).quotes[0].status).toBe("unverified");
  });

  it("rejects an unknown document alias", () => {
    const raw = `<quote doc="D9">total liability shall not exceed AED 100,000 in any calendar year</quote>`;
    const q = processAnswer(raw, [A, B], aliases).quotes[0];
    expect(q.status).toBe("unverified");
    expect(q.reason).toMatch(/unknown document/i);
  });

  it("drops a dangling tag left by Stop", () => {
    const { content, quotes } = processAnswer(`Liability is capped. <quote doc="D1">total liab`, [A, B], aliases);
    expect(content).toBe("Liability is capped.");
    expect(quotes).toHaveLength(0);
  });
});

describe("uniqueLabels", () => {
  it("numbers duplicate filenames only", () => {
    expect(uniqueLabels([{ id: "1", name: "msa.pdf" }, { id: "2", name: "msa.pdf" }, { id: "3", name: "nda.pdf" }]))
      .toEqual({ "1": "msa.pdf (1)", "2": "msa.pdf (2)", "3": "nda.pdf" });
  });
});
