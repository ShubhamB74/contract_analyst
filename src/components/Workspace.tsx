"use client";
import { useEffect, useMemo, useState } from "react";
import { Chat } from "./Chat";
import { DocumentPane } from "./DocumentPane";
import { uniqueLabels } from "@/lib/labels";
import type { CiteTarget } from "@/lib/highlight";
import type { VerifiedQuote } from "@/lib/types";

type Doc = { id: string; name: string; mime: string; text: string; status: string };
const MAX_DOCS = 6;

/** Chat + document pane for one or several documents. Used by /documents/[id] and /ask. */
export function Workspace({ docIds }: { docIds: string[] }) {
  const key = docIds.join(",");
  const ids = useMemo(() => [...new Set(docIds)].slice(0, MAX_DOCS), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<CiteTarget | null>(null);
  const [activeId, setActiveId] = useState(ids[0]);
  const [paneOpen, setPaneOpen] = useState(false); // small screens: pane is an overlay

  useEffect(() => {
    if (!ids.length) return;
    setDocs(null); setError(null); setTarget(null); setActiveId(ids[0]);
    Promise.all(ids.map(async (id) => {
      const r = await fetch(`/api/documents/${id}`);
      if (!r.ok) throw new Error("One of the selected documents no longer exists. It may have been deleted.");
      const d = (await r.json()) as Doc;
      if (d.status !== "ready") throw new Error(`“${d.name}” isn’t ready yet. Wait for processing to finish.`);
      return d;
    })).then(setDocs).catch((e: Error) => setError(e.message));
  }, [ids]);

  const labels = useMemo(() => (docs ? uniqueLabels(docs) : {}), [docs]);

  if (!ids.length) return <Notice>Choose documents from the library first.</Notice>;
  if (error) return <Notice>{error}</Notice>;
  if (!docs) return <main className="p-10 text-mute" role="status">Loading…</main>;

  const multi = docs.length > 1;
  const active = docs.find((d) => d.id === activeId) ?? docs[0];

  const cite = (q: VerifiedQuote, i: number) => {
    if (docs.some((d) => d.id === q.docId)) setActiveId(q.docId); // jump to the quote's own document
    setTarget({ docId: q.docId, quote: q.text, matches: q.matches, index: i, nonce: Date.now() });
    setPaneOpen(true);
  };

  return (
    <div className="mx-auto grid h-[calc(100vh-3.5rem)] max-w-[1500px] grid-cols-1 lg:grid-cols-2">
      <section className="flex min-h-0 flex-col border-r border-line">
        <div className="border-b border-line bg-white px-4 py-2 text-sm font-medium">
          {multi ? `Asking across ${docs.length} documents` : docs[0].name}
        </div>
        <div className="min-h-0 flex-1"><Chat documentIds={ids} docNames={labels} onCite={cite} /></div>
      </section>

      <section className={`min-h-0 ${paneOpen ? "fixed inset-0 z-20 flex flex-col bg-white lg:static" : "hidden flex-col lg:flex"}`}>
        {multi && (
          <div role="tablist" aria-label="Documents" className="flex gap-1 overflow-x-auto border-b border-line bg-paper px-2 py-1.5">
            {docs.map((d) => (
              <button key={d.id} role="tab" aria-selected={d.id === active.id} onClick={() => setActiveId(d.id)}
                className={`max-w-[16rem] shrink-0 truncate rounded px-2.5 py-1 text-sm ${d.id === active.id ? "bg-white font-medium shadow-sm" : "text-mute hover:text-ink"}`}>
                {labels[d.id]}
              </button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <DocumentPane
            key={active.id}
            doc={active}
            target={target && target.docId === active.id ? target : null}
            onTargetIndex={(i) => setTarget((t) => (t ? { ...t, index: i, nonce: Date.now() } : t))}
            onClose={() => setPaneOpen(false)}
          />
        </div>
      </section>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-xl p-10"><p role="alert">{children}</p><a className="mt-3 inline-block underline" href="/">Back to library</a></main>;
}
