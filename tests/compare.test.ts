import { describe, it, expect } from "vitest";
import fs from "fs";
import { extractPdf } from "../src/lib/extract";
import { splitClauses } from "../src/lib/clauses";
import { figureDelta, wordDiff, similarity } from "../src/lib/diff";
import { applyClassification, buildChanges, parseClassification } from "../src/lib/compare";

const load = async (f: string) => extractPdf(fs.readFileSync(`tests/fixtures/${f}`));
const v1 = await load("contract_v1.pdf");
const v2 = await load("contract_v2.pdf");
const { changes, unchanged } = buildChanges(v1, v2);
const by = (h: string) => changes.find((c) => c.heading === h || c.heading?.includes(h))!;

describe("clause splitting", () => {
  it("finds the preamble and 7 numbered clauses", () => {
    const c = splitClauses(v1.text);
    expect(c.map((x) => x.number)).toEqual([null, "1", "2", "3", "4", "5", "6", "7"]);
    expect(c[3].heading).toBe("Liability");
  });
  it("does not treat a wrapped '2.5 million' or '30 days' line as a clause", () => {
    const t = "1. Fees\nThe fee is\n2.5 million dirhams\n30 days after\n2. Term\nOne year.\n3. Law\nUAE law.";
    expect(splitClauses(t).map((x) => x.number)).toEqual(["1", "2", "3"]);
  });
  it("falls back to paragraphs when there is no numbering", () => {
    const t = "First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.";
    expect(splitClauses(t)).toHaveLength(3);
  });
});

describe("alignment on two real PDFs", () => {
  it("counts unchanged / changed clauses", () => {
    expect(unchanged).toBe(4); // preamble, definitions, confidentiality, governing law
    expect(changes.map((c) => [c.heading, c.kind])).toEqual([
      ["Payment", "modified"], ["Liability", "modified"], ["Termination", "modified"],
      ["Publicity", "removed"], ["Non-Compete", "added"],
    ]);
  });
  it("detects the liability cap change as figures, by code", () => {
    expect(by("Liability").figures).toEqual({ removed: ["AED 100,000"], added: ["AED 1,000,000"] });
  });
  it("detects 30 -> 45 days", () => {
    expect(by("Payment").figures).toEqual({ removed: ["30 days"], added: ["45 days"] });
  });
  it("finds no figure change in a pure rewording", () => {
    const t = by("Termination");
    expect(t.kind).toBe("modified");
    expect(t.figures).toEqual({ removed: [], added: [] });
  });
  it("rule-based fallback rates the cap change high and the reword low", () => {
    expect(by("Liability").significance).toBe("high");
    expect(by("Termination").significance).toBe("low");
  });
});

describe("model output handling", () => {
  it("floors a figure change the model called cosmetic", () => {
    const copy = JSON.parse(JSON.stringify(changes));
    const liab = copy.find((c: any) => c.heading === "Liability");
    applyClassification(copy, new Map([[liab.id, { summary: "Wording tweaked.", significance: "cosmetic" as const, category: "Liability" }]]));
    expect(liab.significance).toBe("medium");
    expect(liab.floored).toBe(true);
  });
  it("lets the model call a reword cosmetic", () => {
    const copy = JSON.parse(JSON.stringify(changes));
    const t = copy.find((c: any) => c.heading === "Termination");
    applyClassification(copy, new Map([[t.id, { summary: "Same right, reworded.", significance: "cosmetic" as const, category: "Termination" }]]));
    expect(t.significance).toBe("cosmetic");
    expect(t.source).toBe("model");
  });
  it("ignores invented ids, bad ratings and garbage", () => {
    const raw = 'junk {"results":[{"id":"c1","summary":"ok","significance":"high","category":"X"},{"id":"zzz","summary":"x","significance":"high"},{"id":"c2","summary":"x","significance":"catastrophic"}]}';
    expect([...parseClassification(raw, new Set(["c1", "c2"])).keys()]).toEqual(["c1"]);
    expect(parseClassification("sorry", new Set(["c1"])).size).toBe(0);
  });
});

describe("helpers", () => {
  it("treats 'thirty days' and '30 days' as the same figure", () => {
    expect(figureDelta("within thirty days", "within 30 days")).toEqual({ removed: [], added: [] });
  });
  it("word diff isolates the changed words", () => {
    const d = wordDiff("shall pay within 30 days of receipt", "shall pay within 45 days of receipt")!;
    expect(d.filter((o) => o.t !== "eq").map((o) => [o.t, o.text.trim()])).toEqual([["del", "30"], ["ins", "45"]]);
  });
  it("similarity is high for a one-number change, low for unrelated text", () => {
    expect(similarity("fee is 30 days late", "fee is 45 days late")).toBeGreaterThan(0.5);
    expect(similarity("Neither party shall issue any press release", "During the term the Supplier shall not compete")).toBeLessThan(0.3);
  });
});
