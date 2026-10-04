import { describe, it, expect } from "vitest";
import { coverageKind } from "../src/lib/coverage";
import type { Coverage } from "../src/lib/types";

const c = (o: Partial<Coverage>): Coverage => ({ docId: "d", totalChunks: 761, readChunks: 9, complete: false, ...o });

describe("coverageKind", () => {
  it("research-mode answer (9 of 761 read) is a quiet 'targeted' note, not a warning", () => {
    expect(coverageKind([c({ targeted: true, note: "targeted research, not a full read" })])).toBe("targeted");
  });
  it("an answer saved BEFORE the flags existed must not turn into 'Read all 761 sections'", () => {
    expect(coverageKind([c({ note: "targeted research, not a full read" })])).toBe("targeted");
    expect(coverageKind([c({})])).toBe("targeted");
  });
  it("failed sections or dropped passages are a hard warning, including old saved messages", () => {
    expect(coverageKind([c({ failedChunks: [3] })])).toBe("hard");
    expect(coverageKind([c({ capped: true })])).toBe("hard");
    expect(coverageKind([c({ note: "Too many matching passages; only the first 80 were used." })])).toBe("hard");
  });
  it("hard wins when one document is targeted and another failed", () => {
    expect(coverageKind([c({ targeted: true }), c({ docId: "e", failedChunks: [1] })])).toBe("hard");
  });
  it("complete reads", () => {
    expect(coverageKind([c({ complete: true, readChunks: 37, totalChunks: 37 })])).toBe("full");
    expect(coverageKind([c({ complete: true, readChunks: 1, totalChunks: 1 })])).toBe("none");
  });
});
