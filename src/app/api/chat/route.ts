import type OpenAI from "openai";
import { getClient } from "@/lib/ai";
import { config } from "@/lib/config";
import { addMessage, getDocumentFull, getOrCreateConversation, listMessages, newId } from "@/lib/repo";
import { docsBlock, excerptsBlock, MULTI_ADDENDUM, QA_SYSTEM, REDUCE_SYSTEM } from "@/lib/prompts";
import { uniqueLabels } from "@/lib/labels";
import { processAnswer } from "@/lib/answer";
import { coverageStatement, gatherExcerpts } from "@/lib/retrieve";
import { runAgent } from "@/lib/agent";
import { rateLimited } from "@/lib/ratelimit";
import type { ChatMessage, Coverage, StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** GET /api/chat?docs=id1,id2 -> saved history for that document set */
export function GET(req: Request) {
  const docs = new URL(req.url).searchParams.get("docs")?.split(",").filter(Boolean) ?? [];
  if (!docs.length) return Response.json([]);
  return Response.json(listMessages(getOrCreateConversation(docs)));
}

/** POST { documentIds, question, mode?: "agent" } -> NDJSON stream of StreamEvent */
export async function POST(req: Request) {
  const limited = rateLimited(req, "chat", true);
  if (limited) return limited;
  const { documentIds, question, mode } = (await req.json()) as { documentIds: string[]; question: string; mode?: "agent" | "standard" };
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (e: StreamEvent) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { open = false; }
      };
      const done = () => { if (open) { try { controller.close(); } catch {} open = false; } };

      let convId: string | undefined;
      try {
        const docs = (documentIds ?? []).map(getDocumentFull);
        if (!question?.trim() || !docs.length || docs.some((d) => !d)) throw new Error("Pick at least one document and enter a question.");
        const ready = docs as NonNullable<(typeof docs)[number]>[];
        if (ready.some((d) => d.status !== "ready")) throw new Error("A selected document is still processing or failed to process.");

        // Unique display names, plus short aliases (D1, D2…) so the model can't garble UUIDs.
        const labels = uniqueLabels(ready);
        const named = ready.map((d) => ({ ...d, name: labels[d.id] }));
        const aliasOf = Object.fromEntries(ready.map((d, i) => [d.id, `D${i + 1}`]));
        const idOf = Object.fromEntries(ready.map((d, i) => [`D${i + 1}`, d.id]));
        const multi = ready.length > 1;

        convId = getOrCreateConversation(documentIds);
        const history = listMessages(convId).filter((m) => m.status !== "error").slice(-8).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content.replace(/\[\[q:\d+\]\]/g, ""),
        }));
        addMessage(convId, { id: newId(), role: "user", content: question, quotes: [], coverage: [], status: "complete" });

        let raw = "";
        let status: ChatMessage["status"] = "complete";
        let coverage: Coverage[];
        let steps: string[] | undefined;

        if (mode === "agent") {
          // ── Phase 8: the model researches through tools (capped loop, live steps) ──
          const r = await runAgent({
            client: getClient(),
            docs: named.map((d) => ({ id: d.id, alias: aliasOf[d.id], name: d.name, text: d.text, pages: d.pages })),
            question, history, signal: req.signal, emit: send,
          });
          raw = r.raw; coverage = r.coverage; steps = r.steps;
          if (r.stoppedBy === "abort") status = "stopped";
        } else {
          // ── Choose strategy ─────────────────────────────────────────────────────────
          const total = ready.reduce((n, d) => n + d.text.length, 0);
          let messages: OpenAI.Chat.ChatCompletionMessageParam[];

          if (total <= config.fullContextChars) {
            // Small: whole text in one request. Coverage is trivially complete.
            coverage = ready.map((d) => ({ docId: d.id, totalChunks: 1, readChunks: 1, complete: true }));
            messages = [
              { role: "system", content: QA_SYSTEM + (multi ? MULTI_ADDENDUM : "") },
              ...history,
              { role: "user", content: `${docsBlock(named.map((d) => ({ id: aliasOf[d.id], name: d.name, text: d.text })))}\n\nQuestion: ${question}` },
            ];
          } else {
            // Large: map (per-section extraction + verification) then reduce (answer from excerpts).
            send({ type: "status", text: "Large document. Reading it section by section…" });
            const g = await gatherExcerpts({
              docs: named, question, signal: req.signal,
              onStatus: (text) => send({ type: "status", text }),
            });
            coverage = g.coverage;
            const names = labels;
            send({ type: "status", text: `Found ${g.excerpts.length} relevant passage${g.excerpts.length === 1 ? "" : "s"}. Writing answer…` });
            messages = [
              { role: "system", content: REDUCE_SYSTEM + (multi ? MULTI_ADDENDUM : "") },
              ...history,
              {
                role: "user",
                content: `${coverageStatement(coverage, names)}\n\n<excerpts>\n${excerptsBlock(g.excerpts.map((e) => ({ ...e, docId: aliasOf[e.docId] })))}\n</excerpts>\n\nQuestion: ${question}`,
              },
            ];
          }

          // ── Stream the answer ───────────────────────────────────────────────────────
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
        }

        const { content, quotes } = processAnswer(raw, ready, idOf);
        const message: ChatMessage = { id: newId(), role: "assistant", content, quotes, coverage, steps, status, created_at: new Date().toISOString() };
        addMessage(convId, message); // saved even when stopped
        send({ type: "final", message });
      } catch (e) {
        // Never leave a question without a visible outcome in the saved history.
        const stopped = req.signal.aborted;
        if (convId) {
          addMessage(convId, {
            id: newId(), role: "assistant", quotes: [], coverage: [], status: stopped ? "stopped" : "error",
            content: stopped ? "Stopped before an answer was written." : `Couldn’t answer: ${(e as Error).message}`,
          });
        }
        if (!stopped) send({ type: "error", message: (e as Error).message });
      } finally {
        done();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
