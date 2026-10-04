/**
 * Large-document reading (documents too big for one request).
 *
 *  strategy "relevant" (default, fast): rank sections by BM25 against the question and read only the
 *     top few per document. If a document yields NOTHING, read the rest of it, so we never claim
 *     something is absent without a full read. Coverage is marked `targeted` and the UI says so.
 *  strategy "full": read every section (exhaustive, slower).
 *
 * Every passage the model returns is VERIFIED against the real text; invented ones are dropped.
 * A section whose call fails (after retries) is recorded as unread, which makes coverage INCOMPLETE.
 */
import type OpenAI from "openai";
import { getClient } from "./ai";
import { config } from "./config";
import { chunkText, type Chunk } from "./chunk";
import { pool } from "./pool";
import { MAP_SYSTEM } from "./prompts";
import { findQuote } from "./quotes";
import { rankTexts } from "./search";
import { indexFor, type DocForVerify } from "./answer";
import type { Coverage } from "./types";

export type Excerpt = { docId: string; docName: string; page: number | null; start: number; text: string };
type Doc = DocForVerify & { name: string };
type Job = { doc: Doc; chunk: Chunk };
type ChunkResult = { docId: string; chunkIndex: number; ok: boolean; found: Excerpt[] };
export type ChatClient = Pick<OpenAI, "chat">;

export function parseQuotes(raw: string): string[] | null {
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try {
    const arr = JSON.parse(raw.slice(a, b + 1)).quotes;
    if (!Array.isArray(arr)) return null;
    return arr.map((q: unknown) => (typeof q === "string" ? q : (q as { text?: string })?.text ?? "")).filter((q: string) => q.trim());
  } catch {
    return null;
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); res(); }, { once: true });
  });

