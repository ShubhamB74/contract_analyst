import type { Coverage } from "./types";

/**
 * How the UI should describe what was read.
 *  hard     a section failed to read, or passages were dropped: the answer may be missing things (amber)
 *  targeted we deliberately read only the relevant parts (agent research, relevance-first): quiet grey note
 *  full     everything was read
 *  none     single-request answer, nothing to say
 *
 * Messages saved by earlier versions have no `targeted`/`capped` flags, so anything incomplete that
 * isn't a failure is treated as targeted, never as "read all".
 */
export type CoverageKind = "hard" | "targeted" | "full" | "none";

export function coverageKind(cov: Coverage[]): CoverageKind {
  const incomplete = cov.filter((c) => !c.complete);
  const hard = incomplete.some((c) => (c.failedChunks?.length ?? 0) > 0 || c.capped || c.note?.startsWith("Too many"));
  if (hard) return "hard";
  if (incomplete.length) return "targeted";
  return cov.some((c) => c.totalChunks > 1) ? "full" : "none";
}
