/**
 * PHASE 5: map a verified quote onto *rendered* text.
 *
 * The rendered page (pdf.js text layer or DOCX HTML) is split into many small string
 * fragments ("items") whose boundaries bear no relation to the extracted text we verified
 * against. So we don't reuse server offsets. Instead we search again in the same canonical
 * space (letters/digits only) over the rendered fragments and convert the hit back to
 * (fragment, from, to) segments that a viewer can wrap in <mark>.
 *
 * Handles: quotes spanning many fragments/lines, quotes crossing page breaks, and repeated
 * quotes (via `nth`).
 */
import { canonicalize } from "./quotes";
import type { QuoteMatch } from "./types";

export type Seg = { item: number; from: number; to: number };
export type PagePlan = { page: number; segs: Seg[] }; // page = index into the pagesStrs argument
export type HighlightPlan = { plans: PagePlan[]; complete: boolean };

/** What the UI asks the viewer to show. `nonce` lets the same quote be re-opened. */
export type CiteTarget = { docId: string; quote: string; matches: QuoteMatch[]; index: number; nonce: number };

const MIN_OVERLAP = 8; // minimum characters needed to trust a cross-page split

type Prep = { strs: string[]; offsets: number[]; canon: string; map: number[] };

function prep(strs: string[]): Prep {
  const offsets: number[] = [];
  let n = 0;
  for (const s of strs) { offsets.push(n); n += s.length; }
  return { strs, offsets, ...canonicalize(strs.join("")) };
}

function nthIndexOf(hay: string, needle: string, nth: number): number {
  let pos = -1, from = 0;
  for (let k = 0; k <= nth; k++) {
    pos = hay.indexOf(needle, from);
    if (pos === -1) return -1;
    from = pos + 1;
  }
  return pos;
}

function segsFor(p: Prep, s: number, e: number): Seg[] {
  if (e <= s || s >= p.map.length) return [];
  const a = p.map[s];
  const b = p.map[e - 1] + 1;
  const segs: Seg[] = [];
  p.strs.forEach((str, i) => {
    const lo = p.offsets[i];
    const from = Math.max(a, lo), to = Math.min(b, lo + str.length);
    if (to > from) segs.push({ item: i, from: from - lo, to: to - lo });
  });
  return segs;
}

/**
 * pagesStrs[0] is the page the server says the quote STARTS on; later entries are the
 * following pages (only consulted if the quote doesn't fit on the first).
 * Returns null if the quote can't be found at all in the rendered text.
 */
export function planHighlight(pagesStrs: string[][], quote: string, nth = 0): HighlightPlan | null {
  const q = canonicalize(quote).canon;
  if (!q || !pagesStrs.length) return null;
  const pages = pagesStrs.map(prep);

  // 1) Whole quote on the first page (use the requested occurrence, else the first).
  const first = pages[0];
  let pos = nthIndexOf(first.canon, q, nth);
  if (pos === -1 && nth > 0) pos = nthIndexOf(first.canon, q, 0);
  if (pos !== -1) return { plans: [{ page: 0, segs: segsFor(first, pos, pos + q.length) }], complete: true };

  // 2) Crosses a page break: tail of page 1 == head of quote, remainder continues on next page(s).
  let k = Math.min(q.length - 1, first.canon.length);
  for (; k >= MIN_OVERLAP; k--) if (first.canon.endsWith(q.slice(0, k))) break;
  if (k < MIN_OVERLAP) return null;

  const plans: PagePlan[] = [{ page: 0, segs: segsFor(first, first.canon.length - k, first.canon.length) }];
  let rest = q.slice(k);
  for (let i = 1; i < pages.length && rest.length; i++) {
    const p = pages[i];
    if (p.canon.startsWith(rest)) {
      plans.push({ page: i, segs: segsFor(p, 0, rest.length) });
      return { plans, complete: true };
    }
    if (p.canon.length && rest.startsWith(p.canon)) {         // quote swallows the whole page
      plans.push({ page: i, segs: segsFor(p, 0, p.canon.length) });
      rest = rest.slice(p.canon.length);
      continue;
    }
    break; // e.g. a running header/footer sits between the two halves
  }
  // Partial: we located the start, not the end. Still useful, flagged as incomplete.
  return { plans, complete: !rest.length };
}
