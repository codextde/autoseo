import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ChatCitation } from "@/features/chat/types";
import { toolTitle } from "../tools";
import { estimateCostUsd } from "../models";
import { ChatAbortedError, MAX_TOOL_STEPS, ProviderUnavailableError, type ProviderOutcome, type ProviderTurn, type TranscriptMessage } from "./types";

/**
 * API fallback on Anthropic: streamed manual tool loop over the AutoSEO tool registry with
 * adaptive (summarized) thinking, server-side refusal fallbacks, web search and prompt caching.
 */

const MAX_JSON_RETRIES = 2;

function userContent(m: TranscriptMessage): BetaContentBlockParam[] {
  const blocks: BetaContentBlockParam[] = [];
  for (const a of m.attachments) {
    if (a.ref.kind === "image") {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: a.ref.mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: a.data.toString("base64") },
      });
    } else if (a.ref.kind === "pdf") {
      blocks.push({ type: "document", title: a.ref.name, source: { type: "base64", media_type: "application/pdf", data: a.data.toString("base64") } });
    } else if (a.text != null) {
      blocks.push({ type: "text", text: `<attachment name="${a.ref.name.replace(/"/g, "'")}" type="${a.ref.mimeType}">\n${a.text}\n</attachment>` });
    }
  }
  blocks.push({ type: "text", text: m.text.trim() || (m.attachments.length ? "(see attachments)" : "…") });
  return blocks;
}

export function toAnthropicMessages(transcript: TranscriptMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const m of transcript) {
    if (m.role === "user") out.push({ role: "user", content: userContent(m) });
    else if (m.text.trim()) out.push({ role: "assistant", content: [{ type: "text", text: m.text }] });
  }
  while (out.length && out[0]!.role !== "user") out.shift();
  return out;
}

/**
 * After a mid-output refusal fallback, blocks before the last `fallback` marker that are not plain
 * text (thinking, tool calls, unpaired server tool calls) must not be echoed back.
 */
function echoableContent(content: BetaContentBlock[]): BetaContentBlockParam[] {
  const cut = content.findLastIndex((b) => b.type === "fallback");
  if (cut === -1) return content as unknown as BetaContentBlockParam[];
  const resultIds = new Set(
    content.filter((b) => b.type === "web_search_tool_result").map((b) => (b as { tool_use_id: string }).tool_use_id),
  );
  return content.filter((b, i) => {
    if (i > cut || b.type === "text" || b.type === "web_search_tool_result" || b.type === "fallback") return true;
    if (b.type === "server_tool_use") return resultIds.has(b.id);
    return false;
  }) as unknown as BetaContentBlockParam[];
}

/** Tool calls of the model that produced the final part of the message (after the last fallback marker). */
function activeToolUses(content: BetaContentBlock[]) {
  const cut = content.findLastIndex((b) => b.type === "fallback");
  return content.filter((b, i): b is Extract<BetaContentBlock, { type: "tool_use" }> => b.type === "tool_use" && i > cut);
}

function searchSummary(content: unknown): { output: string; citations: ChatCitation[]; isError: boolean } {
  if (!Array.isArray(content)) {
    const code = (content as { error_code?: string } | null)?.error_code ?? "unknown_error";
    return { output: `Web search failed (${code}).`, citations: [], isError: true };
  }
  const citations: ChatCitation[] = [];
  const lines: string[] = [];
  for (const r of content as Array<{ type: string; url?: string; title?: string }>) {
    if (r.type === "web_search_result" && r.url) {
      citations.push({ url: r.url, title: r.title });
      lines.push(`- [${r.title || r.url}](${r.url})`);
    }
  }
  return { output: lines.length ? lines.join("\n") : "No results.", citations, isError: false };
}