export async function gatherExcerpts(opts: {
  docs: Doc[];
  question: string;
  signal: AbortSignal;
  onStatus: (s: string) => void;
  strategy?: "relevant" | "full";
  client?: ChatClient;
  retryDelayMs?: number;
}): Promise<{ excerpts: Excerpt[]; coverage: Coverage[] }> {
  const { docs, question, signal, onStatus } = opts;
  const strategy = opts.strategy ?? "relevant";
  const client = opts.client ?? getClient();
  const retryDelay = opts.retryDelayMs ?? 700;

  const byDoc = new Map<string, Job[]>(
    docs.map((doc) => [doc.id, chunkText(doc.text, doc.pages, config.chunkChars, config.chunkOverlap).map((chunk) => ({ doc, chunk }))])
  );
  const allJobs = [...byDoc.values()].flat();

  // ── first wave ────────────────────────────────────────────────────────────────
  let wave: Job[] = allJobs;
  if (strategy === "relevant") {
    wave = [];
    for (const doc of docs) {
      const jobs = byDoc.get(doc.id)!;
      if (jobs.length <= config.relevantChunks) { wave.push(...jobs); continue; } // small enough: just read it all
      const scores = rankTexts(jobs.map((j) => j.chunk.text), question);
      const top = scores.map((s, i) => ({ s, i })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, config.relevantChunks);
      wave.push(...top.map((x) => jobs[x.i]).sort((a, b) => a.chunk.index - b.chunk.index)); // none scored > 0 => nothing here; fallback below
    }
  }

  let finished = 0;
  let total = wave.length;
  const results: ChunkResult[] = [];

  const runJob = async ({ doc, chunk }: Job): Promise<ChunkResult> => {
    let quotes: string[] | null = null;
    for (let attempt = 0; attempt < 3 && quotes === null; attempt++) {
      if (attempt) await sleep(retryDelay * attempt, signal); // back off: most failures are rate limits
      try {
        const res = await client.chat.completions.create(
          {
            model: config.ai.mapModel,
            temperature: 0,
            max_tokens: 900, // the answer is a short JSON list; capping it keeps each call fast
            messages: [
              { role: "system", content: MAP_SYSTEM },
              { role: "user", content: `Question: ${question}\n\n<section>\n${chunk.text}\n</section>` },
            ],
          },
          { signal }
        );
        quotes = parseQuotes(res.choices[0]?.message?.content ?? "");
      } catch (e) {
        if (signal.aborted) throw e;
      }
    }
    onStatus(`Reading sections… ${++finished} of ${total}`);

    const found: Excerpt[] = [];
    for (const q of quotes ?? []) {
      const r = findQuote(indexFor(doc), q);
      if (r.status === "verified") {
        const m = r.matches[0];
        found.push({ docId: doc.id, docName: doc.name, page: m.page, start: m.start, text: doc.text.slice(m.start, m.end) });
      }
    }
    return { docId: doc.id, chunkIndex: chunk.index, ok: quotes !== null, found };
  };
  const run = async (jobs: Job[]) => { results.push(...(await pool(jobs, config.mapConcurrency, runJob))); };

  await run(wave);

  // ── fallback: a document with no hits must be read fully before anything can be said about absence ──
  if (strategy === "relevant") {
    const rest = docs.flatMap((d) => {
      if (results.some((r) => r.docId === d.id && r.found.length)) return [];
      const done = new Set(results.filter((r) => r.docId === d.id).map((r) => r.chunkIndex));
      return byDoc.get(d.id)!.filter((j) => !done.has(j.chunk.index));
    });
    if (rest.length) {
      total += rest.length;
      onStatus(`Nothing in the most relevant sections. Reading the remaining ${rest.length}…`);
      await run(rest);
    }
  }

  // De-duplicate (overlap can return the same passage twice), keep document order.
  const seen = new Set<string>();
  const ordered = results
    .flatMap((r) => r.found)
    .filter((e) => !seen.has(`${e.docId}:${e.start}`) && seen.add(`${e.docId}:${e.start}`))
    .sort((a, b) => (a.docId === b.docId ? a.start - b.start : a.docId.localeCompare(b.docId)));

  let capNote: string | undefined;
  let chars = 0;
  const excerpts: Excerpt[] = [];
  for (const e of ordered) {
    if (excerpts.length >= config.maxExcerpts || chars + e.text.length > config.maxExcerptChars) {
      capNote = `Too many matching passages; only the first ${excerpts.length} were used.`;
      break;
    }
    excerpts.push(e); chars += e.text.length;
  }

  const coverage: Coverage[] = docs.map((d) => {
    const mine = results.filter((r) => r.docId === d.id);
    const failed = mine.filter((r) => !r.ok).map((r) => r.chunkIndex);
    const totalChunks = byDoc.get(d.id)!.length;
    const readOk = mine.length - failed.length;
    const targeted = mine.length < totalChunks; // we chose not to read everything
    return {
      docId: d.id,
      totalChunks,
      readChunks: readOk,
      failedChunks: failed,
      complete: readOk === totalChunks && !capNote,
      targeted: targeted || undefined,
      capped: !!capNote || undefined,
      note: [targeted ? "most relevant to the question" : "", capNote ?? ""].filter(Boolean).join("; ") || undefined,
    };
  });
  return { excerpts, coverage };
}

export function coverageStatement(cov: Coverage[], names: Record<string, string>) {
  if (cov.every((c) => c.complete)) {
    return `COVERAGE: COMPLETE. Every section of every document was read (${cov.map((c) => `${names[c.docId]}: ${c.totalChunks} sections`).join("; ")}).`;
  }
  const hard = cov.filter((c) => !c.complete && ((c.failedChunks?.length ?? 0) > 0 || c.capped));
  if (!hard.length) {
    return `COVERAGE: TARGETED. Only the sections most relevant to the question were read (${cov.map((c) => `${names[c.docId]}: ${c.readChunks} of ${c.totalChunks}`).join("; ")}). The rest was not read.`;
  }
  const bits = hard.map((c) => `${names[c.docId]}: read ${c.readChunks} of ${c.totalChunks} sections${c.note ? ` (${c.note})` : ""}`);
  return `COVERAGE: INCOMPLETE. ${bits.join("; ")}.`;
}
