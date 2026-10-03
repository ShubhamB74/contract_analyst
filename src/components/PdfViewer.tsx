"use client";
import "pdfjs-dist/web/pdf_viewer.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { planHighlight, type CiteTarget, type Seg } from "@/lib/highlight";

type PageState = {
  el: HTMLDivElement | null;
  rendered: boolean;
  rendering: boolean;
  divs?: HTMLElement[];
  strs?: string[];
  modified: number[];
};

const MAX_SPAN_PAGES = 4; // how many pages after the start page we search when a quote crosses a break

type Props = {
  docId: string;
  target: CiteTarget | null;
  onLocateFailed: () => void;
  onLoadError: () => void;
};

/**
 * Renders the ORIGINAL pdf (canvas + text layer, lazily per page) and highlights a quote by
 * wrapping the matching text-layer fragments in <mark>. Marks are re-applied whenever a page
 * is (re)rendered, so highlights survive scrolling away and back.
 */
export function PdfViewer({ docId, target, onLocateFailed, onLoadError }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const pdfjsRef = useRef<typeof import("pdfjs-dist") | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const pages = useRef(new Map<number, PageState>());
  const plan = useRef(new Map<number, Seg[]>());
  const strsCache = useRef(new Map<number, string[]>());
  const scale = useRef(1);
  const [numPages, setNumPages] = useState(0);
  const [size, setSize] = useState({ w: 600, h: 800 });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // ── load the document ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        pdfjsRef.current = pdfjs;
        const res = await fetch(`/api/documents/${docId}/file`);
        if (!res.ok) throw new Error("file");
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
        if (cancelled) return pdf.destroy();
        pdfRef.current = pdf;
        const p1 = await pdf.getPage(1);
        const base = p1.getViewport({ scale: 1 });
        const avail = (scroller.current?.clientWidth ?? 700) - 32;
        scale.current = Math.min(2, Math.max(0.5, avail / base.width));
        setSize({ w: base.width * scale.current, h: base.height * scale.current });
        setNumPages(pdf.numPages);
        setStatus("ready");
      } catch {
        if (!cancelled) { setStatus("error"); onLoadError(); }
      }
    })();
    return () => { cancelled = true; pdfRef.current?.destroy(); pdfRef.current = null; pages.current.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // ── highlight application ────────────────────────────────────────────────────
  const applyHighlight = useCallback((n: number) => {
    const st = pages.current.get(n);
    if (!st?.divs || !st.strs) return;
    for (const i of st.modified) if (st.divs[i]) st.divs[i].textContent = st.strs[i];
    st.modified = [];
    for (const seg of plan.current.get(n) ?? []) {
      const div = st.divs[seg.item], s = st.strs[seg.item];
      if (!div || s === undefined || div.textContent !== s) continue; // never touch a fragment we don't recognise
      const mark = document.createElement("mark");
      mark.className = "cite";
      mark.textContent = s.slice(seg.from, seg.to);
      div.textContent = "";
      if (seg.from > 0) div.append(s.slice(0, seg.from));
      div.append(mark);
      if (seg.to < s.length) div.append(s.slice(seg.to));
      st.modified.push(seg.item);
    }
  }, []);

  // ── page rendering ───────────────────────────────────────────────────────────
  const renderPage = useCallback(async (n: number) => {
    const st = pages.current.get(n);
    const pdf = pdfRef.current, pdfjs = pdfjsRef.current;
    if (!st?.el || !pdf || !pdfjs || st.rendered || st.rendering) return;
    st.rendering = true;
    try {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: scale.current });
      const wrap = st.el;
      wrap.style.width = `${viewport.width}px`;
      wrap.style.height = `${viewport.height}px`;
      wrap.style.setProperty("--scale-factor", String(scale.current));
      wrap.style.setProperty("--total-scale-factor", String(scale.current));
      wrap.replaceChildren();

      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      wrap.appendChild(canvas);

      const layer = document.createElement("div");
      layer.className = "textLayer";
      wrap.appendChild(layer);

      const textContent = await page.getTextContent();
      const task = page.render({ canvasContext: canvas.getContext("2d")!, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      const tl = new pdfjs.TextLayer({ textContentSource: textContent, container: layer, viewport });
      await Promise.all([task.promise, tl.render()]);

      st.divs = tl.textDivs;
      st.strs = tl.textContentItemsStr;
      st.modified = [];
      st.rendered = true;
      applyHighlight(n);
    } catch {
      /* a failed page just stays blank; scrolling re-triggers a render */
    } finally {
      st.rendering = false;
    }
  }, [applyHighlight]);

  const unrenderPage = useCallback((n: number) => {
    const st = pages.current.get(n);
    if (!st?.rendered || !st.el) return;
    st.el.replaceChildren();
    st.rendered = false; st.divs = undefined; st.strs = undefined; st.modified = [];
  }, []);

  // Lazy render/unrender based on visibility.
  useEffect(() => {
    if (status !== "ready" || !scroller.current) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        const n = Number((e.target as HTMLElement).dataset.page);
        e.isIntersecting ? renderPage(n) : unrenderPage(n);
      }),
      { root: scroller.current, rootMargin: "800px 0px" }
    );
    pages.current.forEach((st) => st.el && io.observe(st.el));
    return () => io.disconnect();
  }, [status, numPages, renderPage, unrenderPage]);

  // ── citation target ─────────────────────────────────────────────────────────
  const pageStrs = useCallback(async (n: number) => {
    const hit = strsCache.current.get(n);
    if (hit) return hit;
    const page = await pdfRef.current!.getPage(n);
    const tc = await page.getTextContent();
    const strs = tc.items.filter((i) => "str" in i).map((i) => (i as { str: string }).str); // same filter pdf.js TextLayer uses
    strsCache.current.set(n, strs);
    return strs;
  }, []);

  useEffect(() => {
    if (!target || status !== "ready") return;
    let cancelled = false;
    (async () => {
      const m = target.matches[target.index];
      const start = m?.page;
      if (!start) return onLocateFailed();
      const nth = target.matches.slice(0, target.index).filter((x) => x.page === start).length;
      const last = Math.min(numPages, start + MAX_SPAN_PAGES);
      const strs: string[][] = [];
      for (let p = start; p <= last; p++) strs.push(await pageStrs(p));
      if (cancelled) return;

      const result = planHighlight(strs, target.quote, nth);
      if (!result) return onLocateFailed();

      plan.current = new Map(result.plans.map((pl) => [start + pl.page, pl.segs]));
      pages.current.forEach((_, n) => applyHighlight(n)); // clears old marks, applies new ones to rendered pages

      const scroll = scroller.current!;
      const startEl = pages.current.get(start)?.el;
      if (startEl) scroll.scrollTo({ top: startEl.offsetTop - 16 });
      await Promise.all([...plan.current.keys()].map(renderPage));
      plan.current.forEach((_, n) => applyHighlight(n));
      if (cancelled) return;
      requestAnimationFrame(() => startEl?.querySelector("mark.cite")?.scrollIntoView({ block: "center", behavior: "smooth" }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.nonce, target?.index, status, numPages]);

  return (
    <div ref={scroller} className="relative h-full overflow-y-auto bg-[#E9ECF1] p-4">
      {status === "loading" && <p className="text-sm text-mute" role="status">Loading document…</p>}
      {status === "error" && <p className="text-sm text-red-700" role="alert">Couldn’t display the original file.</p>}
      <div className="mx-auto flex flex-col items-center gap-4">
        {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            data-page={n}
            aria-label={`Page ${n}`}
            ref={(el) => {
              const prev = pages.current.get(n);
              if (!prev) pages.current.set(n, { el, rendered: false, rendering: false, modified: [] });
              else prev.el = el;
            }}
            className="textLayerHost relative bg-white shadow-sm"
            style={{ width: size.w, height: size.h }}
          />
        ))}
      </div>
    </div>
  );
}
