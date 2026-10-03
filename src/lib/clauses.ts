/**
 * Splits extracted contract text into clauses. Numbered headings ("12.1 Termination",
 * "3. Liability", "Article 5", "Schedule 2") start a new clause; everything up to the next
 * heading belongs to it. Sub-items like (a), (b) stay with their parent.
 * Falls back to paragraphs when a document has no usable numbering.
 */
import type { PageSpan } from "./types";

export type Clause = { index: number; number: string | null; heading: string | null; text: string; start: number; end: number };

const NOISE = /^\s*(?:page\s+)?\d{1,4}(?:\s+of\s+\d{1,4})?\s*$/i; // bare page numbers / "Page 3 of 12"
const UPPER_START = /[A-Z(“"‘']/;

function startInfo(line: string): { number: string; heading: string | null } | null {
  // 12.1 The Supplier…   |   3. Liability   |   2) Payment
  let m = /^\s*(?:(?:article|section|clause)\s+)?(\d{1,3}(?:\.\d{1,3})+)\.?\s+\S/i.exec(line)
       ?? /^\s*(?:(?:article|section|clause)\s+)?(\d{1,3})[.)]\s+\S/i.exec(line);
  if (m) {
    // "2.5 million" or "30) …" wrapped mid-sentence must not start a clause: require an uppercase start.
    if (!UPPER_START.test(m[0].slice(-1))) return null;
    const rest = line.trim().replace(/^(?:(?:article|section|clause)\s+)?[\d.]+[.)]?\s+/i, "");
    return { number: m[1], heading: rest.length <= 70 && !/[.,;:]$/.test(rest) ? rest : null };
  }
  m = /^\s*(article|section|clause|schedule|annex|appendix|exhibit)\s+(\d{1,3}|[IVXLC]+|[A-Z])\b[\s.:–—-]*(.*)$/i.exec(line);
  if (m) {
    const rest = m[3].trim();
    return { number: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`, heading: rest && rest.length <= 70 ? rest : null };
  }
  return null;
}

type Line = { raw: string; start: number };

function build(groups: { number: string | null; heading: string | null; lines: Line[] }[]): Clause[] {
  return groups
    .filter((g) => g.lines.length)
    .map((g, index) => {
      const first = g.lines[0], last = g.lines[g.lines.length - 1];
      return {
        index,
        number: g.number,
        heading: g.heading,
        text: g.lines.map((l) => l.raw.trim()).join("\n"),
        start: first.start,
        end: last.start + last.raw.length,
      };
    });
}

function fallback(lines: Line[]): Clause[] {
  // paragraphs (blank-line separated) if they exist, else blocks of ~6 lines
  const groups: { number: null; heading: null; lines: Line[] }[] = [];
  const all = lines.filter((l) => !NOISE.test(l.raw));
  let cur: Line[] = [];
  const flush = () => { if (cur.length) groups.push({ number: null, heading: null, lines: cur }); cur = []; };
  const hasBlank = all.some((l) => !l.raw.trim());
  for (const l of all) {
    if (!l.raw.trim()) { if (hasBlank) flush(); continue; }
    cur.push(l);
    if (!hasBlank && cur.length >= 6) flush();
  }
  flush();
  return build(groups);
}

export function splitClauses(text: string): Clause[] {
  const lines: Line[] = [];
  let off = 0;
  for (const raw of text.split("\n")) { lines.push({ raw, start: off }); off += raw.length + 1; }

  const groups: { number: string | null; heading: string | null; lines: Line[] }[] = [{ number: null, heading: null, lines: [] }];
  for (const l of lines) {
    if (!l.raw.trim() || NOISE.test(l.raw)) continue;
    const s = startInfo(l.raw);
    if (s) groups.push({ number: s.number, heading: s.heading, lines: [l] });
    else groups[groups.length - 1].lines.push(l);
  }
  const numbered = groups.filter((g) => g.number).length;
  if (numbered < 3) return fallback(lines);
  return build(groups);
}

export function pageOf(pages: PageSpan[], offset: number): number | null {
  for (const p of pages) if (offset >= p.start && offset <= p.end) return p.page;
  return null;
}

export const clauseLabel = (c: { number: string | null; heading: string | null }) =>
  [c.number, c.heading].filter(Boolean).join(" ") || "Preamble";
