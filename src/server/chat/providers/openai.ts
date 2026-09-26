import "server-only";
import OpenAI from "openai";
import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions/completions";
import { toolTitle } from "../tools";
import { ChatAbortedError, MAX_TOOL_STEPS, ProviderUnavailableError, type ProviderOutcome, type ProviderTurn, type TranscriptMessage } from "./types";

/** API fallback on OpenAI / OpenRouter: streamed chat completions with function calling over the AutoSEO tools. */

function userParts(m: TranscriptMessage): ChatCompletionContentPart[] {
  const parts: ChatCompletionContentPart[] = [];
  for (const a of m.attachments) {
    const dataUrl = `data:${a.ref.mimeType};base64,${a.data.toString("base64")}`;
    if (a.ref.kind === "image") parts.push({ type: "image_url", image_url: { url: dataUrl } });
    else if (a.ref.kind === "pdf") parts.push({ type: "file", file: { filename: a.ref.name, file_data: dataUrl } });
    else if (a.text != null) parts.push({ type: "text", text: `<attachment name="${a.ref.name.replace(/"/g, "'")}">\n${a.text}\n</attachment>` });
  }
  parts.push({ type: "text", text: m.text.trim() || "(see attachments)" });
  return parts;
}

function toOpenAiMessages(turn: ProviderTurn): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: "system", content: `${turn.system.stable}\n\n${turn.system.project}` }];
  for (const m of turn.transcript) {
    if (m.role === "user") out.push({ role: "user", content: m.attachments.length ? userParts(m) : m.text });
    else if (m.text.trim()) out.push({ role: "assistant", content: m.text });
  }
  return out;
}

type PendingCall = { id: string; name: string; args: string };

export async function runOpenAiTurn(
  turn: ProviderTurn,
  cfg: { provider: "openai" | "openrouter"; apiKey: string; model: string },
): Promise<ProviderOutcome> {
  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.provider === "openrouter" ? "https://openrouter.ai/api/v1" : undefined,
    timeout: 15 * 60_000,
    maxRetries: 2,
  });
  const tools: ChatCompletionTool[] = turn.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description.slice(0, 1024), parameters: t.inputSchema },
  }));
  const toolNames = new Set(turn.tools.map((t) => t.name));
  const messages = toOpenAiMessages(turn);
  const usage = { input: 0, output: 0, cost: 0 };
  let servedModel = cfg.model;
  let produced = false;
  let steps = 0;
  const startedAt = Date.now();

  const outcome = (): ProviderOutcome => ({
    runtime: { kind: "api", provider: cfg.provider, model: servedModel },
    usage: { inputTokens: usage.input, outputTokens: usage.output, costUsd: usage.cost || undefined, durationMs: Date.now() - startedAt, steps },
    costUsd: usage.cost,
    units: usage.input + usage.output,
  });

  while (steps < MAX_TOOL_STEPS) {
    if (turn.signal.aborted) throw new ChatAbortedError();
    steps++;
    const calls = new Map<number, PendingCall>();
    let text = "";
    let finish: string | null = null;
    let thinking = false;
    try {
      const stream = await client.chat.completions.create(
        {
          model: cfg.model,
          messages,
          tools: tools.length ? tools : undefined,
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal: turn.signal },
      );
      for await (const chunk of stream) {
        if (chunk.model) servedModel = chunk.model;
        if (chunk.usage) {
          usage.input += chunk.usage.prompt_tokens ?? 0;
          usage.output += chunk.usage.completion_tokens ?? 0;
          // OpenRouter reports the billed cost with each response.
          const cost = (chunk.usage as { cost?: number }).cost;
          if (typeof cost === "number") usage.cost += cost;
        }
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta as typeof choice.delta & { reasoning?: string | null };
        if (delta.reasoning) {
          thinking = true;
          turn.emit({ type: "thinking", delta: delta.reasoning, at: Date.now() });
        }
        if (delta.content) {
          if (thinking) {
            thinking = false;
            turn.emit({ type: "thinking_end", at: Date.now() });
          }
          produced = true;
          text += delta.content;
          turn.emit({ type: "text", delta: delta.content });
        }
        for (const tc of delta.tool_calls ?? []) {
          const cur = calls.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(tc.index, cur);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      if (thinking) turn.emit({ type: "thinking_end", at: Date.now() });
    } catch (err) {
      if (turn.signal.aborted || err instanceof OpenAI.APIUserAbortError) throw new ChatAbortedError();
      if (err instanceof OpenAI.APIError && !produced && steps === 1) throw new ProviderUnavailableError(`${cfg.provider}: ${err.message}`);
      throw err;
    }

    const pending = [...calls.values()].filter((c) => c.name);
    if (!pending.length) {
      if (finish === "length") turn.emit({ type: "notice", tone: "warning", text: "The answer was cut off because it reached the length limit." });
      if (finish === "content_filter") turn.emit({ type: "notice", tone: "warning", text: "The provider filtered part of this answer." });
      return outcome();
    }
    produced = true;
    const withIds = pending.map((c, i) => ({ ...c, id: c.id || `call_${steps}_${i}` }));
    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: withIds.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args || "{}" } })),
    });
    const results = await Promise.all(
      withIds.map(async (c) => {
        let input: unknown = {};
        let parseError: string | null = null;
        try {
          input = c.args ? JSON.parse(c.args) : {};
        } catch {
          parseError = JSON.stringify({ INVALID_JSON: c.args.slice(0, 2000) });
        }
        turn.emit({ type: "tool_call", id: c.id, name: c.name, title: toolTitle(c.name), input: parseError ? c.args : input, source: "autoseo", at: Date.now() });
        if (parseError || !toolNames.has(c.name)) {
          const error = parseError ? "The tool arguments were not valid JSON." : `Unknown tool: ${c.name}`;
          turn.emit({ type: "tool_result", id: c.id, output: error, isError: true, error, at: Date.now() });
          return { id: c.id, content: parseError ? `Error: ${parseError}` : `Error: ${error}` };
        }
        const res = await turn.executeTool(c.name, input);
        turn.emit({ type: "tool_result", id: c.id, output: res.output, data: res.data ?? undefined, isError: res.isError, error: res.isError ? res.output : undefined, at: Date.now() });
        return { id: c.id, content: res.modelText };
      }),
    );
    if (turn.signal.aborted) throw new ChatAbortedError();
    for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
  }
  turn.emit({ type: "notice", tone: "warning", text: `Stopped after ${MAX_TOOL_STEPS} tool rounds. Ask a follow-up to continue.` });
  return outcome();
}
