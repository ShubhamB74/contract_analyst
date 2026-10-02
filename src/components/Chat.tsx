"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Coverage, StreamEvent, VerifiedQuote } from "@/lib/types";

type Props = {
  documentIds: string[];
  docNames: Record<string, string>;
  onCite: (q: VerifiedQuote, matchIndex: number) => void;
};

const stripTags = (s: string) => s.replace(/<quote[^>]*>/g, "“").replace(/<\/quote>/g, "”");

export function Chat({ documentIds, docNames, onCite }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const key = documentIds.join(",");

  useEffect(() => {
    fetch(`/api/chat?docs=${key}`).then((r) => r.json()).then(setMessages);
  }, [key]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streaming]);

  async function ask() {
    const question = draft.trim();
    if (!question || streaming !== null) return;
    setDraft(""); setError(null); setStreaming(""); setStatusText(null);
    setMessages((m) => [...m, { id: "tmp", role: "user", content: question, quotes: [], coverage: [], status: "complete", created_at: "" }]);

    abort.current = new AbortController();
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds, question }), signal: abort.current.signal,
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder(); let buf = ""; let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop()!;
        for (const l of lines.filter(Boolean)) {
          const ev = JSON.parse(l) as StreamEvent;
          if (ev.type === "status") setStatusText(ev.text);
          if (ev.type === "delta") { acc += ev.text; setStreaming(acc); setStatusText(null); }
          if (ev.type === "final") setMessages((m) => [...m, ev.message]);
          if (ev.type === "error") setError(ev.message);
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        // Server saves the partial answer; reload history to show what was kept.
        const r = await fetch(`/api/chat?docs=${key}`); setMessages(await r.json());
      } else setError("Connection lost. Try again.");
    } finally { setStreaming(null); setStatusText(null); abort.current = null; }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {messages.length === 0 && streaming === null && (
          <p className="text-mute">Ask something like “What is the liability cap?” or “How can either party terminate?”</p>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} docNames={docNames} onCite={onCite} showDoc={documentIds.length > 1} />)}
        {streaming !== null && (
          <div className="whitespace-pre-wrap text-[15px] leading-6">{stripTags(streaming) || <span className="text-mute" role="status">{statusText ?? "Reading the document…"}</span>}</div>
        )}
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div ref={bottom} />
      </div>
      <div className="flex gap-2 border-t border-line bg-white p-3">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="Ask about this contract…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
          className="flex-1 resize-none rounded-md border border-line px-3 py-2 text-sm" />
        {streaming !== null
          ? <button onClick={() => abort.current?.abort()} className="rounded-md border border-ink px-4 text-sm font-medium">Stop</button>
          : <button onClick={ask} disabled={!draft.trim()} className="rounded-md bg-ink px-4 text-sm font-medium text-white disabled:opacity-40">Ask</button>}
      </div>
    </div>
  );
}

function Bubble({ m, docNames, onCite, showDoc }: { m: ChatMessage; docNames: Record<string, string>; onCite: Props["onCite"]; showDoc: boolean }) {
  if (m.role === "user") return <div className="ml-auto max-w-[85%] rounded-lg bg-ink px-3 py-2 text-sm text-white">{m.content}</div>;
  const parts = m.content.split(/(\[\[q:\d+\]\])/g);
  return (
    <div className="text-[15px] leading-6">
      {parts.map((p, i) => {
        const mm = p.match(/^\[\[q:(\d+)\]\]$/);
        if (!mm) return <span key={i} className="whitespace-pre-wrap">{p}</span>;
        const q = m.quotes[Number(mm[1])];
        return q ? <QuoteChip key={i} q={q} docName={showDoc ? docNames[q.docId] : undefined} onCite={onCite} /> : null;
      })}
      <CoverageNote coverage={m.coverage} />
      {m.status === "stopped" && <p className="mt-1 text-xs text-mute">Stopped. Partial answer kept.</p>}
    </div>
  );
}

function QuoteChip({ q, docName, onCite }: { q: VerifiedQuote; docName?: string; onCite: Props["onCite"] }) {
  const ok = q.status === "verified";
  return (
    <blockquote className={`my-2 rounded-md border-l-4 bg-white px-3 py-2 font-serif text-[14px] ${ok ? "border-verified" : "border-unverified"}`}>
      <p>“{q.text}”</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs font-sans">
        <span className={ok ? "font-medium text-verified" : "font-medium text-unverified"}>{ok ? "Verified" : "Unverified"}</span>
        {docName && <span className="text-mute">{docName}</span>}
        {ok && q.matches[0]?.page && <span className="text-mute">p. {q.matches[0].page}</span>}
        {ok && q.matches.length > 1 && <span className="text-mute">{q.matches.length} occurrences</span>}
        {ok && <button className="text-accent underline" onClick={() => onCite(q, 0)}>Open in document</button>}
        {!ok && <span className="text-mute">{q.reason} This wording could not be found in the document.</span>}
      </div>
    </blockquote>
  );
}

function CoverageNote({ coverage }: { coverage: Coverage[] }) {
  const partial = coverage.filter((c) => !c.complete);
  if (partial.length) {
    return (
      <p role="note" className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Partial read. {partial.map((c) => `${c.readChunks} of ${c.totalChunks} sections were read${c.note ? ` (${c.note})` : ""}`).join("; ")}.
        Treat “not found” as “not found in the sections read”, not as proof a clause is absent.
      </p>
    );
  }
  const big = coverage.filter((c) => c.totalChunks > 1);
  if (!big.length) return null;
  return <p className="mt-2 text-xs text-mute">Read all {big.map((c) => c.totalChunks).join(" + ")} sections.</p>;
}
