import type { PageSpan } from "./types";

export type Chunk = { index: number; start: number; end: number; pageFrom: number | null; pageTo: number | null; text: string };

/**
 * Phase 4: split on paragraph boundaries into ~maxChars windows with a small overlap so
 * clauses cut at a boundary still appear whole in one chunk.
 */
export function chunkText(text: string, pages: PageSpan[], maxChars = 12_000, overlap = 600): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const cut = text.lastIndexOf("\n\n", end);
      if (cut > start + maxChars * 0.5) end = cut;
    }
    const pg = (o: number) => pages.find((p) => o >= p.start && o <= p.end)?.page ?? null;
    chunks.push({ index: chunks.length, start, end, pageFrom: pg(start), pageTo: pg(end - 1), text: text.slice(start, end) });
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
