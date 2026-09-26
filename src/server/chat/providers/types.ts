import "server-only";
import type { ChatRuntimeInfo, ChatStreamEvent, ChatUsageInfo } from "@/features/chat/types";
import type { LoadedAttachment } from "../attachments";
import type { ChatSystemPrompt } from "../context";
import type { ChatToolOutcome, ChatToolSpec } from "../tools";

/** One prior or current message of the conversation, as sent to a model. */
export type TranscriptMessage = {
  role: "user" | "assistant";
  text: string;
  attachments: LoadedAttachment[];
};

export type ProviderTurn = {
  system: ChatSystemPrompt;
  /** Full conversation; the last entry is the user message being answered. */
  transcript: TranscriptMessage[];
  tools: ChatToolSpec[];
  executeTool: (name: string, input: unknown) => Promise<ChatToolOutcome>;
  emit: (ev: ChatStreamEvent) => void;
  signal: AbortSignal;
};

export type ProviderOutcome = {
  runtime: ChatRuntimeInfo;
  usage: ChatUsageInfo;
  /** Cost to record in usage_events (0 for local agents). */
  costUsd: number;
  units: number;
};

/** Raised by a provider before it produced any output — the orchestrator may try the next one. */
export class ProviderUnavailableError extends Error {}

export class ChatAbortedError extends Error {
  constructor() {
    super("Stopped");
  }
}

export const MAX_TOOL_STEPS = 24;
