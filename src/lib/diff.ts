/**
 * Clause alignment + deterministic change signals. No model calls here.
 */
import { canonicalize } from "./quotes";
import type { Clause } from "./clauses";
import type { Change, DiffOp, Significance } from "./compare-types";

// ── similarity ─────────────────────────────────────────────────────────────────
const words = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.,%'’-]*/gu) ?? []).map((w) => w.replace(/[.,'’-]+$/, ""));

function dice(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const m = new Map<string, number>();
  for (const x of a) m.set(x, (m.get(x) ?? 0) + 1);
  let hit = 0;
  for (const y of b) { const c = m.get(y); if (c) { hit++; m.set(y, c - 1); } }
  return (2 * hit) / (a.length + b.length);
}
const bigrams = (w: string[]) => w.slice(1).map((x, i) => `${w[i]} ${x}`);

/** Blend of word and word-pair overlap: tolerant of rewording, still sensitive to real rewrites. */
export function similarity(a: string, b: string) {
  const wa = words(a), wb = words(b);
  return 0.5 * dice(wa, wb) + 0.5 * dice(bigrams(wa), bigrams(wb));
}

// ── alignment ──────────────────────────────────────────────────────────────────
export type Pair = { a?: Clause; b?: Clause; kind: "unchanged" | "modified" | "added" | "removed"; similarity: number; renumbered: boolean };

const MATCH_THRESHOLD = 0.4;
const norm = (s: string) => canonicalize(s).canon;
const sameHeading = (x: Clause, y: Clause) => !!x.heading && !!y.heading && norm(x.heading) === norm(y.heading);

export function alignClauses(A: Clause[], B: Clause[]): Pair[] {
  const pairs: Pair[] = [];
  const usedA = new Set<number>(), usedB = new Set<number>();

  // 1) identical wording (survives renumbering and moves)
  const byText = new Map<string, number[]>();
  B.forEach((c, j) => { const k = norm(c.text); byText.set(k, [...(byText.get(k) ?? []), j]); });
  for (const a of A) {
    const cands = (byText.get(norm(a.text)) ?? []).filter((j) => !usedB.has(j));
    if (!cands.length) continue;
    const j = cands.find((x) => B[x].number === a.number) ?? cands[0];
    usedA.add(a.index); usedB.add(j);
    pairs.push({ a, b: B[j], kind: "unchanged", similarity: 1, renumbered: a.number !== B[j].number });
  }

  // 2) best-scoring similar pairs among the rest
  const scored: { i: number; j: number; s: number; raw: number }[] = [];
  for (const a of A) {
    if (usedA.has(a.index)) continue;
    for (const b of B) {
      if (usedB.has(b.index)) continue;
      const raw = similarity(a.text, b.text);
      const s = raw + (a.number && a.number === b.number ? 0.08 : 0) + (sameHeading(a, b) ? 0.12 : 0);
      if (s >= MATCH_THRESHOLD) scored.push({ i: a.index, j: b.index, s, raw });
    }
  }
  scored.sort((x, y) => y.s - x.s);
  for (const c of scored) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i); usedB.add(c.j);
    pairs.push({ a: A[c.i], b: B[c.j], kind: "modified", similarity: c.raw, renumbered: A[c.i].number !== B[c.j].number });
  }

  // 3) leftovers
  for (const a of A) if (!usedA.has(a.index)) pairs.push({ a, kind: "removed", similarity: 0, renumbered: false });
  for (const b of B) if (!usedB.has(b.index)) pairs.push({ b, kind: "added", similarity: 0, renumbered: false });

  // Order by position in the NEW document; removed clauses sit after their nearest surviving predecessor.
  const aToB = new Map<number, number>();
  pairs.forEach((p) => { if (p.a && p.b) aToB.set(p.a.index, p.b.index); });
  const key = (p: Pair) => {
    if (p.b) return p.b.index;
    let k = -1;
    for (let i = p.a!.index - 1; i >= 0; i--) { const m = aToB.get(i); if (m !== undefined) { k = m; break; } }
    return k + 0.5 + p.a!.index / 1e6;
  };
  return pairs.sort((x, y) => key(x) - key(y));
}

// ── word-level diff (for display only) ─────────────────────────────────────────
export function wordDiff(a: string, b: string, maxTokens = 2000): DiffOp[] | null {
  const tok = (s: string) => s.replace(/\s+/g, " ").trim().match(/\S+\s*/g) ?? [];
  const ta = tok(a), tb = tok(b);
  const key = (t: string) => t.trim();
  let lo = 0;
  while (lo < ta.length && lo < tb.length && key(ta[lo]) === key(tb[lo])) lo++;
  let ha = ta.length, hb = tb.length;
  while (ha > lo && hb > lo && key(ta[ha - 1]) === key(tb[hb - 1])) { ha--; hb--; }
  const x = ta.slice(lo, ha), y = tb.slice(lo, hb);
  if (x.length > maxTokens || y.length > maxTokens) return null;

  const n = x.length, m = y.length, w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] = key(x[i]) === key(y[j]) ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);

  const ops: DiffOp[] = [];
  const push = (t: DiffOp["t"], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.t === t) last.text += text; else ops.push({ t, text });
  };
  push("eq", ta.slice(0, lo).join(""));
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (key(x[i]) === key(y[j])) { push("eq", y[j]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) push("del", x[i++]);
    else push("ins", y[j++]);
  }
  while (i < n) push("del", x[i++]);
  while (j < m) push("ins", y[j++]);
  push("eq", ta.slice(ha).join(""));
  return ops.filter((o) => o.text);
}

