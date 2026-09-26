/**
 * Chat ("Agent" mode) types shared by the server (orchestrator, SSE endpoint, DB) and the client.
 * Keep this file isomorphic — no server imports.
 */

export type ChatRole = "user" | "assistant";

export type ChatAttachmentKind = "image" | "pdf" | "csv" | "text";

export type ChatAttachmentRef = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: ChatAttachmentKind;
};

export type ChatCitation = { url: string; title?: string };

export type ToolCallState = "running" | "success" | "error";

/** Structured message content. Assistant messages interleave thinking, text and tool calls in order. */
export type ChatPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; startedAt?: number; durationMs?: number; done?: boolean }
  | {
      type: "tool_call";
      id: string;
      name: string;
      title?: string;
      input?: unknown;
      state: ToolCallState;
      /** Agent-readable result text (markdown), truncated for storage. */
      output?: string;
      /** Structured payload (MCP `structuredContent`), truncated for storage. */
      data?: unknown;
      error?: string;
      /** "autoseo" = our MCP tool registry, "external" = the agent's own tools / other MCP servers, "server" = provider-side (web search). */
      source?: "autoseo" | "external" | "server";
      startedAt?: number;
      durationMs?: number;
    }
  | { type: "attachment"; attachment: ChatAttachmentRef }
  | { type: "citations"; items: ChatCitation[] }
  | { type: "notice"; tone: "info" | "warning"; text: string };

export type ChatMessageStatus = "streaming" | "complete" | "stopped" | "error";

/** Which runtime answered: a local CLI agent or an API provider. */
export type ChatRuntimeInfo = {
  kind: "agent" | "api";
  /** "claude" | "codex" for agents, "anthropic" | "openai" | "openrouter" for APIs. */
  provider: string;
  model?: string | null;
  agentId?: string | null;
  agentName?: string | null;
};

export type ChatUsageInfo = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  durationMs?: number;
  steps?: number;
};

export type ChatMessageView = {
  id: string;
  chatId: string;
  role: ChatRole;
  parts: ChatPart[];
  status: ChatMessageStatus;
  error: string | null;
  runtime: ChatRuntimeInfo | null;
  modelSelection: string | null;
  usage: ChatUsageInfo | null;
  feedback: "up" | "down" | null;
  createdAt: string;
};

export type ChatSummary = {
  id: string;
  title: string;
  pinned: boolean;
  lastMessageAt: string;
  createdAt: string;
  streaming: boolean;
};

export type ChatSearchHit = ChatSummary & { snippet: string | null };

export type ChatUsageMeter = {
  monthLabel: string;
  agentRuns: number;
  apiCalls: number;
  apiCostUsd: number;
  budgetUsd: number | null;
  /** Chat messages answered this month by this user (local vs API). */
  chatAgentMessages: number;
  chatApiMessages: number;
};

/* ───────────────────────────── Model selection ───────────────────────────── */

/** "auto" | "agent:claude" | "agent:codex" | "api:anthropic" | "api:openai" | "api:openrouter" */
export type ModelSelection = string;

export type ModelOption = {
  id: ModelSelection;
  label: string;
  description: string;
  group: "auto" | "local" | "api";
  available: boolean;
  /** Why the option is unavailable / how it resolves right now. */
  status: string;
  model?: string | null;
  /** Short price hint, e.g. "Free (runs on your machine)" or "$5 / $25 per 1M tokens". */
  price?: string | null;
};

export type ModelOptionsView = {
  options: ModelOption[];
  defaultSelection: ModelSelection;
  /** Admin → AI Providers / Local Agents links shown under "Manage". */
  manage: { label: string; href: string }[];
};

/* ───────────────────────────── Streaming protocol ───────────────────────────── */

/** Events sent over SSE (`/api/chat/runs/<messageId>`) and applied with `applyChatEvent`. */
export type ChatStreamEvent =
  | { type: "snapshot"; message: ChatMessageView }
  | { type: "status"; phase: "connecting" | "queued" | "assigned" | "running" | "fallback"; text: string; runtime?: ChatRuntimeInfo }
  | { type: "runtime"; runtime: ChatRuntimeInfo }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string; at: number }
  | { type: "thinking_end"; at: number }
  | { type: "tool_call"; id: string; name: string; title?: string; input?: unknown; source?: "autoseo" | "external" | "server"; at: number }
  | { type: "tool_result"; id: string; output?: string; data?: unknown; isError?: boolean; error?: string; at: number }
  | { type: "citations"; items: ChatCitation[] }
  | { type: "notice"; tone: "info" | "warning"; text: string }
  | { type: "done"; message: ChatMessageView }
  | { type: "error"; message: string; retryable: boolean };
