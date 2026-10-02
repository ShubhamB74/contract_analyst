# Build phases

Each phase ends in something demoable. Do them in order; don't start extras until Part C is done.

Legend: ✅ in the starter · 🟡 skeleton in the starter · ⬜ not started

## Phase 0: Foundation ✅
Next.js 15 + Tailwind, SQLite (better-sqlite3), OpenAI-compatible client driven by env vars, Dockerfile.
**Exit:** `npm run dev` runs; `npm test` passes.

## Phase 1: Upload, processing, library (Part A.1) ✅/🟡
Done: type validation (extension + magic bytes), PDF/DOCX extraction, scanned-PDF detection, status polling, list/open/delete.
Todo: drag-and-drop polish, upload progress for big files, empty/error states review, test with a real scanned PDF and a password-protected PDF.
**Exit:** every failure mode shows a specific message; nothing is saved as "ready" with empty text.

## Phase 2: Streaming chat (Part A.2) 🟡
Done: NDJSON streaming, Stop (aborts upstream, partial answer saved), history per document set.
Todo: markdown rendering, retry on error, "new chat" / clear history, conversation list, auto-scroll polish.
**Exit:** stop mid-answer, reload page, partial answer still there.

## Phase 3: Verified quotes (Part A.3) ✅/🟡
Done: canonical-space matching with offset map (`src/lib/quotes.ts`), per-document verification, unverified marking, unit tests.
Todo: numeric guard (a quote differing only in digits/currency must fail), fuzzy "near match" tier shown as unverified with a hint, "answer not in document" prompt tests, adversarial test set (paraphrases, merged passages).
**Exit:** 20+ test cases including hallucinated quotes; none slip through as verified.

## Phase 4: Large documents (Part A.4) ⬜ (`chunk.ts` + `Coverage` type exist)
Plan: map-reduce. (1) chunk by paragraphs (~12k chars, overlap). (2) Per chunk, ask the model for relevant quotes only (cheap model, parallel with a concurrency cap). (3) Merge + verify, then a final synthesis call over verified quotes. (4) Record `Coverage` (chunks read / total) per document.
**Rules:** if any chunk failed or was skipped, the answer must say so; never say "not found" unless coverage is complete. Show a "Read 12/12 sections" indicator.
**Exit:** 150-page PDF works; kill one chunk call on purpose and see the warning.

## Phase 5: Citation highlighting (Part B.5) ⬜ (`DocViewer` is a plain-text placeholder)
Plan: render pages with pdf.js (canvas + text layer). Build a char-offset → text-layer-span map, so an `{start,end}` range from `findQuote` becomes a set of DOM ranges. Handle quotes across line breaks, page boundaries (highlight both, scroll to first), and duplicates (next/prev occurrence buttons). DOCX: render with mammoth HTML (or docx-preview) and use the same offset mapping.
**Exit:** click quotes that wrap lines, cross a page, and repeat; all highlight correctly.

## Phase 6: Multi-document questions (Part B.6) 🟡 (schema + prompts + per-doc verification ready)
Todo: multi-select UI in the library, `/documents?ids=a,b` chat view, doc label on each quote, prompt tuned for comparison, viewer switches doc on citation click. Large docs: run Phase 4 per document.
**Exit:** "Compare termination rights" gives one comparative answer with quotes labelled per doc.

## Phase 7: Document comparison (Part B.7) ⬜
Plan: split both versions into clauses (numbering regex, heading detection, fall back to paragraphs). Align clauses (number match, then similarity). Classify: unchanged / modified / added / removed. For modified/added/removed, ask the model for a plain-language summary + significance (high/medium/low) with reasoning on numbers, parties, liability, dates. Table with sort/filter by significance.
**Exit:** reworded-only clause = low; cap AED 100k → 1M = high.

## Phase 8: Part C. Choose one ⬜
**Option 2 (agentic research), recommended:** tools `search_document`, `get_section`, `list_clauses`; loop capped by `config.maxAgentRounds`; stream `status` events ("Searching for termination provisions…"); validate tool names/args with a schema and return an error *to the model* instead of throwing; final answer still goes through `processAnswer`.
**Option 1 (tracked changes):** only choose if you're comfortable with OOXML. Work on `word/document.xml` directly: locate the target text across runs, split runs, wrap in `<w:del>`/`<w:ins>` with author/date, preserve `<w:rPr>`. Never regenerate the document.

## Phase 9: Polish, extras, delivery ⬜
README + screenshots, demo video, deploy (Railway/Fly with a volume at `DATA_DIR`), then extras in value order: clause extraction → export → semantic search → background jobs.
