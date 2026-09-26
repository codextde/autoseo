"use client";

import type { ChatAttachmentRef, ChatMessageView, ChatSearchHit, ChatStreamEvent, ChatSummary, ChatUsageMeter } from "../types";

/** Browser-side API helpers for the chat endpoints. */

export class ChatRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function readError(res: Response): Promise<ChatRequestError> {
  let msg = `Request failed (${res.status}).`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) msg = body.error;
  } catch {
    /* not JSON */
  }
  return new ChatRequestError(msg, res.status);
}

export type SendBody = {
  projectId: string;
  chatId: string | null;
  mode: "send" | "regenerate" | "edit";
  text: string;
  attachmentIds: string[];
  model: string;
  targetMessageId?: string | null;
};

export type SendResponse = { chat: ChatSummary; userMessage: ChatMessageView | null; assistantMessage: ChatMessageView };

export async function postMessage(body: SendBody): Promise<SendResponse> {
  const res = await fetch("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as SendResponse;
}

/**
 * Subscribes to an answer's SSE stream. Resolves when the stream ends (after `done`), rejects on
 * network errors (callers may resubscribe — the server replays a snapshot).
 */
export async function streamRun(projectId: string, messageId: string, onEvent: (ev: ChatStreamEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api/chat/runs/${encodeURIComponent(messageId)}?projectId=${encodeURIComponent(projectId)}`, {
    headers: { Accept: "text/event-stream" },
    cache: "no-store",
    signal,
  });
  if (!res.ok || !res.body) throw await readError(res);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as ChatStreamEvent);
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
}

export async function stopAnswer(projectId: string, messageId: string) {
  await fetch(`/api/chat/runs/${encodeURIComponent(messageId)}/stop?projectId=${encodeURIComponent(projectId)}`, { method: "POST" }).catch(() => null);
}

export async function uploadAttachment(projectId: string, file: File, signal?: AbortSignal): Promise<ChatAttachmentRef> {
  const form = new FormData();
  form.set("projectId", projectId);
  form.set("file", file, file.name);
  const res = await fetch("/api/chat/attachments", { method: "POST", body: form, signal });
  if (!res.ok) throw await readError(res);
  return ((await res.json()) as { attachment: ChatAttachmentRef }).attachment;
}

export async function deleteDraftAttachment(projectId: string, id: string) {
  await fetch(`/api/chat/attachments/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" }).catch(() => null);
}

export function attachmentUrl(projectId: string, id: string, download = false) {
  return `/api/chat/attachments/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}${download ? "&download=1" : ""}`;
}

export type ChatListResponse = { chats: ChatSummary[]; usage: ChatUsageMeter | null; canChat: boolean };

export async function fetchChatList(projectId: string, signal?: AbortSignal): Promise<ChatListResponse> {
  const res = await fetch(`/api/chat/chats?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store", signal });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as ChatListResponse;
}

export async function searchChatsRequest(projectId: string, q: string, signal?: AbortSignal): Promise<ChatSearchHit[]> {
  const res = await fetch(`/api/chat/chats?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(q)}`, { cache: "no-store", signal });
  if (!res.ok) throw await readError(res);
  return ((await res.json()) as { hits: ChatSearchHit[] }).hits;
}

/* ───────────────────────────── Cross-component signals ───────────────────────────── */

const CHATS_EVENT = "autoseo:chats-changed";

/** Tells the sidebar to reload the chat list (optionally with an optimistic upsert / removal). */
export function notifyChatsChanged(detail: { upsert?: ChatSummary; removeId?: string; poll?: boolean } = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHATS_EVENT, { detail }));
}

export function onChatsChanged(fn: (detail: { upsert?: ChatSummary; removeId?: string; poll?: boolean }) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent).detail ?? {});
  window.addEventListener(CHATS_EVENT, handler);
  return () => window.removeEventListener(CHATS_EVENT, handler);
}

/* ───────────────────────────── Model preference ───────────────────────────── */

const MODEL_KEY = "autoseo.chat.model";

export function loadModelPreference(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

export function saveModelPreference(model: string) {
  try {
    localStorage.setItem(MODEL_KEY, model);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(MODEL_EVENT));
}

const MODEL_EVENT = "autoseo:chat-model";

/** Subscribe helper for `useSyncExternalStore` over the stored model preference. */
export function subscribeModelPreference(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(MODEL_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(MODEL_EVENT, cb);
  };
}
