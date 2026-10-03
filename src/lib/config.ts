import path from "path";

export const config = {
  dataDir: process.env.DATA_DIR ?? path.join(process.cwd(), "data"),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024,
  ai: {
    apiKey: process.env.AI_API_KEY ?? "",
    baseURL: process.env.AI_BASE_URL ?? "https://openrouter.ai/api/v1",
    model: process.env.AI_MODEL ?? "openai/gpt-4o-mini",
  },
  /** Docs above this many characters are NOT sent whole (Phase 4 handles them). */
  fullContextChars: 60_000,
  chunkChars: 12_000,
  chunkOverlap: 600,
  mapConcurrency: 4,
  /** Cap on verified excerpts passed to the final answer step. Hitting it marks coverage incomplete. */
  maxExcerpts: 80,
  maxExcerptChars: 40_000,
  /** Phase 8 (agentic): hard cap on tool-call rounds. */
  maxAgentRounds: 6,
  maxToolCallsPerRound: 4,
  toolResultMaxChars: 6_000,
};
