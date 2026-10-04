"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentRow } from "@/lib/types";

export default function Library() {
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]); // in click order
  const [swap, setSwap] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [aiOk, setAiOk] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/documents");
    const list = (await r.json()) as DocumentRow[];
    setDocs(list);
    setSelected((s) => s.filter((id) => list.some((d) => d.id === id && d.status === "ready")));
  }, []);

  useEffect(() => { load(); fetch("/api/health").then((r) => r.json()).then((h) => setAiOk(h.aiConfigured)).catch(() => {}); }, [load]);
  // Poll while anything is processing so status is never a mystery.
  useEffect(() => {
    if (!docs?.some((d) => d.status === "processing")) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [docs, load]);

  async function upload(file: File) {
    setError(null); setUploading(true);
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch("/api/documents", { method: "POST", body: fd });
    setUploading(false);
    if (!r.ok) setError((await r.json()).error ?? "Upload failed.");
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this document and its chat history?")) return;
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    load();
  }

  // Exactly two selected: older = earlier upload (swappable), newer = the other.
  const pair = (() => {
    if (selected.length !== 2 || !docs) return null;
    const d = selected.map((id) => docs.find((x) => x.id === id)).filter(Boolean) as DocumentRow[];
    if (d.length !== 2) return null;
    d.sort((x, y) => x.created_at.localeCompare(y.created_at));
    return swap ? [d[1], d[0]] : d;
  })();

  async function compare() {
    if (!pair) return;
    setError(null); setComparing(true);
    const r = await fetch("/api/comparisons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ olderId: pair[0].id, newerId: pair[1].id }) });
    const body = await r.json();
    if (!r.ok) { setComparing(false); setError(body.error ?? "Could not start the comparison."); return; }
    window.location.href = `/compare/${body.id}`;
  }

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const MAX = 6;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-28 pt-10">
      {!aiOk && (
        <p role="note" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No AI key is configured on the server, so chat answers are unavailable. Uploads, viewing and comparison (rule-based) still work. Set <code>AI_API_KEY</code> and restart.
        </p>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">Your contracts</h1>
      <p className="mt-1 text-mute">Upload a PDF or Word contract, then ask questions. Answers cite the exact text.</p>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
        className="mt-6 flex flex-col items-center rounded-lg border border-dashed border-line bg-white px-6 py-10 text-center"
      >
        <p className="font-medium">{uploading ? "Uploading…" : "Drop a contract here"}</p>
        <p className="mt-1 text-sm text-mute">PDF or DOCX, up to 25 MB</p>
        <button onClick={() => input.current?.click()} disabled={uploading}
          className="mt-4 rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Choose file
        </button>
        <input ref={input} type="file" hidden accept=".pdf,.docx"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      </div>
      {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <section className="mt-8">
        {docs === null ? <p className="text-mute">Loading…</p>
         : docs.length === 0 ? <p className="text-mute">No documents yet. Upload one to get started.</p>
         : (
          <>
            {docs.filter((d) => d.status === "ready").length > 1 && (
              <p className="mb-2 text-sm text-mute">Tick two or more documents to ask one question across them.</p>
            )}
            <ul className="divide-y divide-line rounded-lg border border-line bg-white">
              {docs.map((d) => {
                const ready = d.status === "ready";
                const checked = selected.includes(d.id);
                return (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <input type="checkbox" aria-label={`Select ${d.name}`} disabled={!ready || (!checked && selected.length >= MAX)}
                      checked={checked} onChange={() => toggle(d.id)} className="h-4 w-4 accent-[#2B4C9B]" />
                    <div className="min-w-0 flex-1">
                      {ready
                        ? <a href={`/documents/${d.id}`} className="block truncate font-medium hover:underline">{d.name}</a>
                        : <span className="block truncate font-medium">{d.name}</span>}
                      <p className="text-sm text-mute">
                        {d.status === "processing" && "Extracting text…"}
                        {ready && `${d.page_count} page${d.page_count === 1 ? "" : "s"}, ${(d.char_count! / 1000).toFixed(0)}k characters`}
                        {d.status === "failed" && <span className="text-red-700">{d.error}</span>}
                      </p>
                    </div>
                    <button onClick={() => remove(d.id)} className="text-sm text-mute hover:text-red-700">Delete</button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <p className="text-sm">
              {selected.length} selected
              {selected.length >= MAX && <span className="text-mute"> (maximum {MAX})</span>}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {pair && (
                <>
                  <span className="hidden text-sm text-mute md:inline">
                    Older: <span className="text-ink">{pair[0].name}</span> → Newer: <span className="text-ink">{pair[1].name}</span>
                  </span>
                  <button onClick={() => setSwap((v) => !v)} className="text-sm text-accent underline">Swap</button>
                  <button onClick={compare} disabled={comparing}
                    className="rounded-md border border-ink px-4 py-2 text-sm font-medium disabled:opacity-50">
                    {comparing ? "Starting…" : "Compare versions"}
                  </button>
                </>
              )}
              <button onClick={() => setSelected([])} className="text-sm text-mute hover:text-ink">Clear</button>
              <a href={selected.length >= 2 ? `/ask?docs=${selected.join(",")}` : undefined} aria-disabled={selected.length < 2}
                className={`rounded-md px-4 py-2 text-sm font-medium ${selected.length >= 2 ? "bg-ink text-white" : "pointer-events-none bg-line text-mute"}`}>
                Ask across {selected.length >= 2 ? selected.length : "2+"} documents
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
