/**
 * QUOTE VERIFICATION (the most important module).
 *
 * Idea: compare in a "canonical" space where only letters/digits survive, lowercased
 * and NFKC-normalised. Whitespace, line breaks, hyphenation artefacts, smart quotes,
 * bullets and dash variants all disappear, so extraction noise can't cause false
 * rejections. A per-character map takes every canonical position back to its offset in
 * the ORIGINAL text, so we can highlight the real passage.
 *
 * We never use positions reported by the model. We locate the quote ourselves.
 *
 * Known failure modes (document these in the README):
 *  - Model silently changes a word/number -> correctly UNverified.
 *  - Quote with "[...]" or "..." inside joining two passages -> unverified (by design).
 *  - Very short quotes are ambiguous -> rejected below MIN_CANONICAL_CHARS.
 *  - Punctuation-only differences are ignored (e.g. "10,000" vs "10 000" match). Rare,
 *    but a numeric-change check is a good Phase 3 hardening step.
 *  - Text in images/scans isn't in the extracted text, so can't be verified.
 */
import type { PageSpan, QuoteMatch } from "./types";

const KEEP = /[\p{L}\p{N}]/u;
export const MIN_CANONICAL_CHARS = 12;

export type QuoteIndex = {
  canon: string;       // canonical text
  map: number[];       // canon position -> original text offset
  pages: PageSpan[];
  text: string;        // original text, used by the numeric guard
};

export function canonicalize(text: string): { canon: string; map: number[] } {
  let canon = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const norm = ch.normalize("NFKC").toLowerCase();
    for (const c of norm) {
      if (KEEP.test(c)) {
        for (let k = 0; k < c.length; k++) map.push(i);
        canon += c;
      }
    }
    i += ch.length;
  }
  return { canon, map };
}

export function buildIndex(text: string, pages: PageSpan[]): QuoteIndex {
  return { ...canonicalize(text), pages, text };
}

function pageAt(pages: PageSpan[], offset: number): number | null {
  for (const p of pages) if (offset >= p.start && offset < p.end) return p.page;
  return null;
}

/**
 * Numeric guard. Canonical matching ignores punctuation, so "10.5" and "105" (or "1.000" vs
 * "1,000") look identical. Compare the separator-bearing numbers literally.
 * Known limitation: a number split by extraction spaces ("100 000") is re-joined before comparing.
 */
const NUM = /\d[\d.,]*\d|\d/g;
const sepNumbers = (s: string) => (s.match(NUM) ?? []).filter((t) => /[.,]/.test(t));
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function numbersAgree(quote: string, passage: string): boolean {
  const q = sepNumbers(quote);
  return sameList(q, sepNumbers(passage)) || sameList(q, sepNumbers(passage.replace(/(?<=\d)\s+(?=\d)/g, "")));
}

export type FindResult =
  | { status: "verified"; matches: QuoteMatch[] }
  | { status: "unverified"; reason: string };

export function findQuote(index: QuoteIndex, quote: string): FindResult {
  const { canon: q } = canonicalize(quote);
  if (q.length < MIN_CANONICAL_CHARS) {
    return { status: "unverified", reason: "Quote too short to verify reliably." };
  }
  const matches: QuoteMatch[] = [];
  let numericRejected = false;
  let from = 0;
  while (true) {
    const pos = index.canon.indexOf(q, from);
    if (pos === -1) break;
    const start = index.map[pos];
    const end = index.map[pos + q.length - 1] + 1;
    if (numbersAgree(quote, index.text.slice(start, end))) {
      matches.push({ start, end, page: pageAt(index.pages, start) });
    } else numericRejected = true;
    from = pos + 1;
  }
  if (!matches.length && numericRejected) {
    return { status: "unverified", reason: "Wording matches but the numbers differ from the document." };
  }
  if (!matches.length) {
    return { status: "unverified", reason: "Not found in the document text." };
  }
  return { status: "verified", matches };
}
