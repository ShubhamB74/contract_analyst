import { describe, it, expect } from "vitest";
import fs from "fs";
import { extractPdf } from "../src/lib/extract";
import { runAgent, type ChatClient } from "../src/lib/agent";
import { executeTool, parseArgs, type ToolDoc } from "../src/lib/tools";
import { getPassages, searchPassages } from "../src/lib/search";
import { processAnswer } from "../src/lib/answer";
import type { StreamEvent } from "../src/lib/types";

const ex = await extractPdf(fs.readFileSync("tests/fixtures/contract_v1.pdf"));
const doc: ToolDoc = { id: "uuid-1", alias: "D1", name: "contract_v1.pdf", text: ex.text, pages: ex.pages };
const ctx = () => ({ docs: [doc], seen: new Map<string, Set<number>>() });

// ── scripted fake model ──────────────────────────────────────────────────────────
type Turn = { content?: string; calls?: { name: string; args: string }[] };
function fakeClient(turns: Turn[], finalText = "Final answer from forced turn.") {
  const seen: { messages: any[]; tool_choice: unknown }[] = [];
  let i = 0;
  const client = {
    chat: { completions: { create: async (params: any, opts: any) => {
      if (opts?.signal?.aborted) { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
      seen.push({ messages: JSON.parse(JSON.stringify(params.messages)), tool_choice: params.tool_choice });
      const turn: Turn = params.tool_choice === "none" ? { content: finalText } : turns[i++] ?? { content: "done" };
      async function* gen() {
        if (turn.content) for (const piece of turn.content.match(/.{1,12}/gs) ?? []) yield { choices: [{ delta: { content: piece } }] };
        for (const [idx, c] of (turn.calls ?? []).entries()) {
          const half = Math.floor(c.args.length / 2);                      // arguments arrive in pieces
          yield { choices: [{ delta: { tool_calls: [{ index: idx, id: `id${idx}`, function: { name: c.name, arguments: c.args.slice(0, half) } }] } }] };
          yield { choices: [{ delta: { tool_calls: [{ index: idx, function: { arguments: c.args.slice(half) } }] } }] };
        }
      }
      return gen();
    } } },
  } as unknown as ChatClient;
  return { client, seen };
}
const run = (turns: Turn[], over: Partial<Parameters<typeof runAgent>[0]> = {}) => {
  const events: StreamEvent[] = [];
  const f = fakeClient(turns);
  const p = runAgent({ client: f.client, docs: [doc], question: "What is the liability cap?", history: [], signal: new AbortController().signal, emit: (e) => events.push(e), ...over });
  return { p, events, ...f };
};
const toolMsgs = (seen: { messages: any[] }[]) => seen.at(-1)!.messages.filter((m) => m.role === "tool").map((m) => m.content as string);

describe("search + tools", () => {
  it("ranks the liability clause first for a liability question", () => {
    const hits = searchPassages(getPassages(doc), "cap on liability");
    expect(hits[0].passage.key).toBe("3");
  });
  it("finds termination via the heading even though the question says 'end the contract'", () => {
    expect(searchPassages(getPassages(doc), "end the contract")[0].passage.key).toBe("4");
  });
  it("get_section returns the clause text verbatim", () => {
    const r = executeTool("get_section", '{"number":"3"}', ctx());
    expect(r.ok).toBe(true);
    expect(r.content).toContain("AED 100,000");
  });
  it("get_section accepts a number as a JSON number and a heading as a fallback", () => {
    expect(executeTool("get_section", { number: 3 }, ctx()).ok).toBe(true);
    expect(executeTool("get_section", '{"number":"termination"}', ctx()).content).toContain("60 days");
  });
  it("returns ERROR results, never throws, for bad calls", () => {
    for (const [name, args] of [
      ["no_such_tool", "{}"], ["search_document", "{bad json"], ["search_document", "{}"], ["search_document", '{"query":42}'],
      ["get_section", "{}"], ["get_section", '{"number":"999"}'], ["search_document", '{"query":"x","doc":"D9"}'],
      ["get_section", "[1,2]"], [undefined, undefined], [null, 5],
    ] as const) {
      const r = executeTool(name, args, ctx());
      expect(r.ok).toBe(false);
      expect(r.content.startsWith("ERROR:")).toBe(true);
    }
  });
  it("clamps nonsense max_results", () => {
    expect(executeTool("search_document", '{"query":"payment","max_results":9999}', ctx()).ok).toBe(true);
    expect(executeTool("search_document", '{"query":"payment","max_results":"lots"}', ctx()).ok).toBe(true);
  });
  it("parseArgs rejects non-objects", () => {
    expect(parseArgs("[]").ok).toBe(false);
    expect(parseArgs("").ok).toBe(true);
  });
});

describe("agent loop", () => {
  it("search -> read -> answer, with live steps and a verifiable quote", async () => {
    const { p, events } = run([
      { calls: [{ name: "search_document", args: '{"query":"liability cap"}' }] },
      { calls: [{ name: "get_section", args: '{"number":"3"}' }] },
      { content: 'The cap is <quote doc="D1">total liability under this Agreement shall not exceed AED 100,000 in any calendar year</quote>.' },
    ]);
    const r = await p;
    expect(r.stoppedBy).toBe("answer");
    expect(r.rounds).toBe(2);
    expect(r.steps[0]).toMatch(/^Searched for “liability cap”/);
    expect(r.steps[1]).toBe("Read clause 3 (Liability)");
    expect(events.filter((e) => e.type === "step" && e.state === "running").map((e: any) => e.text)).toEqual(["Searching for “liability cap”…", "Reading clause 3…"]);
    expect(events.some((e) => e.type === "delta")).toBe(true);
    // the final quote is verified against the REAL document, like every other mode
    const { quotes } = processAnswer(r.raw, [{ id: doc.id, text: doc.text, pages: doc.pages }], { D1: doc.id });
    expect(quotes[0].status).toBe("verified");
    expect(r.coverage[0].complete).toBe(false); // read 1-2 of 8 clauses: must not look like a full read
    expect(r.coverage[0].readChunks).toBeGreaterThan(0);
  });

  it("survives unknown tools, malformed JSON and missing arguments in one round", async () => {
    const { p, seen } = run([
      { calls: [{ name: "delete_everything", args: "{}" }, { name: "search_document", args: "{oops" }, { name: "get_section", args: "{}" }] },
      { content: "I could not find it." },
    ]);
    const r = await p;
    expect(r.raw).toBe("I could not find it.");
    const msgs = toolMsgs(seen);
    expect(msgs).toHaveLength(3);
    expect(msgs.every((m) => m.startsWith("ERROR:"))).toBe(true);
    expect(msgs[0]).toMatch(/Available tools/);
  });

  it("answers every tool_call id (APIs reject orphaned calls)", async () => {
    const { p, seen } = run([{ calls: [{ name: "list_clauses", args: "{}" }, { name: "bogus", args: "{}" }] }, { content: "ok" }]);
    await p;
    const last = seen.at(-1)!.messages;
    const assistant = last.find((m: any) => m.tool_calls);
    expect(assistant.tool_calls.map((c: any) => c.id)).toEqual(last.filter((m: any) => m.role === "tool").map((m: any) => m.tool_call_id));
  });

  it("enforces the round cap, then forces a final answer with tools disabled", async () => {
    const endless: Turn[] = Array.from({ length: 50 }, (_, i) => ({ calls: [{ name: "search_document", args: `{"query":"term ${i}"}` }] }));
    const { p, seen } = run(endless, { maxRounds: 3 });
    const r = await p;
    expect(r.stoppedBy).toBe("round_cap");
    expect(r.rounds).toBe(3);
    expect(seen).toHaveLength(4);                       // 3 tool rounds + 1 forced final
    expect(seen.at(-1)!.tool_choice).toBe("none");
    expect(r.raw).toBe("Final answer from forced turn.");
  });

  it("stops early when the model only makes bad calls two rounds running", async () => {
    const bad: Turn[] = Array.from({ length: 20 }, (_, i) => ({ calls: [{ name: `nope${i}`, args: "{}" }] }));
    const r = await run(bad, { maxRounds: 6 }).p;
    expect(r.stoppedBy).toBe("bad_calls");
    expect(r.rounds).toBe(2);
  });

  it("refuses to run more than the per-round limit and refuses exact repeats", async () => {
    const calls = Array.from({ length: 6 }, (_, i) => ({ name: "search_document", args: `{"query":"q${i}"}` }));
    const { p, seen } = run([{ calls }, { calls: [{ name: "search_document", args: '{"query":"q0"}' }] }, { content: "x" }]);
    const r = await p;
    expect(r.steps.filter((s) => s.startsWith("Skipped an extra"))).toHaveLength(2);
    expect(toolMsgs(seen).some((m) => m.includes("exact call"))).toBe(true);
  });

  it("keeps the partial answer when the user stops mid-stream, without throwing", async () => {
    const ac = new AbortController();
    const client = { chat: { completions: { create: async (_p: any, o: any) => (async function* () {
      for (const piece of ["The cap is ", "AED 100,000 ", "and applies"]) {
        if (o.signal.aborted) { const e = new Error("aborted"); e.name = "AbortError"; throw e; } // what the SDK does
        yield { choices: [{ delta: { content: piece } }] };
        if (piece === "AED 100,000 ") ac.abort();
      }
    })() } } } as unknown as ChatClient;
    const r = await runAgent({ client, docs: [doc], question: "q", history: [], signal: ac.signal, emit: () => {} });
    expect(r.stoppedBy).toBe("abort");
    expect(r.raw).toBe("The cap is AED 100,000 ");
  });

  it("falls back to a readable message when the model returns nothing", async () => {
    const r = await run([{ calls: [{ name: "list_clauses", args: "{}" }] }, { content: "" }]).p;
    expect(r.raw).toMatch(/wasn’t able to reach an answer/);
    expect(r.raw).toMatch(/Listed clauses/);
  });

  it("tells the UI to discard preamble text that precedes a tool call", async () => {
    const { p, events } = run([{ content: "Let me look that up. ", calls: [{ name: "list_clauses", args: "{}" }] }, { content: "Done." }]);
    // content arrives first (streamed), then the tool call -> a reset must be emitted
    await p;
    expect(events.some((e) => e.type === "reset")).toBe(true);
  });
});
