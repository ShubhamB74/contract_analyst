/**
 * Agent tools. Every function here is defensive: the model may call a tool that doesn't exist,
 * pass malformed JSON, omit arguments or send nonsense. We never throw; we return an
 * `ERROR:` result the model can read and recover from.
 */
import { config } from "./config";
import { clauseKey, getClauses, getPassages, searchPassages, type SearchDoc } from "./search";

export type ToolDoc = SearchDoc & { alias: string; name: string };
export type ToolCtx = {
  docs: ToolDoc[];
  /** doc id -> clause indexes the agent has actually been shown (drives the coverage banner). */
  seen: Map<string, Set<number>>;
};
export type ToolOutcome = { ok: boolean; content: string; done: string };

export const TOOL_NAMES = ["list_clauses", "search_document", "get_section"] as const;

const docParam = { type: "string", description: "Document id such as D1. Optional: omit to cover every document." };
export const TOOL_DEFS = [
  { type: "function" as const, function: { name: "list_clauses", description: "List the clauses of a document (number, heading, page). Call this first to understand the structure.", parameters: { type: "object", properties: { doc: docParam }, additionalProperties: false } } },
  { type: "function" as const, function: { name: "search_document", description: "Keyword search. Returns the best matching passages with clause number and page. Try different wordings if nothing is found.", parameters: { type: "object", properties: { query: { type: "string", description: "Keywords, e.g. 'termination notice period'." }, doc: docParam, max_results: { type: "integer", description: "1 to 8, default 5." } }, required: ["query"], additionalProperties: false } } },
  { type: "function" as const, function: { name: "get_section", description: "Read one full clause by its number (e.g. '4' or '12.1'), including its sub-clauses.", parameters: { type: "object", properties: { number: { type: "string", description: "Clause number from list_clauses or search results." }, doc: docParam }, required: ["number"], additionalProperties: false } } },
];

const err = (msg: string): ToolOutcome => ({ ok: false, content: `ERROR: ${msg}`, done: "Ignored an invalid tool call" });
const cap = (s: string) => (s.length > config.toolResultMaxChars ? s.slice(0, config.toolResultMaxChars) + "\n[output truncated. Narrow the request, e.g. get_section on a sub-clause]" : s);
const q = (s: string) => `“${s.length > 60 ? s.slice(0, 57) + "…" : s}”`;

export function parseArgs(raw: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return { ok: true, args: raw as Record<string, unknown> };
  if (typeof raw !== "string") return { ok: false, error: "Arguments must be a JSON object." };
  if (!raw.trim()) return { ok: true, args: {} };
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "Arguments must be a JSON object, e.g. {\"query\": \"termination\"}." };
    return { ok: true, args: v as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Arguments were not valid JSON." };
  }
}

function resolveDocs(arg: unknown, ctx: ToolCtx): ToolDoc[] | string {
  if (arg === undefined || arg === null || arg === "") return ctx.docs;
  const valid = ctx.docs.map((d) => `${d.alias} (${d.name})`).join(", ");
  if (typeof arg !== "string") return `"doc" must be a string. Valid documents: ${valid}.`;
  const want = arg.trim().toLowerCase();
  const hit = ctx.docs.find((d) => d.alias.toLowerCase() === want || d.name.toLowerCase() === want || d.id === arg.trim());
  return hit ? [hit] : `Unknown document ${q(arg)}. Valid documents: ${valid}.`;
}

function markSeen(ctx: ToolCtx, docId: string, clauseIndex: number) {
  if (!ctx.seen.has(docId)) ctx.seen.set(docId, new Set());
  ctx.seen.get(docId)!.add(clauseIndex);
}

/** Short, safe, human-readable description shown while the call runs. Never throws. */
export function describeCall(name: unknown, raw: unknown): string {
  try {
    const p = parseArgs(raw);
    const a = p.ok ? p.args : {};
    if (name === "search_document" && typeof a.query === "string" && a.query.trim()) return `Searching for ${q(a.query.trim())}…`;
    if (name === "get_section" && (typeof a.number === "string" || typeof a.number === "number")) return `Reading clause ${String(a.number)}…`;
    if (name === "list_clauses") return "Listing the document’s clauses…";
  } catch { /* fall through */ }
  return `Calling ${typeof name === "string" && name ? name : "a tool"}…`;
}

export function executeTool(name: unknown, raw: unknown, ctx: ToolCtx): ToolOutcome {
  try {
    if (typeof name !== "string" || !(TOOL_NAMES as readonly string[]).includes(name)) {
      return err(`Unknown tool ${q(String(name ?? ""))}. Available tools: ${TOOL_NAMES.join(", ")}.`);
    }
    const p = parseArgs(raw);
    if (!p.ok) return err(p.error);
    const a = p.args;
    if (name === "list_clauses") return listClauses(a, ctx);
    if (name === "search_document") return searchDocument(a, ctx);
    return getSection(a, ctx);
  } catch (e) {
    return err(`The tool failed unexpectedly (${(e as Error).message}). Try a different call.`);
  }
}

