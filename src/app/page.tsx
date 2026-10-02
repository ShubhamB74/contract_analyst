"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentRow } from "@/lib/types";

export default function Library() {
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/documents");
    setDocs(await r.json());
  }, []);

  useEffect(() => { load(); }, [load]);
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

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
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
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  {d.status === "ready"
                    ? <a href={`/documents/${d.id}`} className="block truncate font-medium hover:underline">{d.name}</a>
                    : <span className="block truncate font-medium">{d.name}</span>}
                  <p className="text-sm text-mute">
                    {d.status === "processing" && "Extracting text…"}
                    {d.status === "ready" && `${d.page_count} page${d.page_count === 1 ? "" : "s"} · ${(d.char_count! / 1000).toFixed(0)}k characters`}
                    {d.status === "failed" && <span className="text-red-700">{d.error}</span>}
                  </p>
                </div>
                <button onClick={() => remove(d.id)} className="text-sm text-mute hover:text-red-700">Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
