export type DocStatus = "processing" | "ready" | "failed";

export type PageSpan = { page: number; start: number; end: number }; // offsets into doc text

export type DocumentRow = {
  id: string;
  name: string;
  mime: string;
  status: DocStatus;
  error: string | null;        // human-readable reason when failed
  page_count: number | null;
  char_count: number | null;
  created_at: string;
};

export type QuoteMatch = { start: number; end: number; page: number | null };

export type VerifiedQuote = {
  id: number;                  // index referenced by [[q:id]] marker in content
  docId: string;
  text: string;                // exactly what the model claimed
  status: "verified" | "unverified";
  matches: QuoteMatch[];       // all occurrences, located by OUR code
  reason?: string;
};

/** Phase 4: what part of the document was actually read for an answer. */
export type Coverage = {
  docId: string;
  totalChunks: number;
  readChunks: number;
  failedChunks?: number[];     // indexes of sections that could not be read
  complete: boolean;           // false => answer must NOT claim anything is absent
  note?: string;               // e.g. excerpt cap reached
  targeted?: boolean;          // deliberately read only the most relevant sections (not a failure)
  capped?: boolean;            // too many matching passages; some were dropped
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;             // assistant content uses [[q:N]] markers
  quotes: VerifiedQuote[];
  coverage: Coverage[];
  steps?: string[];            // Phase 8: research steps the agent took
  status: "complete" | "stopped" | "error";
  created_at: string;
};

/** NDJSON events streamed from /api/chat */
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "status"; text: string }
  | { type: "step"; id: number; text: string; state: "running" | "done" | "error" } // Phase 8: live agent activity
  | { type: "reset" }                           // discard text streamed so far (it was a preamble to a tool call)
  | { type: "final"; message: ChatMessage }
  | { type: "error"; message: string };
