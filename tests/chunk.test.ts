import { describe, it, expect } from "vitest";
import { chunkText } from "../src/lib/chunk";
import { parseQuotes } from "../src/lib/retrieve";
import { pool } from "../src/lib/pool";

describe("chunkText", () => {
  const para = (n: number) => `Clause ${n}. ` + "word ".repeat(120);
  const text = Array.from({ length: 200 }, (_, i) => para(i)).join("\n\n");
  const pages = [{ page: 1, start: 0, end: text.length }];

  it("covers the whole text with no gaps", () => {
    const c = chunkText(text, pages, 12_000, 600);
    expect(c[0].start).toBe(0);
    expect(c.at(-1)!.end).toBe(text.length);
    for (let i = 1; i < c.length; i++) expect(c[i].start).toBeLessThanOrEqual(c[i - 1].end);
  });
  it("respects max size", () => {
    expect(chunkText(text, pages, 12_000, 600).every((c) => c.text.length <= 12_000)).toBe(true);
  });
});

describe("parseQuotes", () => {
  it("parses JSON wrapped in prose/fences", () => {
    expect(parseQuotes('Here: ```json\n{"quotes":["a b c"]}\n```')).toEqual(["a b c"]);
  });
  it("returns null on garbage so the chunk counts as unread", () => {
    expect(parseQuotes("sorry, no")).toBeNull();
    expect(parseQuotes('{"quotes":"nope"}')).toBeNull();
  });
});

describe("pool", () => {
  it("limits concurrency and keeps order", async () => {
    let active = 0, peak = 0;
    const out = await pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--; return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
