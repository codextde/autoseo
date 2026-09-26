import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "@/features/chat/types";
import { applyChatEvent } from "@/features/chat/lib/parts";
import type { ProviderTurn } from "./providers/types";

/* ── Scripted stand-in for the Anthropic SDK streaming API ── */

type Script = { events: Record<string, unknown>[]; final: Record<string, unknown> } | { throws: unknown };
const scripts: Script[] = [];
const requests: Record<string, unknown>[] = [];

class FakeAPIError extends Error {}
class FakeAbortError extends Error {}

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    static APIError = FakeAPIError;
    static APIUserAbortError = FakeAbortError;
    beta = {
      messages: {
        stream: (params: Record<string, unknown>) => {
          requests.push(structuredClone(params));
          const script = scripts.shift();
          if (!script) throw new Error("no scripted response left");
          return {
            currentMessage: "final" in script ? script.final : undefined,
            async *[Symbol.asyncIterator]() {
              if ("throws" in script) throw script.throws;
              for (const e of script.events) yield e;
            },
            finalMessage: async () => {
              if ("throws" in script) throw script.throws;
              return script.final;
            },
          };
        },
      },
    };
  }
  return { default: Anthropic };
});

const { runAnthropicTurn } = await import("./providers/anthropic");

function makeTurn(executeTool: ProviderTurn["executeTool"]) {
  const events: ChatStreamEvent[] = [];
  const turn: ProviderTurn = {
    system: { stable: "STABLE", project: "PROJECT" },
    transcript: [{ role: "user", text: "How visible are we?", attachments: [] }],
    tools: [
      {
        name: "get_visibility_metrics",
        title: "AI visibility metrics",
        description: "KPIs",
        inputSchema: { type: "object", properties: { timeframeDays: { type: "number" } } },
        readOnly: true,
      },
    ],
    executeTool,
    emit: (e) => events.push(e),
    signal: new AbortController().signal,
  };
  return { turn, events };
}

const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: null };

beforeEach(() => {
  scripts.length = 0;
  requests.length = 0;
});

