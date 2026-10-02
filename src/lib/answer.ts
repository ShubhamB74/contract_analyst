import { buildIndex, findQuote, type QuoteIndex } from "./quotes";
import type { VerifiedQuote } from "./types";

const QUOTE_TAG = /<quote\s+doc="([^"]*)">([\s\S]*?)<\/quote>/g;

export type DocForVerify = { id: string; text: string; pages: import("./types").PageSpan[] };

const indexCache = new Map<string, QuoteIndex>();
export function indexFor(d: DocForVerify) {
  let idx = indexCache.get(d.id);
  if (!idx) {
    idx = buildIndex(d.text, d.pages);
    indexCache.set(d.id, idx);
  }
  return idx;
}
export const invalidateIndex = (docId: string) => indexCache.delete(docId);

/**
 * Turns the raw model output (with <quote doc="ID">...</quote> tags) into display content
 * with [[q:N]] markers plus a verified-quotes list. Each quote is checked ONLY against the
 * document it claims to come from. Unknown doc id => unverified.
 */
export function processAnswer(raw: string, docs: DocForVerify[]) {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const quotes: VerifiedQuote[] = [];

  let content = raw.replace(QUOTE_TAG, (_m, docId: string, text: string) => {
    const id = quotes.length;
    const doc = byId.get(docId);
    if (!doc) {
      quotes.push({ id, docId, text: text.trim(), status: "unverified", matches: [], reason: "Cites an unknown document." });
    } else {
      const r = findQuote(indexFor(doc), text);
      quotes.push(
        r.status === "verified"
          ? { id, docId, text: text.trim(), status: "verified", matches: r.matches }
          : { id, docId, text: text.trim(), status: "unverified", matches: [], reason: r.reason }
      );
    }
    return `[[q:${id}]]`;
  });

  // If generation was stopped mid-tag, drop the dangling fragment instead of showing raw markup.
  content = content.replace(/<quote[^>]*>[\s\S]*$/, "").trimEnd();
  return { content, quotes };
}