export async function runAnthropicTurn(turn: ProviderTurn, cfg: { apiKey: string; model: string }): Promise<ProviderOutcome> {
  const client = new Anthropic({ apiKey: cfg.apiKey, timeout: 15 * 60_000, maxRetries: 2 });
  const toolNames = new Set(turn.tools.map((t) => t.name));
  const tools: BetaToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: 5 },
    ...turn.tools.map(
      (t, i): BetaToolUnion => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as { type: "object"; properties?: unknown },
        eager_input_streaming: true,
        ...(i === turn.tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
      }),
    ),
  ];
  const system: BetaTextBlockParam[] = [
    { type: "text", text: turn.system.stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: turn.system.project, cache_control: { type: "ephemeral" } },
  ];
  const messages = toAnthropicMessages(turn.transcript);
  if (!messages.length) throw new Error("Nothing to answer.");

  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 };
  let servedModel = cfg.model;
  let produced = false;
  let steps = 0;
  let jsonRetries = 0;
  const startedAt = Date.now();

  const outcome = (): ProviderOutcome => ({
    runtime: { kind: "api", provider: "anthropic", model: servedModel },
    usage: {
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      costUsd: estimateCostUsd(servedModel, usage),
      durationMs: Date.now() - startedAt,
      steps,
    },
    costUsd: estimateCostUsd(servedModel, usage),
    units: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
  });

  while (steps < MAX_TOOL_STEPS) {
    if (turn.signal.aborted) throw new ChatAbortedError();
    steps++;
    const stream = client.beta.messages.stream(
      {
        model: cfg.model,
        max_tokens: 64_000,
        system,
        tools,
        messages,
        thinking: { type: "adaptive", display: "summarized" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
      },
      { signal: turn.signal },
    );

    let message: BetaMessage;
    // Content-block index → kind, to know what a content_block_stop closes.
    const blockKinds = new Map<number, string>();
    try {
      for await (const ev of stream) {
        if (ev.type === "message_start") {
          servedModel = ev.message.model || servedModel;
        } else if (ev.type === "content_block_start") {
          const b = ev.content_block;
          blockKinds.set(ev.index, b.type);
          if (b.type === "tool_use") {
            produced = true;
            turn.emit({ type: "tool_call", id: b.id, name: b.name, title: toolTitle(b.name), source: "autoseo", at: Date.now() });
          } else if (b.type === "fallback") {
            turn.emit({ type: "notice", tone: "info", text: `${b.from.model} declined part of this request — ${b.to.model} continued the answer.` });
          } else if (b.type === "web_search_tool_result") {
            const s = searchSummary((b as { content: unknown }).content);
            turn.emit({ type: "tool_result", id: (b as { tool_use_id: string }).tool_use_id, output: s.output, isError: s.isError, error: s.isError ? s.output : undefined, at: Date.now() });
            if (s.citations.length) turn.emit({ type: "citations", items: s.citations });
          }
        } else if (ev.type === "content_block_delta") {
          const d = ev.delta;
          if (d.type === "text_delta") {
            produced = true;
            turn.emit({ type: "text", delta: d.text });
          } else if (d.type === "thinking_delta") {
            turn.emit({ type: "thinking", delta: d.thinking, at: Date.now() });
          } else if (d.type === "citations_delta") {
            const c = d.citation as { url?: string; title?: string | null };
            if (c.url) turn.emit({ type: "citations", items: [{ url: c.url, title: c.title ?? undefined }] });
          }
        } else if (ev.type === "content_block_stop") {
          const kind = blockKinds.get(ev.index);
          if (kind === "thinking" || kind === "redacted_thinking") turn.emit({ type: "thinking_end", at: Date.now() });
          if (kind === "server_tool_use") {
            const snap = stream.currentMessage?.content[ev.index] as { type: string; id: string; name: string; input: unknown } | undefined;
            if (snap?.type === "server_tool_use") {
              produced = true;
              turn.emit({ type: "tool_call", id: snap.id, name: snap.name, title: snap.name === "web_search" ? "Web search" : snap.name, input: snap.input, source: "server", at: Date.now() });
            }
          }
        }
      }
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (turn.signal.aborted || err instanceof Anthropic.APIUserAbortError) throw new ChatAbortedError();
      if (err instanceof Anthropic.APIError) {
        if (!produced && steps === 1) throw new ProviderUnavailableError(`Anthropic: ${err.message}`);
        throw err;
      }
      // Eager input streaming: a tool input that is not parseable JSON rejects the stream — re-issue the turn.
      if (jsonRetries++ < MAX_JSON_RETRIES) {
        steps--;
        continue;
      }
      throw err;
    }

    usage.input += message.usage.input_tokens ?? 0;
    usage.output += message.usage.output_tokens ?? 0;
    usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
    usage.searches += message.usage.server_tool_use?.web_search_requests ?? 0;
    servedModel = message.model || servedModel;

    const stop = message.stop_reason;
    if (stop === "refusal") {
      turn.emit({ type: "notice", tone: "warning", text: "The model declined to continue with this request." });
      return outcome();
    }
    if (stop === "pause_turn") {
      messages.push({ role: "assistant", content: echoableContent(message.content) });
      continue;
    }
    const toolUses = activeToolUses(message.content);
    if (!toolUses.length) {
      if (stop === "max_tokens" || stop === "model_context_window_exceeded") {
        turn.emit({ type: "notice", tone: "warning", text: "The answer was cut off because it reached the length limit." });
      }
      return outcome();
    }
    if (stop === "max_tokens") {
      turn.emit({ type: "notice", tone: "warning", text: "A tool call was cut off at the length limit — ask a narrower question." });
      return outcome();
    }

    messages.push({ role: "assistant", content: echoableContent(message.content) });
    const results = await Promise.all(
      toolUses.map(async (block): Promise<BetaToolResultBlockParam> => {
        const at = Date.now();
        turn.emit({ type: "tool_call", id: block.id, name: block.name, title: toolTitle(block.name), input: block.input, source: "autoseo", at });
        if (!toolNames.has(block.name)) {
          const error = `Unknown tool: ${block.name}`;
          turn.emit({ type: "tool_result", id: block.id, output: error, isError: true, error, at: Date.now() });
          return { type: "tool_result", tool_use_id: block.id, is_error: true, content: error };
        }
        const res = await turn.executeTool(block.name, block.input);
        turn.emit({ type: "tool_result", id: block.id, output: res.output, data: res.data ?? undefined, isError: res.isError, error: res.isError ? res.output : undefined, at: Date.now() });
        return { type: "tool_result", tool_use_id: block.id, is_error: res.isError || undefined, content: res.modelText };
      }),
    );
    if (turn.signal.aborted) throw new ChatAbortedError();
    messages.push({ role: "user", content: results });
  }
  turn.emit({ type: "notice", tone: "warning", text: `Stopped after ${MAX_TOOL_STEPS} tool rounds. Ask a follow-up to continue.` });
  return outcome();
}
