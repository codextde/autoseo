"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { chatFeedbackAction } from "../actions";
import { applyChatEvent } from "../lib/parts";
import { notifyChatsChanged, postMessage, saveModelPreference, stopAnswer, streamRun, type SendBody } from "../lib/client";
import type { ChatAttachmentRef, ChatMessageView, ChatStreamEvent, ModelOptionsView } from "../types";
import { Composer } from "./composer";
import { AssistantMessage, UserMessage } from "./message-item";

function reduceMessage(m: ChatMessageView, ev: ChatStreamEvent): ChatMessageView {
  switch (ev.type) {
    case "snapshot":
    case "done":
      return { ...ev.message, feedback: ev.message.feedback ?? m.feedback };
    case "runtime":
      return { ...m, runtime: ev.runtime };
    case "status":
      return ev.runtime ? { ...m, runtime: ev.runtime } : m;
    case "error":
      return { ...m, status: "error", error: ev.message };
    default:
      return { ...m, parts: applyChatEvent(m.parts, ev) };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Conversation view: streamed answers (SSE, resumable), message actions and the pinned composer. */
export function ChatView({
  projectId,
  chatId,
  initialMessages,
  initialModel,
  modelOptions,
  canChat,
  placeholder,
}: {
  projectId: string;
  chatId: string;
  initialMessages: ChatMessageView[];
  initialModel: string;
  modelOptions: ModelOptionsView;
  canChat: boolean;
  placeholder: string;
}) {
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages);
  const [activeId, setActiveId] = useState<string | null>(() => {
    const last = initialMessages[initialMessages.length - 1];
    return last?.role === "assistant" && last.status === "streaming" ? last.id : null;
  });
  const [statusText, setStatusText] = useState<string | null>(null);
  const [model, setModel] = useState(initialModel);
  const [atBottom, setAtBottom] = useState(true);
  const streamAbort = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const changeModel = (id: string) => {
    setModel(id);
    saveModelPreference(id);
  };

  /* ── Streaming ── */
  /** Subscribes to an answer's SSE stream (state only changes from stream callbacks). */
  const subscribeStream = useCallback(
    (messageId: string) => {
      streamAbort.current?.abort();
      const ac = new AbortController();
      streamAbort.current = ac;
      let finished = false;
      const apply = (ev: ChatStreamEvent) => {
        if (ev.type === "status") setStatusText(ev.text);
        setMessages((prev) => prev.map((m) => (m.id === messageId ? reduceMessage(m, ev) : m)));
        if (ev.type === "done" || ev.type === "error") {
          finished = true;
          setActiveId((cur) => (cur === messageId ? null : cur));
          setStatusText(null);
          notifyChatsChanged({ poll: true });
        }
      };
      void (async () => {
        let failures = 0;
        while (!ac.signal.aborted && !finished) {
          try {
            await streamRun(projectId, messageId, apply, ac.signal);
            if (!finished) await sleep(400);
          } catch (err) {
            if (ac.signal.aborted) return;
            failures++;
            if (failures > 5 || (err as { status?: number }).status === 404) {
              apply({ type: "error", message: "Lost the connection to this answer. Reload the page to see the result.", retryable: true });
              return;
            }
            setStatusText("Reconnecting…");
            await sleep(Math.min(8000, 700 * failures));
          }
        }
      })();
    },
    [projectId],
  );

  const follow = (messageId: string) => {
    setActiveId(messageId);
    subscribeStream(messageId);
  };

  useEffect(() => {
    const last = initialMessages[initialMessages.length - 1];
    if (last?.role === "assistant" && last.status === "streaming") subscribeStream(last.id);
    return () => streamAbort.current?.abort();
    // Resume only the answer that was running when the page loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Scrolling ── */
  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  useLayoutEffect(() => {
    scrollToBottom();
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) scrollToBottom();
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = dist < 96;
    setAtBottom(dist < 96);
  };

  /* ── Actions ── */
  const post = async (body: Omit<SendBody, "projectId" | "chatId" | "model">) => {
    const res = await postMessage({ ...body, projectId, chatId, model });
    notifyChatsChanged({ upsert: res.chat });
    return res;
  };

  const send = async (text: string, attachments: ChatAttachmentRef[]) => {
    try {
      const res = await post({ mode: "send", text, attachmentIds: attachments.map((a) => a.id) });
      setMessages((prev) => [...prev, ...(res.userMessage ? [res.userMessage] : []), res.assistantMessage]);
      stick.current = true;
      requestAnimationFrame(() => scrollToBottom(true));
      follow(res.assistantMessage.id);
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    }
  };

  const regenerate = async () => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    try {
      const res = await post({ mode: "regenerate", text: "", attachmentIds: [], targetMessageId: lastAssistant?.id ?? null });
      setMessages((prev) => {
        const idx = prev.findLastIndex((m) => m.role === "user");
        return [...prev.slice(0, idx + 1), res.assistantMessage];
      });
      stick.current = true;
      follow(res.assistantMessage.id);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const edit = async (messageId: string, text: string) => {
    try {
      const res = await post({ mode: "edit", text, attachmentIds: [], targetMessageId: messageId });
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId);
        return [...prev.slice(0, idx), ...(res.userMessage ? [res.userMessage] : []), res.assistantMessage];
      });
      stick.current = true;
      follow(res.assistantMessage.id);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const stop = () => {
    if (activeId) void stopAnswer(projectId, activeId);
  };

  const feedback = async (messageId: string, rating: "up" | "down" | null, comment?: string) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: rating } : m)));
    const res = await chatFeedbackAction(projectId, messageId, rating, comment ?? null);
    if (!res.ok) toast.error(res.error);
    else if (rating === "up" || comment) toast.success("Thanks for the feedback!");
  };

  const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
  const busy = activeId !== null;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div ref={contentRef} className="mx-auto w-full max-w-3xl space-y-8 px-4 pt-6 pb-10 sm:px-6 sm:pt-8">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <UserMessage
                key={m.id}
                message={m}
                projectId={projectId}
                canEdit={canChat && !busy && i === lastUserIdx}
                onEdit={(text) => void edit(m.id, text)}
              />
            ) : (
              <AssistantMessage
                key={m.id}
                message={m}
                statusText={m.id === activeId ? statusText : null}
                isLast={i === messages.length - 1}
                canAct={canChat && !busy}
                onRegenerate={() => void regenerate()}
                onFeedback={(r, c) => void feedback(m.id, r, c)}
              />
            ),
          )}
        </div>
      </div>

      <div className="relative shrink-0 px-3 pt-1 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-6">
        <AnimatePresence>
          {!atBottom && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="pointer-events-none absolute -top-12 left-0 flex w-full justify-center"
            >
              <Button
                size="sm"
                variant="outline"
                className="pointer-events-auto gap-1.5 rounded-full bg-background shadow-soft"
                onClick={() => {
                  stick.current = true;
                  scrollToBottom(true);
                }}
              >
                <ArrowDown className="size-3.5" /> Jump to latest
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="mx-auto max-w-3xl">
          <Composer
            projectId={projectId}
            onSubmit={send}
            onStop={stop}
            busy={busy}
            disabled={!canChat}
            disabledReason={canChat ? undefined : "You have read-only access to this project — ask a workspace admin for the “Add prompts, run the agent” permission to chat."}
            placeholder={placeholder}
            model={model}
            onModelChange={changeModel}
            modelOptions={modelOptions}
            autoFocus
          />
          <p className="mt-1.5 hidden text-center text-[11px] text-muted-foreground sm:block">
            The agent uses your project data and can make mistakes — double-check important numbers.
          </p>
        </div>
      </div>
    </div>
  );
}
