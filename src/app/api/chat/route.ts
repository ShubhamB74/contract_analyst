import type OpenAI from "openai";
import { getClient } from "@/lib/ai";
import { config } from "@/lib/config";
import { addMessage, getDocumentFull, getOrCreateConversation, listMessages, newId } from "@/lib/repo";
import { docsBlock, excerptsBlock, QA_SYSTEM, REDUCE_SYSTEM } from "@/lib/prompts";
import { processAnswer } from "@/lib/answer";
import { coverageStatement, gatherExcerpts } from "@/lib/retrieve";
import type { ChatMessage, Coverage, StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** GET /api/chat?docs=id1,id2 -> saved history for that document set */
export function GET(req: Request) {
  const docs = new URL(req.url).searchParams.get("docs")?.split(",").filter(Boolean) ?? [];
  if (!docs.length) return Response.json([]);
  return Response.json(listMessages(getOrCreateConversation(docs)));
}

/** POST { documentIds, question } -> NDJSON stream of StreamEvent */
export async function POST(req: Request) {
  const { documentIds, question } = (await req.json()) as { documentIds: string[]; question: string };
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (e: StreamEvent) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { open = false; }
      };
      const done = () => { if (open) { try { controller.close(); } catch {} open = false; } };

      try {
        const docs = (documentIds ?? []).map(getDocumentFull);
        if (!question?.trim() || !docs.length || docs.some((d) => !d)) throw new Error("Pick at least one document and enter a question.");
        const ready = docs as NonNullable<(typeof docs)[number]>[];
        if (ready.some((d) => d.status !== "ready")) throw new Error("A selected document is still processing or failed to process.");

        const convId = getOrCreateConversation(documentIds);
        const history = listMessages(convId).slice(-8).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content.replace(/\[\[q:\d+\]\]/g, ""),
        }));
        addMessage(convId, { id: newId(), role: "user", content: question, quotes: [], coverage: [], status: "complete" });

        // ── Choose strategy ─────────────────────────────────────────────────────────
        const total = ready.reduce((n, d) => n + d.text.length, 0);
        let coverage: Coverage[];
        let messages: OpenAI.Chat.ChatCompletionMessageParam[];

        if (total <= config.fullContextChars) {
          // Small: whole text in one request. Coverage is trivially complete.
          coverage = ready.map((d) => ({ docId: d.id, totalChunks: 1, readChunks: 1, complete: true }));
          messages = [
            { role: "system", content: QA_SYSTEM },
            ...history,
            { role: "user", content: `${docsBlock(ready)}\n\nQuestion: ${question}` },
          ];
        } else {
          // Large: map (per-section extraction + verification) then reduce (answer from excerpts).
          send({ type: "status", text: "Large document. Reading it section by section…" });
          const g = await gatherExcerpts({
            docs: ready, question, signal: req.signal,
            onStatus: (text) => send({ type: "status", text }),
          });
          coverage = g.coverage;
          const names = Object.fromEntries(ready.map((d) => [d.id, d.name]));
          send({ type: "status", text: `Found ${g.excerpts.length} relevant passage${g.excerpts.length === 1 ? "" : "s"}. Writing answer…` });
          messages = [
            { role: "system", content: REDUCE_SYSTEM },
            ...history,
            {
              role: "user",
              content: `${coverageStatement(coverage, names)}\n\n<excerpts>\n${excerptsBlock(g.excerpts.map((e) => ({ ...e, docName: e.docName })))}\n</excerpts>\n\nQuestion: ${question}`,
            },
          ];
        }

        // ── Stream the answer ───────────────────────────────────────────────────────
        let raw = "";
        let status: ChatMessage["status"] = "complete";
        try {
          const llm = await getClient().chat.completions.create(
            { model: config.ai.model, stream: true, temperature: 0, messages },
            { signal: req.signal }
          );
          for await (const part of llm) {
            const t = part.choices[0]?.delta?.content ?? "";
            if (t) { raw += t; send({ type: "delta", text: t }); }
          }
        } catch (e) {
          if (req.signal.aborted) status = "stopped";
          else throw e;
        }

        const { content, quotes } = processAnswer(raw, ready);
        const message: ChatMessage = { id: newId(), role: "assistant", content, quotes, coverage, status, created_at: new Date().toISOString() };
        addMessage(convId, message); // saved even when stopped
        send({ type: "final", message });
      } catch (e) {
        if (!req.signal.aborted) send({ type: "error", message: (e as Error).message });
      } finally {
        done();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
