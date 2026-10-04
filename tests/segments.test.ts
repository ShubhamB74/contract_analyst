import { describe, it, expect } from "vitest";
import { segmentContent } from "../src/lib/segments";
import { QA_SYSTEM, REDUCE_SYSTEM, agentSystem } from "../src/lib/prompts";

const shape = (c: string) => segmentContent(c).map((s) => (s.type === "quote" ? `Q${s.id}` : s.text));

describe("segmentContent", () => {
  it("drops the stray commas / 'and' / full stops seen between quote cards", () => {
    // the exact pattern from the screenshot
    const c = "The thing to build is [[q:0]] It lists features including [[q:1]] , [[q:2]] , and [[q:3]] . The user flow is [[q:4]]";
    expect(shape(c)).toEqual(["The thing to build is ", "Q0", "It lists features including ", "Q1", "Q2", "Q3", "The user flow is ", "Q4"]);
  });
  it("trims punctuation left dangling after a card but keeps real text", () => {
    expect(shape("[[q:0]], and the cap rises to AED 1,000,000.")).toEqual(["Q0", "and the cap rises to AED 1,000,000."]);
    expect(shape("[[q:0]] . Next point.")).toEqual(["Q0", "Next point."]);
  });
  it("leaves answers without quotes untouched", () => {
    expect(shape("Not found in the document.")).toEqual(["Not found in the document."]);
    expect(shape("")).toEqual([]);
  });
});

describe("answer prompts", () => {
  it("all three tell the model to write sentences that stand without the quote", () => {
    for (const p of [QA_SYSTEM, REDUCE_SYSTEM, agentSystem(6, 4, "D1 = x", false)]) {
      expect(p).toMatch(/self-contained sentences/);
      expect(p).toMatch(/Never use a quote as part of a sentence/);
    }
  });
});
