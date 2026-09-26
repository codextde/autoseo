"use client";

import { useEffect, useState } from "react";
import { fetchChatList, onChatsChanged, type ChatListResponse } from "../lib/client";
import type { ChatSummary } from "../types";

/** Sidebar chat list: loads on mount, reloads on change signals, polls while answers run / titles settle. */
export function useChatList(projectId: string) {
  const [data, setData] = useState<ChatListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ac: AbortController | null = null;
    let pollUntil = 0;

    const plan = (res: ChatListResponse) => {
      if (timer) clearTimeout(timer);
      const streaming = res.chats.some((c) => c.streaming);
      if (!streaming && Date.now() >= pollUntil) return;
      timer = setTimeout(tick, streaming ? 3000 : 2500);
    };
    async function tick() {
      ac?.abort();
      const current = new AbortController();
      ac = current;
      try {
        const res = await fetchChatList(projectId, current.signal);
        if (!alive) return;
        setData(res);
        setError(null);
        plan(res);
      } catch (err) {
        if (alive && (err as Error).name !== "AbortError") setError((err as Error).message);
      }
    }

    const first = setTimeout(tick, 0);
    const off = onChatsChanged((detail) => {
      if (detail.upsert || detail.removeId) {
        setData((prev) => {
          if (!prev) return prev;
          let chats: ChatSummary[] = prev.chats;
          if (detail.removeId) chats = chats.filter((c) => c.id !== detail.removeId);
          if (detail.upsert) {
            const u = detail.upsert;
            chats = chats.some((c) => c.id === u.id) ? chats.map((c) => (c.id === u.id ? { ...c, ...u } : c)) : [u, ...chats];
          }
          return { ...prev, chats };
        });
      }
      if (detail.poll) pollUntil = Date.now() + 25_000;
      void tick();
    });
    return () => {
      alive = false;
      off();
      ac?.abort();
      clearTimeout(first);
      if (timer) clearTimeout(timer);
    };
  }, [projectId]);

  return { data, error };
}

export type ChatGroup = { label: string; chats: ChatSummary[] };

/** Pinned first, then Today / Yesterday / Previous 7 days / Previous 30 days / Older. */
export function groupChats(chats: ChatSummary[], now = new Date()): ChatGroup[] {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const buckets: ChatGroup[] = [
    { label: "Pinned", chats: [] },
    { label: "Today", chats: [] },
    { label: "Yesterday", chats: [] },
    { label: "Previous 7 days", chats: [] },
    { label: "Previous 30 days", chats: [] },
    { label: "Older", chats: [] },
  ];
  const sorted = [...chats].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  for (const c of sorted) {
    const t = new Date(c.lastMessageAt).getTime();
    const idx = c.pinned ? 0 : t >= startOfDay ? 1 : t >= startOfDay - day ? 2 : t >= startOfDay - 7 * day ? 3 : t >= startOfDay - 30 * day ? 4 : 5;
    buckets[idx]!.chats.push(c);
  }
  return buckets.filter((b) => b.chats.length);
}
