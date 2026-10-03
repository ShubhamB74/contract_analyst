"use client";
import type { Change, Significance } from "@/lib/compare-types";
import { clauseLabel } from "@/lib/clauses";

export const SIG_STYLE: Record<Significance, { label: string; badge: string }> = {
  high: { label: "High", badge: "bg-red-50 text-red-800 border-red-200" },
  medium: { label: "Medium", badge: "bg-amber-50 text-amber-900 border-amber-200" },
  low: { label: "Low", badge: "bg-slate-100 text-slate-700 border-slate-200" },
  cosmetic: { label: "Cosmetic", badge: "bg-white text-mute border-line" },
};
const KIND: Record<Change["kind"], string> = { modified: "Modified", added: "Added", removed: "Removed" };

function pages(c: Change) {
  const b = c.pageBefore, a = c.pageAfter;
  if (b && a && b !== a) return `p. ${b} → p. ${a}`;
  const p = a ?? b;
  return p ? `p. ${p}` : null;
}

export function ChangeCard({ c }: { c: Change }) {
  const s = SIG_STYLE[c.significance];
  const hasFigures = c.figures.removed.length + c.figures.added.length > 0;
  return (
    <article className="rounded-lg border border-line bg-white p-4" aria-label={`${s.label} significance change: ${clauseLabel(c)}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded border px-2 py-0.5 font-medium ${s.badge}`}>{s.label}</span>
        <span className="rounded border border-line px-2 py-0.5 text-mute">{KIND[c.kind]}</span>
        <span className="text-mute">{c.category}</span>
        {pages(c) && <span className="text-mute">{pages(c)}</span>}
        {c.renumbered && <span className="text-mute">renumbered</span>}
      </div>

      <h3 className="mt-2 font-semibold">Clause {clauseLabel(c)}</h3>
      <p className="mt-1 text-[15px] leading-6">{c.summary}</p>

      {hasFigures && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-mute">Detected figures:</span>
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-800 line-through decoration-red-300">{c.figures.removed.join(", ") || "none"}</span>
          <span aria-hidden>→</span>
          <span className="rounded bg-green-50 px-1.5 py-0.5 font-medium text-green-800">{c.figures.added.join(", ") || "none"}</span>
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-mute">
        {c.source === "heuristic" && <span>Rule-based summary (AI summary unavailable for this change)</span>}
        {c.floored && <span>Rating raised: a figure or whole clause changed, so it can’t be cosmetic</span>}
      </div>

      <details className="mt-3 group">
        <summary className="cursor-pointer text-sm text-accent">Show wording</summary>
        <div className="mt-2 rounded-md bg-paper p-3 font-serif text-[14px] leading-6">
          {c.kind === "modified" && c.diff ? (
            <p>{c.diff.map((o, i) =>
              o.t === "del" ? <del key={i} className="bg-red-100 text-red-900">{o.text}</del>
              : o.t === "ins" ? <ins key={i} className="bg-green-100 text-green-900 no-underline">{o.text}</ins>
              : <span key={i}>{o.text}</span>)}</p>
          ) : c.kind === "modified" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div><p className="mb-1 font-sans text-xs text-mute">Older</p><p>{c.before}</p></div>
              <div><p className="mb-1 font-sans text-xs text-mute">Newer</p><p>{c.after}</p></div>
            </div>
          ) : (
            <p>{c.kind === "added" ? c.after : c.before}</p>
          )}
        </div>
        {c.kind === "modified" && c.diff && <p className="mt-1 text-xs text-mute">Red: removed from the older version. Green: added in the newer version.</p>}
      </details>
    </article>
  );
}
