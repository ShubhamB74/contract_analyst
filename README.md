# Contract Analyst

Upload a contract (PDF or DOCX), ask questions about it, and get answers backed by quotes that **the server has verified exist in the document**. Click a quote to jump to it, highlighted, in the original file.

**Live demo:** _add your deployed URL_ · **Demo video:** _add link_

## Screenshots

| Upload & library | Chat with verified quotes |
|---|---|
| ![Upload](docs/screenshots/01-upload.png) | ![Chat](docs/screenshots/02-chat-verified.png) |
| **Citation highlighting** | **Version comparison** |
| ![Highlight](docs/screenshots/03-highlight.png) | ![Compare](docs/screenshots/04-compare.png) |

_(Capture these from the running app. See `docs/SUBMISSION_CHECKLIST.md`.)_

## What it does

- **Upload & library.** PDF and DOCX only (checked by extension *and* file signature). Status is shown while text is extracted. A scanned PDF with no text layer is rejected with an explanation instead of being saved empty. Documents can be opened and deleted.
- **Chat.** Answers stream in; **Stop** keeps whatever was written; history is saved per document set.
- **Verified quotes.** Every quote the model produces is checked by code against the document's text. Found: shown as *Verified*, with an "Open in document" action. Not found: shown as *Unverified*, never as genuine. If the document doesn't answer the question, the answer says so.
- **Large documents.** Documents too big for one request are read section by section, quotes are verified per section, and the answer carries a **coverage note**. If any part could not be read, the answer is marked partial and may not claim something is absent.
- **Citation highlighting.** The original PDF is rendered (pdf.js) and the quote is highlighted, including quotes that wrap across lines, cross a page break, or occur several times (prev/next occurrence). DOCX is rendered as HTML. If a quote can't be placed on the rendered page, the app says so and shows it in the extracted text instead.
- **Multi-document questions.** Select 2 to 6 documents, ask once, get a comparative answer. Each quote is verified against *its own* document and labelled with it.
- **Version comparison.** Clause-level (not character-level) alignment of an older and newer version. Added/removed/modified clauses, figures changed (found by code), a plain-language summary and a significance rating (high / medium / low / cosmetic) you can filter and sort.
- **Part C: agentic research (option 2).** *Research mode* gives the model `list_clauses`, `search_document` and `get_section` tools. It runs a capped multi-round loop, shows each step live ("Searching for “liability cap”…"), tolerates malformed or invented tool calls, and its final answer goes through the same quote verification.

## Run locally

```bash
npm install
cp .env.example .env      # set AI_API_KEY, AI_BASE_URL, AI_MODEL
npm run dev               # http://localhost:3000
npm run verify            # typecheck + tests + secret scan
```

