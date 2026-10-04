/**
 * Lexical passage search (BM25) used by the agent's search_document tool.
 * Passages are slices of clauses, tagged with clause key, heading and page, so results can be
 * quoted verbatim and cited. Headings are up-weighted: a clause titled "Termination" should
 * outrank a clause that merely mentions the word.
 */
import { splitClauses, pageOf, type Clause } from "./clauses";
import { canonicalize } from "./quotes";
import type { PageSpan } from "./types";

export type SearchDoc = { id: string; text: string; pages: PageSpan[] };
export type Passage = { docId: string; clauseIndex: number; key: string; heading: string | null; page: number | null; text: string; tf: Map<string, number>; len: number; canon: string };

const STOP = new Set("a an the of to in on for and or by with is are be as at this that these those any all shall will may must can it its under per from if not no which who whom such other each either".split(" "));

export function stem(w: string) {
  const s = w.toLowerCase().replace(/ations?$/, "at").replace(/(ments?|ings?|ions?|ed|es|ly|s|e)$/, "");
  return s.length >= 3 ? s : w.toLowerCase();
}
const tokens = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOP.has(w) && w.length > 1).map(stem);

/** Contract vocabulary: a query for one word should also reach its usual neighbours (down-weighted). */
const EXPAND: Record<string, string[]> = {
  terminat: ["end", "cancel", "expir", "notic"], liabilit: ["liabl", "damag", "cap", "limit"], indemnif: ["indemn", "hold", "harmless"],
  pay: ["invoic", "fee", "price", "paid", "payabl"], confiden: ["disclos", "secret", "proprietary"], govern: ["law", "jurisdict", "court"],
  renew: ["extend", "extens", "term"], assign: ["transfer", "novat", "subcontract"], warrant: ["represent", "guarant"],
  dispute: ["arbitr", "court", "jurisdict"], compete: ["exclusiv", "solicit"], insur: ["coverag", "polic"],
};

// Make the table symmetric: "end" should reach "terminate" just as "terminate" reaches "end".
const SYN: Record<string, string[]> = {};
for (const [k, vs] of Object.entries(EXPAND)) {
  (SYN[k] ??= []).push(...vs);
  for (const v of vs) (SYN[v] ??= []).push(k);
}

export const clauseKey = (c: Clause) => c.number ?? `¶${c.index + 1}`;

const clauseCache = new Map<string, Clause[]>();
export function getClauses(d: SearchDoc): Clause[] {
  const k = `${d.id}:${d.text.length}`;
  let c = clauseCache.get(k);
  if (!c) { c = splitClauses(d.text); clauseCache.set(k, c); }
  return c;
}

function splitLong(text: string, max = 1200): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  const pieces = text.split("\n").flatMap((l) => (l.length > max ? l.split(/(?<=[.;])\s+/) : [l]));
  for (const p of pieces) {
    if (cur && cur.length + p.length > max) { out.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + p;
  }
  if (cur) out.push(cur);
  return out;
}

const passageCache = new Map<string, Passage[]>();
export function getPassages(d: SearchDoc): Passage[] {
  const k = `${d.id}:${d.text.length}`;
  const hit = passageCache.get(k);
  if (hit) return hit;
  const out: Passage[] = [];
  for (const c of getClauses(d)) {
    for (const piece of splitLong(c.text)) {
      const tf = new Map<string, number>();
      const add = (w: string, n = 1) => tf.set(w, (tf.get(w) ?? 0) + n);
      tokens(piece).forEach((w) => add(w));
      if (c.heading) tokens(c.heading).forEach((w) => add(w, 3));
      out.push({
        docId: d.id, clauseIndex: c.index, key: clauseKey(c), heading: c.heading, page: pageOf(d.pages, c.start),
        text: piece, tf, len: [...tf.values()].reduce((a, b) => a + b, 0), canon: canonicalize(piece).canon,
      });
    }
  }
  passageCache.set(k, out);
  return out;
}

export function queryTerms(query: string): Map<string, number> {
  const terms = new Map<string, number>();
  for (const t of tokens(query)) {
    terms.set(t, 1);
    for (const e of SYN[t] ?? []) if (!terms.has(e)) terms.set(e, 0.4);
  }
  return terms;
}

export function searchPassages(passages: Passage[], query: string, k = 5): { passage: Passage; score: number }[] {
  const terms = queryTerms(query);
  if (!terms.size || !passages.length) return [];
  const N = passages.length;
  const avg = passages.reduce((n, p) => n + p.len, 0) / N || 1;
  const df = new Map<string, number>();
  for (const t of terms.keys()) df.set(t, passages.reduce((n, p) => n + (p.tf.has(t) ? 1 : 0), 0));
  const phrase = canonicalize(query).canon;

  const scored = passages.map((p) => {
    let s = 0;
    for (const [t, w] of terms) {
      const f = p.tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
      s += w * idf * ((f * 2.2) / (f + 1.2 * (0.25 + (0.75 * p.len) / avg)));
    }
    if (s > 0 && phrase.length >= 8 && p.canon.includes(phrase)) s += 2; // exact phrase bonus
    return { passage: p, score: s };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}

/** BM25 relevance score of each text for a query (used to pick which sections of a big document to read first). */
export function rankTexts(texts: string[], query: string): number[] {
  const terms = queryTerms(query);
  const tfs = texts.map((t) => { const m = new Map<string, number>(); for (const w of tokens(t)) m.set(w, (m.get(w) ?? 0) + 1); return m; });
  const lens = tfs.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  const N = texts.length;
  const avg = lens.reduce((a, b) => a + b, 0) / Math.max(N, 1) || 1;
  const df = new Map<string, number>();
  for (const t of terms.keys()) df.set(t, tfs.filter((m) => m.has(t)).length);
  return tfs.map((m, i) => {
    let s = 0;
    for (const [t, w] of terms) {
      const f = m.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
      s += w * idf * ((f * 2.2) / (f + 1.2 * (0.25 + (0.75 * lens[i]) / avg)));
    }
    return s;
  });
}
