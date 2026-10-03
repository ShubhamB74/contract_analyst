export type Significance = "high" | "medium" | "low" | "cosmetic";
export type ChangeKind = "modified" | "added" | "removed";
export type DiffOp = { t: "eq" | "del" | "ins"; text: string };

export type Change = {
  id: string;
  kind: ChangeKind;
  number: string | null;          // clause number in the newer version (older if removed)
  heading: string | null;
  before?: string;                // wording in the older version
  after?: string;                 // wording in the newer version
  pageBefore?: number | null;
  pageAfter?: number | null;
  similarity?: number;
  /** Figures (amounts, durations, percentages) found by CODE, not the model. */
  figures: { removed: string[]; added: string[] };
  renumbered?: boolean;
  diff?: DiffOp[] | null;         // word-level diff, for display
  significance: Significance;
  category: string;
  summary: string;                // plain-language: what changed in substance
  source: "model" | "heuristic";
  floored?: boolean;              // model said less than our rules allow; we raised it
};

export type ComparisonResult = {
  overview: string;
  aiError?: string;               // set if summaries fell back to rules
  unchanged: number;
  renumbered: number;
  changes: Change[];
};

export type ComparisonView = {
  id: string;
  status: "running" | "done" | "failed";
  progress: string | null;
  error: string | null;
  docA: { id: string; name: string };
  docB: { id: string; name: string };
  result: ComparisonResult | null;
};
