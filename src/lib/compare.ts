/**
 * PHASE 7: document comparison job.
 *
 *   split clauses -> align (deterministic) -> detect figures (deterministic)
 *   -> model explains + rates each change (batched) -> rules floor the ratings -> overview.
 *
 * If the model is unavailable the comparison still completes with rule-based summaries.
 */
import { getClient } from "./ai";
import { config } from "./config";
import { getDb } from "./db";
import { getDocumentFull } from "./repo";
import { pool } from "./pool";
import { COMPARE_SYSTEM, OVERVIEW_SYSTEM } from "./prompts";
import { clauseLabel, pageOf, splitClauses } from "./clauses";
import { alignClauses, applyFloor, figureDelta, guessCategory, heuristic, RANK, wordDiff } from "./diff";
import type { Change, ComparisonResult, Significance } from "./compare-types";
import type { PageSpan } from "./types";

const SIGS: Significance[] = ["high", "medium", "low", "cosmetic"];
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

type Side = { text: string; pages: PageSpan[] };

/** Deterministic part: everything except the model's summary and rating. */
export function buildChanges(older: Side, newer: Side) {
  const A = splitClauses(older.text), B = splitClauses(newer.text);
  const pairs = alignClauses(A, B);
  const changes: Change[] = [];
  let unchanged = 0, renumbered = 0;

  for (const p of pairs) {
    if (p.kind === "unchanged") { unchanged++; if (p.renumbered) renumbered++; continue; }
    const before = p.a ? collapse(p.a.text) : undefined;
    const after = p.b ? collapse(p.b.text) : undefined;
    const kind = p.kind as Change["kind"];
    const fig = figureDelta(before ?? "", after ?? "");
    const base = {
      id: `c${changes.length + 1}`,
      kind,
      number: (p.b ?? p.a)!.number,
      heading: (p.b ?? p.a)!.heading,
      before, after,
      pageBefore: p.a ? pageOf(older.pages, p.a.start) : undefined,
      pageAfter: p.b ? pageOf(newer.pages, p.b.start) : undefined,
      similarity: kind === "modified" ? p.similarity : undefined,
      figures: fig,
      renumbered: p.renumbered || undefined,
      diff: kind === "modified" ? wordDiff(before!, after!) : undefined,
    };
    const h = heuristic(base);
    changes.push({ ...base, ...h, category: guessCategory(`${before ?? ""} ${after ?? ""}`), source: "heuristic" });
  }
  return { changes, unchanged, renumbered };
}

export type ModelResult = { summary: string; significance: Significance; category: string };

export function parseClassification(raw: string, allowed: Set<string>): Map<string, ModelResult> {
  const out = new Map<string, ModelResult>();
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a === -1 || b <= a) return out;
  try {
    const arr = JSON.parse(raw.slice(a, b + 1)).results;
    if (!Array.isArray(arr)) return out;
    for (const r of arr) {
      if (!r || typeof r.id !== "string" || !allowed.has(r.id)) continue;           // invented ids are ignored
      if (!SIGS.includes(r.significance)) continue;
      if (typeof r.summary !== "string" || !r.summary.trim()) continue;
      out.set(r.id, {
        summary: r.summary.trim().slice(0, 500),
        significance: r.significance,
        category: typeof r.category === "string" && r.category.trim() ? r.category.trim().slice(0, 40) : "General",
      });
    }
  } catch { /* unparseable -> nothing classified; caller falls back */ }
  return out;
}

/** Merge model output into changes, then enforce the floors. */
export function applyClassification(changes: Change[], results: Map<string, ModelResult>) {
  for (const c of changes) {
    const r = results.get(c.id);
    if (r) { c.summary = r.summary; c.category = r.category; c.significance = r.significance; c.source = "model"; }
    const f = applyFloor(c.significance, c);
    c.significance = f.significance;
    if (f.floored) c.floored = true;
  }
}

const cut = (s?: string) => (s && s.length > 2500 ? s.slice(0, 2500) + " …[truncated]" : s ?? "");

export function classifyPrompt(batch: Change[]) {
  return batch.map((c) => {
    const label = clauseLabel(c);
    const fig = c.figures.removed.length + c.figures.added.length
      ? `\n<detected_figures removed="${c.figures.removed.join("; ")}" added="${c.figures.added.join("; ")}"/>` : "";
    return `<change id="${c.id}" kind="${c.kind}" clause="${label}">\n<before>${cut(c.before)}</before>\n<after>${cut(c.after)}</after>${fig}\n</change>`;
  }).join("\n\n");
}

