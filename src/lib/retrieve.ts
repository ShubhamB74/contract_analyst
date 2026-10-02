/**
 * PHASE 4: map step for documents too large for one request.
 *
 * 1. Split each doc into overlapping sections.
 * 2. Ask the model, per section, for verbatim passages relevant to the question.
 * 3. VERIFY every returned passage against the real document text (hallucinations are dropped).
 * 4. Track coverage. A section whose call failed twice is recorded as unread, so the final
 *    answer can never claim "not found" after a partial read.
 */
import { getClient } from "./ai";
import { config } from "./config";
import { chunkText } from "./chunk";
import { pool } from "./pool";
import { MAP_SYSTEM } from "./prompts";
import { findQuote } from "./quotes";
import { indexFor, type DocForVerify } from "./answer";
import type { Coverage } from "./types";

export type Excerpt = { docId: string; docName: string; page: number | null; start: number; text: string };
type Doc = DocForVerify & { name: string };

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

export async function gatherExcerpts(opts: {
  docs: Doc[];
  question: string;
  signal: AbortSignal;
  onStatus: (s: string) => void;
}): Promise<{ excerpts: Excerpt[]; coverage: Coverage[] }> {
  const { docs, question, signal, onStatus } = opts;
  const client = getClient();

  const jobs = docs.flatMap((doc) =>
    chunkText(doc.text, doc.pages, config.chunkChars, config.chunkOverlap).map((chunk) => ({ doc, chunk }))
  );
  let finished = 0;

  const results = await pool(jobs, config.mapConcurrency, async ({ doc, chunk }) => {
    let quotes: string[] | null = null;
    for (let attempt = 0; attempt < 2 && quotes === null; attempt++) {
      try {
        const res = await client.chat.completions.create(
          {
            model: config.ai.model,
            temperature: 0,
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
    onStatus(`Reading sections… ${++finished} of ${jobs.length}`);

    const found: Excerpt[] = [];
    for (const q of quotes ?? []) {
      const r = findQuote(indexFor(doc), q);
      if (r.status === "verified") {
        const m = r.matches[0];
        found.push({ docId: doc.id, docName: doc.name, page: m.page, start: m.start, text: doc.text.slice(m.start, m.end) });
      }
    }
    return { docId: doc.id, chunkIndex: chunk.index, ok: quotes !== null, found };
  });

  // De-duplicate (overlap can return the same passage twice), keep document order.
  const seen = new Set<string>();
  let excerpts = results
    .flatMap((r) => r.found)
    .filter((e) => !seen.has(`${e.docId}:${e.start}`) && seen.add(`${e.docId}:${e.start}`))
    .sort((a, b) => (a.docId === b.docId ? a.start - b.start : a.docId.localeCompare(b.docId)));

  let capNote: string | undefined;
  let chars = 0;
  const kept: Excerpt[] = [];
  for (const e of excerpts) {
    if (kept.length >= config.maxExcerpts || chars + e.text.length > config.maxExcerptChars) {
      capNote = `Too many matching passages; only the first ${kept.length} were used.`;
      break;
    }
    kept.push(e); chars += e.text.length;
  }
  excerpts = kept;

  const coverage: Coverage[] = docs.map((d) => {
    const mine = results.filter((r) => r.docId === d.id);
    const failed = mine.filter((r) => !r.ok).map((r) => r.chunkIndex);
    return {
      docId: d.id,
      totalChunks: mine.length,
      readChunks: mine.length - failed.length,
      failedChunks: failed,
      complete: failed.length === 0 && !capNote,
      note: capNote,
    };
  });
  return { excerpts, coverage };
}

export function coverageStatement(cov: Coverage[], names: Record<string, string>) {
  if (cov.every((c) => c.complete)) {
    return `COVERAGE: COMPLETE. Every section of every document was read (${cov.map((c) => `${names[c.docId]}: ${c.totalChunks} sections`).join("; ")}).`;
  }
  const bits = cov.filter((c) => !c.complete).map((c) =>
    `${names[c.docId]}: read ${c.readChunks} of ${c.totalChunks} sections${c.note ? ` (${c.note})` : ""}`
  );
  return `COVERAGE: INCOMPLETE. ${bits.join("; ")}.`;
}
