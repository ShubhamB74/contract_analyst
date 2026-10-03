"use client";
import { useEffect, useState } from "react";
import { DocViewer } from "./DocViewer";
import { HtmlViewer } from "./HtmlViewer";
import { PdfViewer } from "./PdfViewer";
import type { CiteTarget } from "@/lib/highlight";

type Doc = { id: string; name: string; mime: string; text: string };

/**
 * Right-hand pane: original document (PDF.js / DOCX HTML) with extracted-text fallback.
 * If a quote can't be placed in the rendered view, we say so and show it in the extracted text,
 * where the server-verified offsets are exact.
 */
export function DocumentPane({ doc, target, onTargetIndex, onClose }: {
  doc: Doc; target: CiteTarget | null; onTargetIndex: (i: number) => void; onClose: () => void;
}) {
  const [view, setView] = useState<"original" | "text">("original");
  const [notice, setNotice] = useState<string | null>(null);
  const isPdf = doc.mime === "application/pdf";

  // A new citation click goes back to the original view and clears old notices.
  useEffect(() => { if (target) { setView("original"); setNotice(null); } }, [target?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = target?.matches[target.index];
  const total = target?.matches.length ?? 0;

  const fallback = (msg: string) => { setView("text"); setNotice(msg); };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2 text-sm">
        <div role="tablist" className="flex rounded-md border border-line p-0.5">
          {(["original", "text"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`rounded px-2.5 py-1 ${view === v ? "bg-ink text-white" : "text-mute"}`}>
              {v === "original" ? "Original" : "Extracted text"}
            </button>
          ))}
        </div>
        {total > 1 && (
          <div className="ml-auto flex items-center gap-1 text-mute" aria-label="Occurrences of this quote">
            <button aria-label="Previous occurrence" disabled={target!.index === 0} onClick={() => onTargetIndex(target!.index - 1)} className="rounded px-2 py-1 hover:bg-paper disabled:opacity-30">‹</button>
            <span>Occurrence {target!.index + 1} of {total}</span>
            <button aria-label="Next occurrence" disabled={target!.index >= total - 1} onClick={() => onTargetIndex(target!.index + 1)} className="rounded px-2 py-1 hover:bg-paper disabled:opacity-30">›</button>
          </div>
        )}
        <button onClick={onClose} className={`${total > 1 ? "" : "ml-auto"} text-mute hover:text-ink lg:hidden`}>Close</button>
      </div>

      {notice && <p role="status" className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">{notice}</p>}

      <div className="min-h-0 flex-1">
        {/* Keep the original mounted (hidden) so switching tabs doesn't reload the file. */}
        <div className={view === "original" ? "h-full" : "hidden"}>
          {isPdf
            ? <PdfViewer docId={doc.id} target={target}
                onLocateFailed={() => fallback("Couldn’t place this quote on the rendered page, so it’s shown in the extracted text.")}
                onLoadError={() => fallback("Couldn’t display the original file. Showing the extracted text.")} />
            : <HtmlViewer docId={doc.id} target={target}
                onLocateFailed={() => fallback("Couldn’t place this quote in the document view, so it’s shown in the extracted text.")}
                onLoadError={() => fallback("Couldn’t display the original file. Showing the extracted text.")} />}
        </div>
        {view === "text" && <DocViewer text={doc.text} highlight={m ? { start: m.start, end: m.end } : null} />}
      </div>
    </div>
  );
}
