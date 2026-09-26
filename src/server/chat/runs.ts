import "server-only";
import { applyChatEvent } from "@/features/chat/lib/parts";
import type { ChatMessageView, ChatPart, ChatRuntimeInfo, ChatStreamEvent } from "@/features/chat/types";

/**
 * In-process registry of running chat turns. A turn runs detached from the HTTP request that
 * started it, so navigating away or reloading never kills an answer: clients (re)subscribe via
 * SSE and receive a snapshot of the parts so far followed by live events. Single-instance
 * deployment (like the in-memory rate limiter); kept on globalThis to survive dev hot reloads.
 */

export type ChatRun = {
  messageId: string;
  chatId: string;
  projectId: string;
  userId: string;
  parts: ChatPart[];
  runtime: ChatRuntimeInfo | null;
  status: { phase: string; text: string } | null;
  modelSelection: string;
  createdAt: string;
  startedAt: number;
  abort: AbortController;
  listeners: Set<(ev: ChatStreamEvent) => void>;
  final: ChatMessageView | null;
  finalError: { message: string; retryable: boolean } | null;
};

const g = globalThis as unknown as { __autoseoChatRuns?: Map<string, ChatRun> };
const runs: Map<string, ChatRun> = (g.__autoseoChatRuns ??= new Map());

/** How long a finished run stays subscribable (covers the gap between POST and the SSE connect). */
const KEEP_FINISHED_MS = 2 * 60_000;

export function getRun(messageId: string): ChatRun | undefined {
  return runs.get(messageId);
}

export function activeRunIds(): Set<string> {
  return new Set([...runs.values()].filter((r) => !r.final && !r.finalError).map((r) => r.messageId));
}

export function activeRunsForUser(userId: string): number {
  let n = 0;
  for (const r of runs.values()) if (r.userId === userId && !r.final && !r.finalError) n++;
  return n;
}

export function registerRun(input: Omit<ChatRun, "parts" | "runtime" | "status" | "abort" | "listeners" | "final" | "finalError" | "startedAt">): ChatRun {
  const run: ChatRun = {
    ...input,
    parts: [],
    runtime: null,
    status: null,
    startedAt: Date.now(),
    abort: new AbortController(),
    listeners: new Set(),
    final: null,
    finalError: null,
  };
  runs.set(run.messageId, run);
  return run;
}

/** Applies an event to the run state and fans it out to subscribers. */
export function publish(run: ChatRun, ev: ChatStreamEvent) {
  if (ev.type === "status") {
    run.status = { phase: ev.phase, text: ev.text };
    if (ev.runtime) run.runtime = ev.runtime;
  } else if (ev.type === "runtime") {
    run.runtime = ev.runtime;
  } else if (ev.type === "done") {
    run.final = ev.message;
    run.parts = ev.message.parts;
  } else if (ev.type === "error") {
    run.finalError = { message: ev.message, retryable: ev.retryable };
  } else {
    run.parts = applyChatEvent(run.parts, ev);
  }
  for (const l of run.listeners) {
    try {
      l(ev);
    } catch {
      /* a broken subscriber must not break the run */
    }
  }
  if (ev.type === "done" || ev.type === "error") {
    const t = setTimeout(() => {
      if (runs.get(run.messageId) === run) runs.delete(run.messageId);
    }, KEEP_FINISHED_MS);
    t.unref?.();
  }
}

export function snapshot(run: ChatRun): ChatMessageView {
  if (run.final) return run.final;
  return {
    id: run.messageId,
    chatId: run.chatId,
    role: "assistant",
    parts: run.parts,
    status: run.finalError ? "error" : "streaming",
    error: run.finalError?.message ?? null,
    runtime: run.runtime,
    modelSelection: run.modelSelection,
    usage: null,
    feedback: null,
    createdAt: run.createdAt,
  };
}

export function subscribe(run: ChatRun, listener: (ev: ChatStreamEvent) => void): () => void {
  run.listeners.add(listener);
  return () => run.listeners.delete(listener);
}

export function stopRun(messageId: string, userId: string): boolean {
  const run = runs.get(messageId);
  if (!run || run.userId !== userId || run.final || run.finalError) return false;
  run.abort.abort();
  return true;
}
