"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, LayoutGrid, Presentation } from "lucide-react";
import { toast } from "sonner";
import { AgentOrb } from "@/components/agent-ui";
import { cn } from "@/lib/utils";
import { examplePrompts, placeholderLines, reportKickoff, type ExampleContext } from "../lib/examples";
import { loadModelPreference, notifyChatsChanged, postMessage, saveModelPreference, subscribeModelPreference } from "../lib/client";
import type { ChatAttachmentRef, ModelOptionsView } from "../types";
import { Composer, type ComposerHandle } from "./composer";
import { ExamplesDialog } from "./examples-dialog";

function SuggestionCard({
  icon: Icon,
  title,
  description,
  onClick,
  disabled,
  extra,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className="group relative flex items-start gap-3 rounded-2xl border bg-card p-4 text-left shadow-soft transition-colors hover:border-foreground/15 hover:bg-muted/30">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <button type="button" onClick={onClick} disabled={disabled} className="text-left text-sm font-medium after:absolute after:inset-0 after:rounded-2xl disabled:cursor-not-allowed disabled:opacity-60">
          {title}
        </button>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{description}</span>
        {extra && <span className="relative z-10 mt-1.5 block">{extra}</span>}
      </span>
      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
    </div>
  );
}

/** Agent mode home: greeting with the dotted orb, composer and the two suggestion cards. */
export function AgentHome({
  projectId,
  userName,
  modelOptions,
  canChat,
  examples,
  routeHint,
}: {
  projectId: string;
  userName: string;
  modelOptions: ModelOptionsView;
  canChat: boolean;
  examples: ExampleContext;
  routeHint: string;
}) {
  const router = useRouter();
  const composer = useRef<ComposerHandle>(null);
  const pref = useSyncExternalStore(subscribeModelPreference, loadModelPreference, () => null);
  const model = pref && modelOptions.options.some((o) => o.id === pref) ? pref : modelOptions.defaultSelection;
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const categories = useMemo(() => examplePrompts(examples), [examples]);
  const lines = useMemo(() => placeholderLines(examples), [examples]);

  const start = async (text: string, attachments: ChatAttachmentRef[]) => {
    setStarting(true);
    try {
      const res = await postMessage({ projectId, chatId: null, mode: "send", text, attachmentIds: attachments.map((a) => a.id), model });
      notifyChatsChanged({ upsert: res.chat, poll: true });
      router.push(`/p/${projectId}/agent/c/${res.chat.id}`);
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      setStarting(false);
      return false;
    }
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-8 pb-[max(env(safe-area-inset-bottom),1rem)] sm:justify-center sm:pt-10 sm:pb-20">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="order-1 flex flex-col items-center text-center"
        >
          <AgentOrb size={96} state={starting ? "thinking" : canChat ? "idle" : "offline"} title="AutoSEO agent" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Hi, {userName}! How can I help you?
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">{routeHint}</p>
        </motion.div>

        <div className="order-3 mt-auto pt-6 sm:order-2 sm:mt-8 sm:pt-0">
          <Composer
            ref={composer}
            projectId={projectId}
            onSubmit={start}
            busy={false}
            disabled={!canChat || starting}
            disabledReason={canChat ? undefined : "You have read-only access to this project — ask a workspace admin for the “Add prompts, run the agent” permission to chat."}
            placeholder={canChat ? lines : "Ask me anything…"}
            model={model}
            onModelChange={saveModelPreference}
            modelOptions={modelOptions}
            autoFocus
          />
        </div>

        <div className={cn("order-2 mt-8 grid gap-3 sm:order-3 sm:mt-6 sm:grid-cols-2")}>
          <SuggestionCard
            icon={LayoutGrid}
            title="Browse example prompts"
            description="Visibility across every AI engine, competitor gaps, keywords, audits and more."
            onClick={() => setExamplesOpen(true)}
          />
          <SuggestionCard
            icon={Presentation}
            title="Build a report"
            description="Turn your data into a branded report or pitch — the agent guides you."
            onClick={() => void start(reportKickoff(examples.name), [])}
            disabled={!canChat || starting}
            extra={
              <Link href={`/p/${projectId}/reports`} className="text-xs font-medium text-brand hover:underline">
                Open Report Builder →
              </Link>
            }
          />
        </div>
      </div>
      <ExamplesDialog open={examplesOpen} onOpenChange={setExamplesOpen} categories={categories} onPick={(p) => composer.current?.setText(p)} />
    </div>
  );
}