// ── deterministic signals ──────────────────────────────────────────────────────
const NUMWORD: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", twelve: "12", thirty: "30", sixty: "60", ninety: "90" };
const UNIT = "(?:calendar |business |working )?(?:days?|weeks?|months?|years?|hours?)";
const FIGURE = new RegExp(
  [
    "(?:AED|USD|EUR|GBP|SAR|INR|Rs\\.?|\\$|€|£)\\s?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:million|billion|thousand|[mk]\\b))?",
    "\\d[\\d,]*(?:\\.\\d+)?\\s?(?:%|percent|per cent)",
    `\\d+(?:\\.\\d+)?\\s?${UNIT}`,
    `\\b(?:${Object.keys(NUMWORD).join("|")})\\s${UNIT}`,
    "\\b\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\b\\d{4,}\\b",
  ].join("|"),
  "gi"
);

const NUMRE = new RegExp(`\\b(${Object.keys(NUMWORD).join("|")})\\b`, "g");
/** Canonical form so "thirty days", "30 days" and "30 Days" compare equal. */
const figKey = (f: string) =>
  f.toLowerCase().replace(NUMRE, (w) => NUMWORD[w]).replace(/\s+/g, "").replace(/(day|week|month|year|hour)s\b/g, "$1");

export function figures(text: string): string[] {
  return (text.match(FIGURE) ?? []).map((f) => f.trim().replace(/\s+/g, " "));
}

/** Multiset difference of figures between two wordings. */
export function figureDelta(before: string, after: string) {
  const b = figures(before), a = figures(after);
  const left = new Map<string, number>();
  for (const f of b) left.set(figKey(f), (left.get(figKey(f)) ?? 0) + 1);
  const added: string[] = [];
  for (const f of a) {
    const k = figKey(f), c = left.get(k);
    if (c) left.set(k, c - 1); else added.push(f);
  }
  const removedKeys = new Map(left);
  const removed = b.filter((f) => { const c = removedKeys.get(figKey(f)); if (c) { removedKeys.set(figKey(f), c - 1); return true; } return false; });
  return { removed, added };
}

const CATEGORIES: [RegExp, string][] = [
  [/liabilit|consequential|gross negligence|cap\b/i, "Liability"],
  [/indemn/i, "Indemnity"],
  [/terminat|expir|renew/i, "Termination"],
  [/payment|invoice|fee|interest|price|charges/i, "Payment"],
  [/confiden|non-disclosure/i, "Confidentiality"],
  [/governing law|jurisdiction|arbitrat|dispute/i, "Governing law"],
  [/intellectual property|copyright|licen[cs]e/i, "IP"],
  [/compete|exclusiv|solicit/i, "Restrictive covenants"],
  [/warrant|represent/i, "Warranties"],
  [/insur/i, "Insurance"],
  [/data protection|personal data|privacy/i, "Data protection"],
  [/assign|subcontract|force majeure/i, "General"],
];
export const guessCategory = (text: string) => CATEGORIES.find(([re]) => re.test(text))?.[1] ?? "General";
export const isRisky = (text: string) => CATEGORIES.slice(0, 9).some(([re]) => re.test(text));

// ── significance rules (fallback + floors) ─────────────────────────────────────
export const RANK: Record<Significance, number> = { cosmetic: 0, low: 1, medium: 2, high: 3 };
const byRank = (r: number) => (["cosmetic", "low", "medium", "high"] as Significance[])[r];

export function heuristic(c: Pick<Change, "kind" | "before" | "after" | "figures">): { significance: Significance; summary: string } {
  const text = `${c.before ?? ""} ${c.after ?? ""}`;
  const risky = isRisky(text);
  const hasFig = c.figures.removed.length + c.figures.added.length > 0;
  if (c.kind === "added") return { significance: risky ? "high" : "medium", summary: "A new clause was added." };
  if (c.kind === "removed") return { significance: risky ? "high" : "medium", summary: "A clause was removed." };
  if (hasFig) {
    const was = c.figures.removed.join(", ") || "none", now = c.figures.added.join(", ") || "none";
    return { significance: risky ? "high" : "medium", summary: `Figures changed: ${was} became ${now}.` };
  }
  return { significance: "low", summary: "The wording changed; no figures changed. Review the text to judge whether the meaning differs." };
}

/** A model may not call a changed figure, or a whole clause appearing/disappearing, cosmetic. */
export function floorFor(c: Pick<Change, "kind" | "figures">): Significance | null {
  if (c.kind !== "modified") return "medium";
  if (c.figures.removed.length + c.figures.added.length) return "medium";
  return null;
}
export function applyFloor(sig: Significance, c: Pick<Change, "kind" | "figures">) {
  const f = floorFor(c);
  return f && RANK[sig] < RANK[f] ? { significance: byRank(RANK[f]), floored: true } : { significance: sig, floored: false };
}
