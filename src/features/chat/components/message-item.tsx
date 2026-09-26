"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  AlertTriangle,
  Check,
  Copy,
  FileSpreadsheet,
  FileText,
  Info,
  Pencil,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { AgentOrb, ThinkingState, formatDuration } from "@/components/agent-ui";
import { Favicon, cleanDomain } from "@/components/app/favicon";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { partsAttachments, partsText } from "../lib/parts";
import { attachmentUrl } from "../lib/client";
import { formatBytes } from "../lib/limits";
import type { ChatCitation, ChatMessageView, ChatPart, ChatRuntimeInfo } from "../types";
import { Markdown } from "./markdown";
import { ChatToolCall } from "./tool-call";

function IconAction({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-7 rounded-lg text-muted-foreground hover:text-foreground", active && "text-foreground")}
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconAction
      label={copied ? "Copied" : "Copy"}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => toast.error("Could not copy to the clipboard."),
        );
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </IconAction>
  );
}

export function runtimeLabel(rt: ChatRuntimeInfo | null): string | null {
  if (!rt) return null;
  if (rt.kind === "agent") {
    const name = rt.provider === "codex" ? "Codex" : "Claude Code";
    return `${name}${rt.agentName ? ` · ${rt.agentName}` : ""}${rt.model ? ` · ${rt.model}` : ""}`;
  }
  const p = rt.provider === "anthropic" ? "Anthropic API" : rt.provider === "openai" ? "OpenAI API" : rt.provider === "openrouter" ? "OpenRouter" : rt.provider;
  return `${p}${rt.model ? ` · ${rt.model}` : ""}`;
}

/** Thumbs down that also asks (optionally) what went wrong. */
function DownvoteAction({ active, onRate }: { active: boolean; onRate: (rating: "down" | null, comment?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <IconAction
            label="Bad answer"
            active={active}
            onClick={() => {
              if (active) {
                onRate(null);
                return;
              }
              onRate("down");
              setOpen(true);
            }}
          >
            <ThumbsDown className={cn("size-3.5", active && "fill-current")} />
          </IconAction>
        </span>
      </PopoverAnchor>
      <PopoverContent side="top" align="start" className="w-[min(20rem,calc(100vw-2rem))] space-y-2 p-3">
        <div className="text-sm font-medium">What went wrong?</div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 2000))}
          rows={3}
          placeholder="Wrong numbers, missing data, not helpful… (optional)"
          className="w-full resize-none rounded-lg border bg-background px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Skip
          </Button>
          <Button
            size="sm"
            disabled={!comment.trim()}
            onClick={() => {
              onRate("down", comment.trim());
              setComment("");
              setOpen(false);
            }}
          >
            Send
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ───────────────────────────── User message ───────────────────────────── */

