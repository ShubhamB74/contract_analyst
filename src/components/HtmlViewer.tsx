"use client";
import { useEffect, useRef, useState } from "react";
import { planHighlight, type CiteTarget } from "@/lib/highlight";

/** DOCX viewer: server converts to HTML; quotes are located in the live DOM text nodes. */
export function HtmlViewer({ docId, target, onLocateFailed, onLoadError }: {
  docId: string; target: CiteTarget | null; onLocateFailed: () => void; onLoadError: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setReady(false); setLoading(true);
    fetch(`/api/documents/${docId}/html`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(({ html }) => {
        if (cancelled || !box.current) return;
        box.current.innerHTML = html;
        setReady(true); setLoading(false);
      })
      .catch(() => { if (!cancelled) { setLoading(false); onLoadError(); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  useEffect(() => {
    const root = box.current;
    if (!root || !ready) return;
    // clear previous highlights
    root.querySelectorAll("mark.cite").forEach((m) => m.replaceWith(document.createTextNode(m.textContent ?? "")));
    root.normalize();
    if (!target) return;

    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);

    const result = planHighlight([nodes.map((n) => n.data)], target.quote, target.index);
    if (!result) return onLocateFailed();

    let firstMark: HTMLElement | null = null;
    for (const seg of result.plans[0].segs) {
      const r = document.createRange();
      r.setStart(nodes[seg.item], seg.from);
      r.setEnd(nodes[seg.item], seg.to);
      const mark = document.createElement("mark");
      mark.className = "cite";
      r.surroundContents(mark);
      firstMark ??= mark;
    }
    firstMark?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [target?.nonce, target?.index, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full overflow-y-auto bg-white p-6">
      {loading && <p className="text-sm text-mute" role="status">Loading document…</p>}
      <div ref={box} className="docx-html mx-auto max-w-[70ch]" />
    </div>
  );
}
