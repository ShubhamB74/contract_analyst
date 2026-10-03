"use client";
import { use, useEffect, useMemo, useState } from "react";
import { ChangeCard, SIG_STYLE } from "@/components/ChangeCard";
import { RANK } from "@/lib/diff";
import type { ChangeKind, ComparisonView, Significance } from "@/lib/compare-types";

const SIGS: Significance[] = ["high", "medium", "low", "cosmetic"];
const KINDS: ChangeKind[] = ["modified", "added", "removed"];

export default function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [view, setView] = useState<ComparisonView | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [sigs, setSigs] = useState<Set<Significance>>(new Set(SIGS));
  const [kinds, setKinds] = useState<Set<ChangeKind>>(new Set(KINDS));
  const [sort, setSort] = useState<"significance" | "document">("significance");

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/comparisons/${id}`);
      if (!r.ok) { setMissing((await r.json()).error ?? "Comparison not found."); return; }
      const v = (await r.json()) as ComparisonView;
      if (stop) return;
      setView(v);
      if (v.status === "running") setTimeout(tick, 1500);
    };
    tick();
    return () => { stop = true; };
  }, [id]);

  const changes = view?.result?.changes ?? [];
  const counts = useMemo(() => Object.fromEntries(SIGS.map((s) => [s, changes.filter((c) => c.significance === s).length])) as Record<Significance, number>, [changes]);
  const shown = useMemo(() => {
    const list = changes.filter((c) => sigs.has(c.significance) && kinds.has(c.kind));
    return sort === "significance" ? [...list].sort((a, b) => RANK[b.significance] - RANK[a.significance]) : list;
  }, [changes, sigs, kinds, sort]);

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); apply(n); };

  if (missing) return <main className="mx-auto max-w-xl p-10"><p role="alert">{missing}</p><a className="mt-3 inline-block underline" href="/">Back to library</a></main>;
  if (!view) return <main className="p-10 text-mute" role="status">Loading…</main>;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16 pt-8">
      <a href="/" className="text-sm text-mute hover:text-ink">← Library</a>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Version comparison</h1>
      <p className="mt-1 text-mute">
        <span className="font-medium text-ink">{view.docA.name}</span> (older) → <span className="font-medium text-ink">{view.docB.name}</span> (newer)
      </p>

      {view.status === "running" && (
        <div className="mt-8 rounded-lg border border-line bg-white p-6" role="status" aria-live="polite">
          <p className="font-medium">Comparing documents…</p>
          <p className="mt-1 text-sm text-mute">{view.progress ?? "Working…"}</p>
          <div className="mt-4 h-1.5 overflow-hidden rounded bg-line"><div className="h-full w-1/3 animate-pulse rounded bg-accent" /></div>
        </div>
      )}

      {view.status === "failed" && (
        <p role="alert" className="mt-8 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          The comparison failed. {view.error}
        </p>
      )}

      {view.status === "done" && view.result && (
        <>
          <section className="mt-6 rounded-lg border border-line bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-mute">What changed</h2>
            <p className="mt-2 text-[15px] leading-7">{view.result.overview}</p>
            <p className="mt-3 text-sm text-mute">
              {changes.length} clause{changes.length === 1 ? "" : "s"} changed, {view.result.unchanged} identical
              {view.result.renumbered > 0 && ` (${view.result.renumbered} renumbered only)`}.
            </p>
            {view.result.aiError && (
              <p role="note" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                AI summaries were unavailable or incomplete ({view.result.aiError}). Rule-based summaries are shown where needed. Figures and wording differences are still exact.
              </p>
            )}
          </section>

          {changes.length === 0 ? (
            <p className="mt-8 text-center text-mute">No clause-level differences were found.</p>
          ) : (
            <>
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                <fieldset className="flex flex-wrap items-center gap-2">
                  <legend className="sr-only">Filter by significance</legend>
                  {SIGS.map((s) => (
                    <label key={s} className={`cursor-pointer rounded-full border px-3 py-1 ${sigs.has(s) ? SIG_STYLE[s].badge + " font-medium" : "border-line text-mute line-through"}`}>
                      <input type="checkbox" className="sr-only" checked={sigs.has(s)} onChange={() => toggle(sigs, s, setSigs)} />
                      {SIG_STYLE[s].label} {counts[s]}
                    </label>
                  ))}
                </fieldset>
                <fieldset className="flex items-center gap-2">
                  <legend className="sr-only">Filter by type</legend>
                  {KINDS.map((k) => (
                    <label key={k} className={`cursor-pointer rounded-full border px-3 py-1 capitalize ${kinds.has(k) ? "border-ink text-ink" : "border-line text-mute line-through"}`}>
                      <input type="checkbox" className="sr-only" checked={kinds.has(k)} onChange={() => toggle(kinds, k, setKinds)} />
                      {k}
                    </label>
                  ))}
                </fieldset>
                <label className="ml-auto flex items-center gap-2 text-mute">
                  Sort
                  <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="rounded-md border border-line bg-white px-2 py-1 text-ink">
                    <option value="significance">Most significant first</option>
                    <option value="document">Document order</option>
                  </select>
                </label>
              </div>

              <div className="mt-4 space-y-3" aria-live="polite">
                {shown.length === 0
                  ? <p className="py-10 text-center text-mute">No changes match these filters.</p>
                  : shown.map((c) => <ChangeCard key={c.id} c={c} />)}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
