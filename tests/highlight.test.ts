import { describe, it, expect } from "vitest";
import { planHighlight } from "../src/lib/highlight";

const apply = (strs: string[], segs: { item: number; from: number; to: number }[]) =>
  segs.map((s) => strs[s.item].slice(s.from, s.to)).join("");

describe("planHighlight", () => {
  const page1 = ["12.1 The Supplier's total liabil-", "ity under this Agreement shall ", "not exceed AED 100,000 in any", " calendar year."];

  it("highlights a quote spanning several fragments", () => {
    const r = planHighlight([page1], "total liability under this Agreement shall not exceed AED 100,000")!;
    expect(r.complete).toBe(true);
    const segs = r.plans[0].segs;
    expect(segs.length).toBe(3);
    expect(apply(page1, segs).replace(/\W/g, "")).toBe("totalliabilityunderthisAgreementshallnotexceedAED100000");
  });

  it("trims to the exact start/end inside a fragment", () => {
    const r = planHighlight([page1], "AED 100,000")!;
    expect(apply(page1, r.plans[0].segs)).toBe("AED 100,000");
  });

  it("picks the requested occurrence of a repeated quote", () => {
    const strs = ["Either party may terminate on notice. ", "Other text here. ", "Either party may terminate on notice."];
    const a = planHighlight([strs], "Either party may terminate on notice", 0)!.plans[0].segs[0];
    const b = planHighlight([strs], "Either party may terminate on notice", 1)!.plans[0].segs[0];
    expect(a.item).toBe(0);
    expect(b.item).toBe(2);
  });

  it("splits a quote across a page break", () => {
    const p1 = ["...intro. The Receiving Party shall keep all Confidential", " Information strictly secret and shall"];
    const p2 = [" not disclose it to any third party without consent.", " Next sentence."];
    const quote = "Confidential Information strictly secret and shall not disclose it to any third party without consent";
    const r = planHighlight([p1, p2], quote)!;
    expect(r.complete).toBe(true);
    expect(r.plans.map((p) => p.page)).toEqual([0, 1]);
    expect(apply(p2, r.plans[1].segs).trim()).toBe("not disclose it to any third party without consent.".slice(0, -1));
  });

  it("returns a partial plan when a header sits between pages", () => {
    const p1 = ["The Supplier shall deliver the goods within thirty days"];
    const p2 = ["CONFIDENTIAL - Page 4", "of the purchase order being placed."];
    const r = planHighlight([p1, p2], "The Supplier shall deliver the goods within thirty days of the purchase order being placed")!;
    expect(r.complete).toBe(false);
    expect(r.plans).toHaveLength(1);
  });

  it("returns null when the quote is not on the rendered pages", () => {
    expect(planHighlight([page1], "liability shall never be limited in any way")).toBeNull();
  });
});
