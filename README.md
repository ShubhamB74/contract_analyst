# Contract Analyst

Upload a contract (PDF or DOCX), ask questions, get answers backed by quotes that the server has verified against the document text.

> Starter status: see [docs/PHASES.md](docs/PHASES.md). Update the "What's finished" section below as you go.

## Run locally

```bash
npm install
cp .env.example .env     # set AI_API_KEY, AI_BASE_URL, AI_MODEL
npm run dev              # http://localhost:3000
npm test                 # quote verification tests
```
Requires Node 20+. Data (SQLite + uploads) lives in `DATA_DIR` (default `./data`).

## Deploy
Use Railway or Fly.io with the included `Dockerfile` and mount a persistent volume at `/data` (SQLite and uploads need it). Set `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` in the platform's env settings. Never commit `.env`.

## How quote verification works
Quotes are matched in a canonical space (letters and digits only, lowercased, NFKC). That absorbs line breaks, extra spaces, hyphenation and punctuation differences. A per-character map returns the match to real offsets in the original text. Positions from the model are never used. See `src/lib/quotes.ts`.

## What's finished
- [x] Upload, validation, extraction, scanned-PDF detection, library
- [x] Streaming chat, stop, saved history
- [x] Verified quotes (core)
- [ ] Large documents · [ ] Highlighting · [ ] Multi-doc · [ ] Comparison · [ ] Part C

## Screenshots
_Add: upload, chat with verified quotes, citation highlighting, comparison._
