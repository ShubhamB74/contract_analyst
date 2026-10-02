"use client";
import { useEffect, useRef } from "react";

export type Highlight = { start: number; end: number } | null;

/**
 * PHASE 1 viewer: plain extracted text with the cited range highlighted.
 * PHASE 5 replaces this with a rendered view (pdf.js text layer / docx-preview) and maps
 * the offsets onto the rendered DOM so quotes spanning lines/pages still highlight.
 */
export function DocViewer({ text, highlight }: { text: string; highlight: Highlight }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [highlight]);

  return (
    <div className="h-full overflow-y-auto whitespace-pre-wrap bg-white p-6 font-serif text-[15px] leading-7">
      {highlight ? (
        <>
          {text.slice(0, highlight.start)}
          <mark ref={ref} className="cite">{text.slice(highlight.start, highlight.end)}</mark>
          {text.slice(highlight.end)}
        </>
      ) : text}
    </div>
  );
}
