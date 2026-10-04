import path from "path";

export const config = {
  dataDir: process.env.DATA_DIR ?? path.join(process.cwd(), "data"),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024,
  ai: {
    apiKey: process.env.AI_API_KEY ?? "",
    baseURL: process.env.AI_BASE_URL ?? "https://openrouter.ai/api/v1",
    model: process.env.AI_MODEL ?? "openai/gpt-4o-mini",
    /** Optional cheaper/faster model for the per-section extraction step of large documents. */
    mapModel: process.env.AI_MAP_MODEL || process.env.AI_MODEL || "openai/gpt-4o-mini",
  },
  /** Docs above this many characters are NOT sent whole (Phase 4 handles them). */
  fullContextChars: 60_000,
  chunkChars: 12_000,
  chunkOverlap: 600,
  /** Parallel section calls. Raise if your provider/plan allows; lower if you see rate-limit failures. */
  mapConcurrency: Number(process.env.MAP_CONCURRENCY ?? 6),
  /** Relevance-first reading: how many top-ranked sections per document are read before anything else. */
  relevantChunks: Number(process.env.RELEVANT_CHUNKS ?? 8),
  /** Cap on verified excerpts passed to the final answer step. Hitting it marks coverage incomplete. */
  maxExcerpts: 80,
  maxExcerptChars: 40_000,
  /** Phase 8 (agentic): hard cap on tool-call rounds. */
  maxAgentRounds: 6,
  maxToolCallsPerRound: 4,
  toolResultMaxChars: 6_000,
};
