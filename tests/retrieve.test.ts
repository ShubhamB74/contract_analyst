import { describe, it, expect } from "vitest";
import fs from "fs";
import { extractPdf } from "../src/lib/extract";
import { gatherExcerpts, coverageStatement, type ChatClient } from "../src/lib/retrieve";
import { chunkText } from "../src/lib/chunk";
import { rankTexts } from "../src/lib/search";
import { config } from "../src/lib/config";

const ex = await extractPdf(fs.readFileSync("samples/master_services_agreement_long.pdf"));
const doc = { id: "L", name: "long.pdf", text: ex.text, pages: ex.pages };
const SENTENCE = "The Supplier shall notify the Customer of any Personal Data breach without undue delay and in any event within 72 hours of becoming aware of it.";
const nChunks = chunkText(ex.text, ex.pages, config.chunkChars, config.chunkOverlap).length;
const ac = () => new AbortController().signal;

/** Fake model: finds `needle` in the section it is shown and "quotes" it; counts calls. */
function fake(needle: string, opts: { failAlways?: boolean; failFirst?: number } = {}) {
  const state = { calls: 0, failed: 0 };
  const client = { chat: { completions: { create: async (p: any) => {
    state.calls++;
    if (opts.failAlways || (opts.failFirst && state.failed < opts.failFirst)) { state.failed++; throw new Error("429 rate limited"); }
    const section: string = p.messages[1].content;
    return { choices: [{ message: { content: JSON.stringify({ quotes: section.includes(needle) ? [SENTENCE] : [] }) } }] };
  } } } } as unknown as ChatClient;
  return { client, state };
}
const run = (q: string, o: Partial<Parameters<typeof gatherExcerpts>[0]> & { f: ReturnType<typeof fake> }) =>
  gatherExcerpts({ docs: [doc], question: q, signal: ac(), onStatus: () => {}, client: o.f.client, retryDelayMs: 1, ...o });

describe("relevance-first reading of a 148-page document", () => {
  it("ranks the section containing the answer near the top", () => {
    const chunks = chunkText(ex.text, ex.pages, config.chunkChars, config.chunkOverlap);
    const scores = rankTexts(chunks.map((c) => c.text), "data breach notification deadline");
    const best = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s).slice(0, config.relevantChunks).map((x) => x.i);
    const home = chunks.findIndex((c) => c.text.includes("within 72 hours"));
    expect(best).toContain(home);
  });

  it("reads only the top sections (not all) and still finds the answer", async () => {
    const f = fake("within 72 hours");
    const r = await run("data breach notification deadline", { f });
    expect(nChunks).toBeGreaterThan(30);
    expect(f.state.calls).toBeLessThanOrEqual(config.relevantChunks);      // ~8 calls instead of ~37+
    expect(r.excerpts.some((e) => e.text.includes("72 hours"))).toBe(true);
    expect(r.coverage[0]).toMatchObject({ targeted: true, complete: false, totalChunks: nChunks });
    expect(r.coverage[0].failedChunks).toEqual([]);
    expect(coverageStatement(r.coverage, { L: "long.pdf" })).toMatch(/^COVERAGE: TARGETED/);
  });

  it("reads the whole document when nothing is found, so absence can be reported honestly", async () => {
    const f = fake("THIS TEXT DOES NOT EXIST");
    const r = await run("data breach notification deadline", { f });
    expect(f.state.calls).toBe(nChunks);                                    // every section read
    expect(r.excerpts).toHaveLength(0);
    expect(r.coverage[0]).toMatchObject({ complete: true, readChunks: nChunks });
    expect(coverageStatement(r.coverage, { L: "long.pdf" })).toMatch(/^COVERAGE: COMPLETE/);
  });

  it("'full' strategy reads every section", async () => {
    const f = fake("within 72 hours");
    const r = await run("data breach notification deadline", { f, strategy: "full" });
    expect(f.state.calls).toBe(nChunks);
    expect(r.coverage[0].complete).toBe(true);
  });

  it("retries a throttled call and recovers", async () => {
    const f = fake("within 72 hours", { failFirst: 2 });
    const r = await run("data breach notification deadline", { f });
    expect(r.excerpts.length).toBeGreaterThan(0);
    expect(r.coverage[0].failedChunks).toEqual([]);
  });

  it("marks sections unread when the provider keeps failing, and says INCOMPLETE", async () => {
    const f = fake("x", { failAlways: true });
    const r = await run("data breach notification deadline", { f });
    expect(r.coverage[0].complete).toBe(false);
    expect(r.coverage[0].failedChunks!.length).toBeGreaterThan(0);
    expect(coverageStatement(r.coverage, { L: "long.pdf" })).toMatch(/^COVERAGE: INCOMPLETE/);
  });

  it("small documents are simply read in full (no targeting)", async () => {
    const small = { id: "S", name: "s.pdf", text: ex.text.slice(0, 20_000), pages: ex.pages };
    const f = fake("within 72 hours");
    const r = await gatherExcerpts({ docs: [small], question: "anything", signal: ac(), onStatus: () => {}, client: f.client });
    expect(r.coverage[0].complete).toBe(true);
    expect(r.coverage[0].targeted).toBeUndefined();
  });
});