Node 20+. Any OpenAI-compatible provider works (OpenAI, OpenRouter, Gemini's compatible endpoint, a local server). Research mode needs a model that supports tool calling. Without an API key the app still runs: uploads, viewing and the rule-based comparison work, and chat shows a clear error.

| Variable | Purpose | Default |
|---|---|---|
| `AI_API_KEY` | provider key (never commit) | none |
| `AI_BASE_URL` | OpenAI-compatible endpoint | `https://openrouter.ai/api/v1` |
| `AI_MODEL` | model name | `openai/gpt-4o-mini` |
| `DATA_DIR` | SQLite DB + uploaded files | `./data` |
| `AI_MAP_MODEL` | optional faster/cheaper model for the per-section step on large documents | same as `AI_MODEL` |
| `MAP_CONCURRENCY` | parallel section calls (raise if your plan allows, lower if you see rate-limit failures) | `6` |
| `RELEVANT_CHUNKS` | sections read first per document on large documents | `8` |
| `MAX_UPLOAD_MB` | upload size limit | `25` |
| `RATE_LIMIT_CHAT` / `_UPLOAD` / `_COMPARE` | requests per 10 min per IP | 40 / 30 / 12 |

Sample files for trying everything are in `samples/` (a 148-page agreement with clauses on pages 66, 88 and 115, a scanned PDF, two versions of a short agreement, a DOCX, and a `.txt` that should be rejected).

## How it works

```
upload ──> extract text + page map ──> SQLite (+ original file on disk)
question ─> [small doc]  whole text in one request
          └ [large doc]  per-section extraction (verified) ─> answer from verified excerpts + coverage
          └ [research]   model <-> tools loop (capped) ─────> answer
                              │
              <quote doc="D1">…</quote> ─> verify against that document ─> Verified / Unverified
```

**Quote verification** (`src/lib/quotes.ts`). Both the quote and the document are reduced to lowercase letters and digits (Unicode-normalised); whitespace, line breaks, hyphenation, smart quotes and bullets disappear, so extraction noise can't reject a genuine quote. A per-character map takes the match back to real offsets. Positions reported by the model are never used. A numeric guard rejects quotes whose numbers differ in punctuation (`10.5` vs `105`). Documents are shown to the model as `D1`, `D2`… and each quote is checked only against the document it names.

**Where verification can fail.** A model that merges two passages with "…" is marked unverified. Quotes under 12 letters/digits are rejected as too ambiguous. A quote spanning a page break fails if a running header/footer sits in the extracted text between the halves (the highlighter degrades to a partial highlight). Text inside images isn't extractable, so it can't be verified.

**Large documents** (`src/lib/chunk.ts`, `retrieve.ts`). The text is split into ~12k-character overlapping sections. By default the app is **relevance-first**: it ranks sections against the question (BM25) and has the model extract passages from only the top 8, which keeps answers fast. If a document yields nothing, the app reads the rest of it, so it never reports something as absent without a full read. Every returned passage is verified before use; throttled calls are retried with backoff, then recorded as unread. The answer carries a coverage note: *targeted* (“based on the 8 most relevant of 37 sections”, with a **Read every section** button that re-runs it exhaustively), or an amber *partial read* warning if sections failed. Speed depends on the model and your provider plan (rate limits), not just the code; see `AI_MAP_MODEL` and `MAP_CONCURRENCY`.

**Comparison** (`src/lib/clauses.ts`, `diff.ts`, `compare.ts`). Clauses are split on numbering, aligned by identical text first and similarity second. Amounts, durations and percentages are extracted by code, so a cap moving from AED 100,000 to AED 1,000,000 is always reported, and rules stop the model from rating a changed figure (or a whole clause appearing/disappearing) as cosmetic. If the model is unavailable, a rule-based comparison still completes.

**Operations.** In-process jobs are resumed after a restart (`src/instrumentation.ts`). Per-IP rate limits protect the API bill. `/api/health` reports status without exposing secrets.

## Status

| Area | Status |
|---|---|
| A1–A4: upload, chat, verified quotes, large documents | Done |
| B5: citation highlighting (PDF, DOCX) | Done; see limitations |
| B6: multi-document questions | Done |
| B7: version comparison | Done |
| C: agentic research | Done |
| Extra: background processing that recovers after a restart | Done |
| Extras: anonymise, semantic search, export, clause extraction, voice, Arabic/RTL | Not done |

## Known limitations

- **No OCR.** Scanned PDFs are rejected with a clear message.
- DOCX has no real pages; it is shown as one scrolling page.
- Zoom is fixed to the pane width when a PDF opens.
- Tables and images are not analysed in comparisons.
- Research-mode search is keyword-based (BM25 with a small contract-term synonym table), not semantic.
- Storage is SQLite plus local disk, so deploy where a persistent volume is available (not serverless). Single user, no authentication, as specified.
- Arabic text passes through extraction and verification (Unicode-aware) but right-to-left layout is not implemented.

## Tests

`npm test` runs 82 tests: quote verification (whitespace, hyphenation, numbers, repeats, wrong-document attribution), highlight mapping on a real PDF including a page-break split, a 148-page document end to end, relevance-first reading with call counts (retries, full-read fallback), clause alignment on two real PDFs, the comparison job without an AI key, the agent loop against a scripted fake model (malformed/invented/repeated tool calls, round cap, abort), restart recovery, rate limiting and a database migration.

## Project layout

```
src/app            pages and API routes (documents, chat, comparisons, health)
src/components     Chat, Workspace, DocumentPane, PdfViewer, HtmlViewer, ChangeCard
src/lib            quotes, answer, highlight, chunk, retrieve, clauses, diff, compare,
                   search, tools, agent, jobs, ratelimit, extract, db, repo, prompts
samples/           demo files        tests/   vitest suites + fixtures
docs/              DEPLOY, PHASES, NOTE, DEMO_SCRIPT, SUBMISSION_CHECKLIST
```
