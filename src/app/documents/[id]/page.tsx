"use client";
import { use, useEffect, useState } from "react";
import { Chat } from "@/components/Chat";
import { DocViewer, type Highlight } from "@/components/DocViewer";
import type { VerifiedQuote } from "@/lib/types";

type Doc = { id: string; name: string; text: string; status: string };

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);
  const [hl, setHl] = useState<Highlight>(null);

  useEffect(() => {
    fetch(`/api/documents/${id}`).then(async (r) => (r.ok ? setDoc(await r.json()) : setMissing(true)));
  }, [id]);

  if (missing) return <main className="p-10">Document not found. <a className="underline" href="/">Back to library</a></main>;
  if (!doc) return <main className="p-10 text-mute">Loading…</main>;

  return (
    <div className="mx-auto grid h-[calc(100vh-3.5rem)] max-w-[1400px] grid-cols-1 lg:grid-cols-2">
      <section className="flex min-h-0 flex-col border-r border-line">
        <div className="border-b border-line bg-white px-4 py-2 text-sm font-medium">{doc.name}</div>
        <div className="min-h-0 flex-1"><Chat documentIds={[id]} docNames={{ [id]: doc.name }} onCite={(q: VerifiedQuote, i) => setHl(q.matches[i])} /></div>
      </section>
      <section className="hidden min-h-0 lg:block"><DocViewer text={doc.text} highlight={hl} /></section>
    </div>
  );
}