function listClauses(a: Record<string, unknown>, ctx: ToolCtx): ToolOutcome {
  const docs = resolveDocs(a.doc, ctx);
  if (typeof docs === "string") return err(docs);
  const out: string[] = [];
  for (const d of docs) {
    const cs = getClauses(d);
    const lines = cs.slice(0, 150).map((c) => {
      const label = c.heading ?? c.text.split("\n")[0].slice(0, 60);
      const page = d.pages.find((p) => c.start >= p.start && c.start <= p.end)?.page;
      return `- ${clauseKey(c)}: ${label}${page ? ` (p. ${page})` : ""}`;
    });
    out.push(`[${d.alias}] ${d.name}: ${cs.length} clauses\n${lines.join("\n")}${cs.length > 150 ? `\n… ${cs.length - 150} more` : ""}`);
  }
  return { ok: true, content: cap(out.join("\n\n")), done: `Listed clauses${docs.length === 1 ? ` in ${docs[0].alias}` : ""}` };
}

function searchDocument(a: Record<string, unknown>, ctx: ToolCtx): ToolOutcome {
  const query = typeof a.query === "string" ? a.query.trim().slice(0, 300) : "";
  if (!query) return err('Missing required argument "query" (a non-empty string of keywords).');
  const docs = resolveDocs(a.doc, ctx);
  if (typeof docs === "string") return err(docs);
  const k = typeof a.max_results === "number" && Number.isFinite(a.max_results) ? Math.min(8, Math.max(1, Math.round(a.max_results))) : 5;

  const hits = searchPassages(docs.flatMap(getPassages), query, k);
  if (!hits.length) {
    return { ok: true, content: `No passages matched ${q(query)}. Try different or broader keywords, or use list_clauses and get_section.`, done: `Searched for ${q(query)}: no matches` };
  }
  const aliasOf = new Map(ctx.docs.map((d) => [d.id, d.alias]));
  const body = hits.map(({ passage: p }, i) => {
    markSeen(ctx, p.docId, p.clauseIndex);
    return `${i + 1}. [${aliasOf.get(p.docId)}] Clause ${p.key}${p.heading ? ` ${p.heading}` : ""}${p.page ? `, p. ${p.page}` : ""}\n<passage>\n${p.text}\n</passage>`;
  }).join("\n\n");
  return { ok: true, content: cap(`${hits.length} passage${hits.length === 1 ? "" : "s"} for ${q(query)}:\n\n${body}`), done: `Searched for ${q(query)}: ${hits.length} passage${hits.length === 1 ? "" : "s"}` };
}

const normKey = (s: string) => s.toLowerCase().replace(/^(clause|section|article)\s+/, "").replace(/[.\s]+$/, "").trim();

function getSection(a: Record<string, unknown>, ctx: ToolCtx): ToolOutcome {
  const num = typeof a.number === "number" ? String(a.number) : typeof a.number === "string" ? a.number : "";
  if (!num.trim()) return err('Missing required argument "number" (a clause number such as "4" or "12.1").');
  const docs = resolveDocs(a.doc, ctx);
  if (typeof docs === "string") return err(docs);
  const want = normKey(num);

  const parts: string[] = [];
  let label = "";
  for (const d of docs) {
    const cs = getClauses(d);
    let hit = cs.filter((c) => normKey(clauseKey(c)) === want);
    let viaHeading = false;
    if (!hit.length && want.length >= 4) { // the model passed a heading instead of a number
      hit = cs.filter((c) => c.heading && c.heading.toLowerCase().includes(want)).slice(0, 1);
      viaHeading = hit.length > 0;
    }
    if (!hit.length) continue;
    const family = viaHeading ? hit : [...hit, ...cs.filter((c) => normKey(clauseKey(c)).startsWith(`${want}.`))];
    const text = family.map((c) => { markSeen(ctx, d.id, c.index); return `Clause ${clauseKey(c)}${c.heading ? ` ${c.heading}` : ""}\n${c.text}`; }).join("\n\n");
    parts.push(`[${d.alias}] ${d.name}${viaHeading ? " (matched by heading)" : ""}\n<section>\n${text}\n</section>`);
    label ||= `${clauseKey(hit[0])}${hit[0].heading ? ` (${hit[0].heading})` : ""}`;
  }
  if (!parts.length) {
    const keys = docs.flatMap((d) => getClauses(d).map(clauseKey));
    return err(`No clause ${q(num)} found. Available clause numbers: ${keys.slice(0, 30).join(", ")}${keys.length > 30 ? ", …" : ""}. Use list_clauses to see headings.`);
  }
  return { ok: true, content: cap(parts.join("\n\n")), done: `Read clause ${label}` };
}