export function UserMessage({
  message,
  projectId,
  canEdit,
  onEdit,
}: {
  message: ChatMessageView;
  projectId: string;
  canEdit: boolean;
  onEdit: (text: string) => void;
}) {
  const text = partsText(message.parts);
  const atts = partsAttachments(message.parts);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  return (
    <div className="group/msg flex flex-col items-end gap-1.5">
      {atts.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {atts.map((a) =>
            a.kind === "image" ? (
              <a key={a.id} href={attachmentUrl(projectId, a.id)} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachmentUrl(projectId, a.id)} alt={a.name} className="h-28 max-w-[14rem] object-cover" loading="lazy" />
              </a>
            ) : (
              <a
                key={a.id}
                href={attachmentUrl(projectId, a.id, a.kind !== "pdf")}
                target="_blank"
                rel="noreferrer"
                className="flex max-w-[15rem] items-center gap-2 rounded-xl border bg-card px-2.5 py-2 text-left hover:bg-muted/50"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  {a.kind === "csv" ? <FileSpreadsheet className="size-4" /> : <FileText className="size-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{a.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {a.kind.toUpperCase()} · {formatBytes(a.size)}
                  </span>
                </span>
              </a>
            ),
          )}
        </div>
      )}
      {editing ? (
        <div className="w-full max-w-[85%] rounded-2xl border bg-card p-2 shadow-soft">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(8, Math.max(2, draft.split("\n").length))}
            autoFocus
            aria-label="Edit message"
            className="w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-relaxed outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) {
                setEditing(false);
                onEdit(draft.trim());
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!draft.trim() || draft.trim() === text}
              onClick={() => {
                setEditing(false);
                onEdit(draft.trim());
              }}
            >
              Save & resend
            </Button>
          </div>
        </div>
      ) : (
        text && (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-foreground">
            {text}
          </div>
        )
      )}
      {!editing && (
        <div className="flex gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover/msg:opacity-100 md:focus-within:opacity-100">
          {text && <CopyAction text={text} />}
          {canEdit && (
            <IconAction
              label="Edit"
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" />
            </IconAction>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Assistant message ───────────────────────────── */

function Sources({ items }: { items: ChatCitation[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 6);
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Sources</div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((c, i) => (
          <a
            key={c.url}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="flex max-w-[16rem] items-center gap-1.5 rounded-full border bg-card px-2 py-1 text-xs hover:bg-muted/60"
            title={c.title ?? c.url}
          >
            <span className="text-[10px] text-muted-foreground tabular">{i + 1}</span>
            <Favicon domain={cleanDomain(c.url)} className="size-3.5" />
            <span className="truncate">{c.title || cleanDomain(c.url)}</span>
          </a>
        ))}
        {items.length > 6 && !all && (
          <button type="button" onClick={() => setAll(true)} className="rounded-full border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60">
            +{items.length - 6} more
          </button>
        )}
      </div>
    </div>
  );
}

function PartView({ part, isLast, streaming }: { part: ChatPart; isLast: boolean; streaming: boolean }) {
  switch (part.type) {
    case "text":
      return <Markdown text={part.text} />;
    case "thinking":
      return (
        <ThinkingState active={streaming && isLast && !part.done} startedAt={part.startedAt} durationMs={part.durationMs}>
          {part.text || null}
        </ThinkingState>
      );
    case "tool_call":
      return <ChatToolCall part={part} />;
    case "citations":
      return <Sources items={part.items} />;
    case "notice":
      return (
        <div
          className={cn(
            "flex items-start gap-2 rounded-xl border px-3 py-2 text-xs",
            part.tone === "warning" ? "border-warning/40 bg-warning/10 text-foreground" : "bg-muted/40 text-muted-foreground",
          )}
        >
          {part.tone === "warning" ? <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" /> : <Info className="mt-px size-3.5 shrink-0" />}
          <span>{part.text}</span>
        </div>
      );
    default:
      return null;
  }
}

export function AssistantMessage({
  message,
  statusText,
  isLast,
  canAct,
  onRegenerate,
  onFeedback,
}: {
  message: ChatMessageView;
  statusText: string | null;
  isLast: boolean;
  canAct: boolean;
  onRegenerate: () => void;
  onFeedback: (rating: "up" | "down" | null, comment?: string) => void;
}) {
  const streaming = message.status === "streaming";
  const text = partsText(message.parts);
  const visibleParts = message.parts.filter((p) => p.type !== "attachment");
  // Keep sources at the end, after the answer text.
  const ordered = [...visibleParts.filter((p) => p.type !== "citations"), ...visibleParts.filter((p) => p.type === "citations")];
  const lastPart = ordered[ordered.length - 1];
  const waiting = streaming && (!lastPart || (lastPart.type === "tool_call" && lastPart.state !== "running") || lastPart.type === "notice" || (lastPart.type === "thinking" && lastPart.done));
  const label = runtimeLabel(message.runtime);
  const duration = message.usage?.durationMs ? formatDuration(message.usage.durationMs) : null;
  const cost = message.usage?.costUsd ? `$${message.usage.costUsd < 0.01 ? message.usage.costUsd.toFixed(4) : message.usage.costUsd.toFixed(2)}` : null;

  return (
    <div className="group/msg flex gap-3">
      <div className="hidden pt-0.5 sm:block">
        <AgentOrb size={28} state={streaming ? (lastPart?.type === "tool_call" ? "working" : "thinking") : message.status === "error" ? "error" : "idle"} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="sm:hidden">
            <AgentOrb size={18} state={streaming ? "thinking" : "idle"} />
          </span>
          <span className="font-medium text-foreground">Agent</span>
          {label && <span className="truncate">{label}</span>}
        </div>

        {ordered.map((p, i) => (
          <motion.div key={p.type === "tool_call" ? p.id : `${p.type}-${i}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="min-w-0">
            <PartView part={p} isLast={i === ordered.length - 1} streaming={streaming} />
          </motion.div>
        ))}

        {waiting && <ThinkingState active label={statusText ?? "Thinking…"} startedAt={Date.parse(message.createdAt)} />}

        {message.status === "error" && (
          <div className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm sm:flex-row sm:items-center">
            <AlertTriangle className="hidden size-4 shrink-0 text-destructive sm:block" />
            <span className="flex-1 text-foreground">{message.error ?? "Something went wrong."}</span>
            {isLast && canAct && (
              <Button size="sm" variant="outline" className="shrink-0 gap-1.5 bg-background" onClick={onRegenerate}>
                <RotateCcw className="size-3.5" /> Retry
              </Button>
            )}
          </div>
        )}
        {message.status === "stopped" && <div className="text-xs text-muted-foreground">Stopped{text ? "" : " before answering"}.</div>}

        {!streaming && (
          <div className="flex flex-wrap items-center gap-0.5 text-muted-foreground">
            {text && <CopyAction text={text} />}
            {isLast && canAct && (
              <IconAction label="Regenerate" onClick={onRegenerate}>
                <RotateCcw className="size-3.5" />
              </IconAction>
            )}
            {message.status !== "error" && (
              <>
                <IconAction label="Good answer" active={message.feedback === "up"} onClick={() => onFeedback(message.feedback === "up" ? null : "up")}>
                  <ThumbsUp className={cn("size-3.5", message.feedback === "up" && "fill-current")} />
                </IconAction>
                <DownvoteAction active={message.feedback === "down"} onRate={onFeedback} />
              </>
            )}
            {(duration || cost) && (
              <span className="ml-1.5 text-[11px] tabular">
                {[duration, cost].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