describe("Anthropic chat provider (API fallback tool loop)", () => {
  it("streams thinking + text, runs tool calls and returns all results in one user message", async () => {
    const toolUse = { type: "tool_use", id: "toolu_1", name: "get_visibility_metrics", input: { timeframeDays: 30 } };
    scripts.push({
      events: [
        { type: "message_start", message: { model: "claude-opus-5" } },
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Need the metrics." } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Checking. " } },
        { type: "content_block_stop", index: 1 },
        { type: "content_block_start", index: 2, content_block: { ...toolUse, input: {} } },
        { type: "content_block_stop", index: 2 },
      ],
      final: {
        model: "claude-opus-5",
        stop_reason: "tool_use",
        usage,
        content: [{ type: "thinking", thinking: "Need the metrics.", signature: "sig" }, { type: "text", text: "Checking. " }, toolUse],
      },
    });
    scripts.push({
      events: [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Visibility is 12.5%." } },
        { type: "content_block_stop", index: 0 },
      ],
      final: { model: "claude-opus-5", stop_reason: "end_turn", usage, content: [{ type: "text", text: "Visibility is 12.5%." }] },
    });

    const executeTool = vi.fn(async () => ({ modelText: "Visibility 12.5%", output: "Visibility 12.5%", data: { current: { visibility: 12.5 } }, isError: false }));
    const { turn, events } = makeTurn(executeTool);
    const out = await runAnthropicTurn(turn, { apiKey: "sk-test", model: "claude-opus-5" });

    // Request shape: adaptive summarized thinking, default fallbacks, eager tool streaming, caching.
    const first = requests[0]!;
    expect(first.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(first.fallbacks).toBe("default");
    expect(first.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(first.max_tokens).toBe(64_000);
    const tools = first.tools as Record<string, unknown>[];
    const custom = tools.find((t) => t.name === "get_visibility_metrics")!;
    expect(custom.eager_input_streaming).toBe(true);
    expect(custom.cache_control).toEqual({ type: "ephemeral" });
    expect((first.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });

    // Tool executed once with the model's input; results returned in one user message.
    expect(executeTool).toHaveBeenCalledWith("get_visibility_metrics", { timeframeDays: 30 });
    const second = requests[1]!.messages as { role: string; content: { type: string; tool_use_id?: string }[] }[];
    const last = second[second.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content).toHaveLength(1);
    expect(last.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });

    // Events fold into ordered parts: thinking → text → tool call (with result) → text.
    const parts = events.reduce(applyChatEvent, []);
    expect(parts.map((p) => p.type)).toEqual(["thinking", "text", "tool_call", "text"]);
    expect(parts[2]).toMatchObject({ type: "tool_call", state: "success", input: { timeframeDays: 30 }, title: "AI visibility metrics" });
    expect(out.runtime).toMatchObject({ kind: "api", provider: "anthropic", model: "claude-opus-5" });
    expect(out.usage.steps).toBe(2);
    expect(out.costUsd).toBeGreaterThan(0);
  });

  it("returns an error tool_result for unknown tools and re-issues a turn whose tool JSON could not be parsed", async () => {
    scripts.push({ throws: new SyntaxError("Unexpected token in JSON") });
    const bad = { type: "tool_use", id: "toolu_x", name: "drop_database", input: {} };
    scripts.push({ events: [], final: { model: "claude-opus-5", stop_reason: "tool_use", usage, content: [bad] } });
    scripts.push({ events: [], final: { model: "claude-opus-5", stop_reason: "end_turn", usage, content: [{ type: "text", text: "ok" }] } });
    const executeTool = vi.fn();
    const { turn, events } = makeTurn(executeTool);
    await runAnthropicTurn(turn, { apiKey: "sk-test", model: "claude-opus-5" });
    expect(requests).toHaveLength(3);
    expect(executeTool).not.toHaveBeenCalled();
    const msgs = requests[2]!.messages as { role: string; content: { type: string; is_error?: boolean }[] }[];
    expect(msgs[msgs.length - 1]!.content[0]).toMatchObject({ type: "tool_result", is_error: true });
    expect(events.some((e) => e.type === "tool_result" && e.isError)).toBe(true);
  });

  it("stops on refusal without running tools and surfaces a notice", async () => {
    scripts.push({
      events: [],
      final: { model: "claude-opus-5", stop_reason: "refusal", usage, content: [{ type: "tool_use", id: "t", name: "get_visibility_metrics", input: {} }] },
    });
    const executeTool = vi.fn();
    const { turn, events } = makeTurn(executeTool);
    await runAnthropicTurn(turn, { apiKey: "sk-test", model: "claude-opus-5" });
    expect(executeTool).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "notice" && e.tone === "warning")).toBe(true);
  });

  it("does not echo blocks of a declined model before a fallback marker", async () => {
    const declined = { type: "tool_use", id: "toolu_old", name: "get_visibility_metrics", input: {} };
    const fresh = { type: "tool_use", id: "toolu_new", name: "get_visibility_metrics", input: { timeframeDays: 7 } };
    scripts.push({
      events: [],
      final: {
        model: "claude-opus-4-8",
        stop_reason: "tool_use",
        usage,
        content: [
          { type: "thinking", thinking: "x", signature: "s" },
          declined,
          { type: "fallback", from: { model: "claude-opus-5" }, to: { model: "claude-opus-4-8" } },
          fresh,
        ],
      },
    });
    scripts.push({ events: [], final: { model: "claude-opus-4-8", stop_reason: "end_turn", usage, content: [{ type: "text", text: "done" }] } });
    const executeTool = vi.fn(async () => ({ modelText: "ok", output: "ok", data: null, isError: false }));
    const { turn } = makeTurn(executeTool);
    const out = await runAnthropicTurn(turn, { apiKey: "sk-test", model: "claude-opus-5" });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith("get_visibility_metrics", { timeframeDays: 7 });
    const msgs = requests[1]!.messages as { role: string; content: { type: string; id?: string }[] }[];
    const echoed = msgs[msgs.length - 2]!.content.map((b) => b.type + (b.id ? `:${b.id}` : ""));
    expect(echoed).toEqual(["fallback", "tool_use:toolu_new"]);
    expect(out.runtime.model).toBe("claude-opus-4-8");
  });
});