function batches(changes: Change[], maxItems = 8, maxChars = 14_000) {
  const out: Change[][] = [];
  let cur: Change[] = [], size = 0;
  for (const c of changes) {
    const len = cut(c.before).length + cut(c.after).length;
    if (cur.length && (cur.length >= maxItems || size + len > maxChars)) { out.push(cur); cur = []; size = 0; }
    cur.push(c); size += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function classifyBatch(batch: Change[]): Promise<Map<string, ModelResult>> {
  const res = await getClient().chat.completions.create({
    model: config.ai.model, temperature: 0,
    messages: [{ role: "system", content: COMPARE_SYSTEM }, { role: "user", content: classifyPrompt(batch) }],
  });
  return parseClassification(res.choices[0]?.message?.content ?? "", new Set(batch.map((c) => c.id)));
}

export function fallbackOverview(nameA: string, nameB: string, changes: Change[], unchanged: number) {
  const n = (s: Significance) => changes.filter((c) => c.significance === s).length;
  const added = changes.filter((c) => c.kind === "added").length, removed = changes.filter((c) => c.kind === "removed").length;
  if (!changes.length) return `No substantive differences were found between ${nameA} and ${nameB}. ${unchanged} clauses are identical.`;
  const top = [...changes].sort((a, b) => RANK[b.significance] - RANK[a.significance]).slice(0, 3).map((c) => c.summary).join(" ");
  return `${changes.length} clauses differ between ${nameA} and ${nameB} (${n("high")} high, ${n("medium")} medium, ${n("low")} low, ${n("cosmetic")} cosmetic significance; ${added} added, ${removed} removed). ${top}`;
}

async function overview(nameA: string, nameB: string, changes: Change[], unchanged: number) {
  const top = [...changes].filter((c) => c.significance !== "cosmetic")
    .sort((a, b) => RANK[b.significance] - RANK[a.significance]).slice(0, 12);
  if (!top.length) return fallbackOverview(nameA, nameB, changes, unchanged);
  const list = top.map((c) => `- [${c.significance}] ${clauseLabel(c)} (${c.kind}): ${c.summary}`).join("\n");
  const res = await getClient().chat.completions.create({
    model: config.ai.model, temperature: 0,
    messages: [
      { role: "system", content: OVERVIEW_SYSTEM },
      { role: "user", content: `Older version: ${nameA}\nNewer version: ${nameB}\nTotal changed clauses: ${changes.length}\n\n${list}` },
    ],
  });
  return res.choices[0]?.message?.content?.trim() || fallbackOverview(nameA, nameB, changes, unchanged);
}

export async function runComparison(id: string) {
  const db = getDb();
  const progress = (p: string) => db.prepare("UPDATE comparisons SET progress=? WHERE id=?").run(p, id);
  try {
    const row = db.prepare("SELECT doc_a, doc_b FROM comparisons WHERE id=?").get(id) as { doc_a: string; doc_b: string };
    const a = getDocumentFull(row.doc_a), b = getDocumentFull(row.doc_b);
    if (!a || !b) throw new Error("One of the documents no longer exists.");

    progress("Splitting documents into clauses…");
    const { changes, unchanged, renumbered } = buildChanges(a, b);

    let aiError: string | undefined;
    if (changes.length) {
      const groups = batches(changes);
      let done = 0;
      progress(`Explaining changes… 0 of ${changes.length}`);
      const maps = await pool(groups, 3, async (g) => {
        let m = new Map<string, ModelResult>();
        for (let attempt = 0; attempt < 2 && m.size === 0; attempt++) {
          try { m = await classifyBatch(g); } catch (e) { aiError ??= (e as Error).message; }
        }
        done += g.length;
        progress(`Explaining changes… ${done} of ${changes.length}`);
        return m;
      });
      applyClassification(changes, new Map(maps.flatMap((m) => [...m])));
      if (!aiError && changes.some((c) => c.source === "heuristic")) aiError = "Some changes could not be summarised by the model; rule-based summaries are shown for them.";
    }

    progress("Writing overview…");
    let text: string;
    try { text = await overview(a.name, b.name, changes, unchanged); }
    catch (e) { aiError ??= (e as Error).message; text = fallbackOverview(a.name, b.name, changes, unchanged); }

    const result: ComparisonResult = { overview: text, aiError, unchanged, renumbered, changes };
    db.prepare("UPDATE comparisons SET status='done', progress=NULL, result_json=? WHERE id=?").run(JSON.stringify(result), id);
  } catch (e) {
    db.prepare("UPDATE comparisons SET status='failed', error=? WHERE id=?").run((e as Error).message, id);
  }
}
