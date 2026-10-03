/**
 * PHASE 8: agentic document research (Part C, option 2).
 *
 * The model gets three tools and decides what to look up. We run a bounded loop:
 *   - at most `maxRounds` tool-calling rounds, then one forced final answer with tools disabled;
 *   - at most `maxToolCallsPerRound` calls executed per round;
 *   - bad calls (unknown tool, malformed JSON, missing/invalid args, repeats) are answered with an
 *     ERROR tool message instead of crashing, and two rounds in a row of nothing-but-bad-calls end the loop;
 *   - every tool call is reported live via `emit` ("Searching for …").
 * The final answer is verified by processAnswer in the route, exactly like every other mode.
 */
import type OpenAI from "openai";
import { config } from "./config";
import { agentSystem, AGENT_FINAL_NUDGE } from "./prompts";
import { describeCall, executeTool, TOOL_DEFS, type ToolDoc } from "./tools";
import { getClauses } from "./search";
import type { Coverage, StreamEvent } from "./types";

type Msg = OpenAI.Chat.ChatCompletionMessageParam;
export type ChatClient = Pick<OpenAI, "chat">;
export type AgentResult = {
  raw: string;
  coverage: Coverage[];
  steps: string[];
  rounds: number;
  toolCalls: number;
  stoppedBy: "answer" | "round_cap" | "bad_calls" | "abort";
};

const isJson = (s: string) => { try { JSON.parse(s); return true; } catch { return false; } };

type Turn = { content: string; calls: { id: string; name: string; args: string }[] };

async function streamTurn(
  client: ChatClient, params: Record<string, unknown>, signal: AbortSignal,
  emit: (e: StreamEvent) => void, live: { text: string }
): Promise<Turn> {
  const stream = (await client.chat.completions.create({ ...params, stream: true } as never, { signal })) as unknown as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let content = "", streamed = false, reset = false;
  live.text = "";
  for await (const part of stream) {
    const d = part.choices?.[0]?.delta;
    if (!d) continue;
    for (const tc of d.tool_calls ?? []) {
      const cur = calls.get(tc.index ?? 0) ?? { id: "", name: "", args: "" };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name && tc.function.name !== cur.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      calls.set(tc.index ?? 0, cur);
      if (streamed && !reset) { emit({ type: "reset" }); reset = true; live.text = ""; }
    }
    if (d.content) {
      content += d.content;
      if (calls.size === 0) { live.text = content; streamed = true; emit({ type: "delta", text: d.content }); }
    }
  }
  return { content, calls: [...calls.values()] };
}

export async function runAgent(opts: {
  client: ChatClient;
  docs: ToolDoc[];
  question: string;
  history: Msg[];
  signal: AbortSignal;
  emit: (e: StreamEvent) => void;
  maxRounds?: number;
  model?: string;
}): Promise<AgentResult> {
  const { client, docs, question, history, signal, emit } = opts;
  const maxRounds = opts.maxRounds ?? config.maxAgentRounds;
  const maxCalls = config.maxToolCallsPerRound;
  const model = opts.model ?? config.ai.model;

  const ctx = { docs, seen: new Map<string, Set<number>>() };
  const docLines = docs.map((d) => `${d.alias} = ${d.name} (${getClauses(d).length} clauses)`).join("\n");
  const messages: Msg[] = [
    { role: "system", content: agentSystem(maxRounds, maxCalls, docLines, docs.length > 1) },
    ...history,
    { role: "user", content: question },
  ];

  const steps: string[] = [];
  const seenCalls = new Set<string>();
  let stepId = 0, rounds = 0, toolCalls = 0, badStreak = 0;
  let raw = "";
  let stoppedBy: AgentResult["stoppedBy"] = "answer";
  const live = { text: "" };

  try {
    for (let round = 1; ; round++) {
      const forceFinal = round > maxRounds || badStreak >= 2;
      if (forceFinal) {
        stoppedBy = badStreak >= 2 ? "bad_calls" : "round_cap";
        messages.push({ role: "user", content: AGENT_FINAL_NUDGE });
      }
      const turn = await streamTurn(
        client,
        { model, temperature: 0, messages, ...(forceFinal ? { tool_choice: "none" } : { tools: TOOL_DEFS, tool_choice: "auto" }) },
        signal, emit, live
      );

      if (forceFinal || turn.calls.length === 0) { raw = turn.content; if (!forceFinal) stoppedBy = "answer"; break; }

      rounds = round;
      messages.push({
        role: "assistant",
        content: turn.content || null,
        tool_calls: turn.calls.map((c, i) => ({
          id: c.id || `call_${round}_${i}`,
          type: "function" as const,
          function: { name: c.name || "unknown", arguments: isJson(c.args) ? c.args : "{}" }, // some providers reject non-JSON history
        })),
      });

      let validThisRound = 0;
      for (let i = 0; i < turn.calls.length; i++) {
        const c = turn.calls[i];
        const id = c.id || `call_${round}_${i}`;
        const sid = ++stepId;
        let outcome: { ok: boolean; content: string; done: string };

        if (i >= maxCalls) {
          outcome = { ok: false, content: `ERROR: Too many tool calls in one round (maximum ${maxCalls}). This call was not run.`, done: "Skipped an extra tool call" };
        } else {
          emit({ type: "step", id: sid, text: describeCall(c.name, c.args), state: "running" });
          const key = `${c.name}:${c.args.replace(/\s+/g, "")}`;
          if (seenCalls.has(key)) {
            outcome = { ok: false, content: "ERROR: You already made this exact call. Use the earlier result or try something different.", done: "Skipped a repeated call" };
          } else {
            seenCalls.add(key);
            outcome = executeTool(c.name, c.args, ctx);
          }
          toolCalls++;
        }
        if (outcome.ok) validThisRound++;
        steps.push(outcome.done);
        emit({ type: "step", id: sid, text: outcome.done, state: outcome.ok ? "done" : "error" });
        messages.push({ role: "tool", tool_call_id: id, content: outcome.content });
      }
      badStreak = validThisRound === 0 ? badStreak + 1 : 0;
    }
  } catch (e) {
    if (!signal.aborted) throw e;
    stoppedBy = "abort";
    raw = live.text; // keep whatever answer text had streamed
  }

  if (!raw.trim() && stoppedBy !== "abort") {
    raw = "I wasn’t able to reach an answer within the research limit. " +
      (steps.length ? `I looked at: ${[...new Set(steps)].slice(0, 6).join("; ")}.` : "") +
      " Try a more specific question.";
  }

  const coverage: Coverage[] = docs.map((d) => {
    const total = getClauses(d).length;
    const read = ctx.seen.get(d.id)?.size ?? 0;
    return { docId: d.id, totalChunks: total, readChunks: Math.min(read, total), complete: read >= total, note: read >= total ? undefined : "targeted research, not a full read" };
  });
  return { raw, coverage, steps, rounds, toolCalls, stoppedBy };
}
