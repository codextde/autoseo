"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, FileText, FileSpreadsheet, Loader2, Mic, MicOff, Paperclip, Square, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ATTACHMENT_LIMITS, MAX_ATTACHMENTS_PER_MESSAGE, MAX_MESSAGE_CHARS, formatBytes, guessAttachmentKind } from "../lib/limits";
import { deleteDraftAttachment, uploadAttachment } from "../lib/client";
import type { ChatAttachmentRef, ModelOptionsView } from "../types";
import { ModelSelector } from "./model-selector";
import { useSpeechDictation } from "./use-speech";
import { useTypewriter } from "./use-typewriter";

type Draft = {
  localId: string;
  name: string;
  size: number;
  kind: ChatAttachmentRef["kind"];
  previewUrl: string | null;
  status: "uploading" | "ready" | "error";
  ref?: ChatAttachmentRef;
  error?: string;
  abort: AbortController;
};

export type ComposerHandle = { focus: () => void; setText: (text: string) => void };

let seq = 0;

/**
 * Chat composer: auto-growing textarea (Enter / ⌘↵ to send), attachments (button, paste, drag &
 * drop; uploaded immediately), voice dictation, model selector and Send / Stop.
 */
export const Composer = forwardRef<
  ComposerHandle,
  {
    projectId: string;
    onSubmit: (text: string, attachments: ChatAttachmentRef[]) => Promise<boolean> | boolean;
    onStop?: () => void;
    busy?: boolean;
    disabled?: boolean;
    disabledReason?: string;
    /** Static placeholder, or several lines shown with a typewriter animation while the composer is idle. */
    placeholder: string | string[];
    model: string;
    onModelChange: (id: string) => void;
    modelOptions: ModelOptionsView;
    speechLang?: string;
    autoFocus?: boolean;
    className?: string;
  }
>(function Composer(props, ref) {
  const { projectId, onSubmit, onStop, busy, disabled, placeholder, model, onModelChange, modelOptions } = props;
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState(false);
  const lines = Array.isArray(placeholder) ? placeholder : null;
  const typed = useTypewriter(lines ?? [], !!lines && !focused && !text && !disabled);
  const placeholderText = Array.isArray(placeholder) ? typed || "Ask me anything…" : placeholder;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dictationBase = useRef("");
  const dragDepth = useRef(0);

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    setText: (t: string) => {
      setText(t);
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(t.length, t.length);
      });
    },
  }));

  const speech = useSpeechDictation({
    lang: props.speechLang,
    onUpdate: (finalText, interim) => {
      const base = dictationBase.current;
      const spoken = `${finalText}${interim}`.trim();
      setText(spoken ? `${base}${base && !/\s$/.test(base) ? " " : ""}${spoken}` : base);
    },
  });

  useEffect(() => {
    if (speech.error) toast.error(speech.error);
  }, [speech.error]);

  // Auto-grow.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  useEffect(() => {
    if (props.autoFocus && window.matchMedia("(pointer: fine)").matches) taRef.current?.focus();
  }, [props.autoFocus]);

  // Revoke preview URLs on unmount.
  const draftsRef = useRef<Draft[]>([]);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  useEffect(() => () => draftsRef.current.forEach((d) => d.previewUrl && URL.revokeObjectURL(d.previewUrl)), []);

  const addFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      const room = MAX_ATTACHMENTS_PER_MESSAGE - draftsRef.current.length;
      if (room <= 0) {
        toast.error(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
        return;
      }
      for (const file of files.slice(0, room)) {
        const kind = guessAttachmentKind(file);
        if (!kind) {
          toast.error(`${file.name}: unsupported file type. Attach images, PDFs, CSV or text files.`);
          continue;
        }
        if (file.size > ATTACHMENT_LIMITS.maxBytes[kind]) {
          toast.error(`${file.name} is too large (max ${formatBytes(ATTACHMENT_LIMITS.maxBytes[kind])}).`);
          continue;
        }
        const draft: Draft = {
          localId: `d${++seq}`,
          name: file.name,
          size: file.size,
          kind,
          previewUrl: kind === "image" ? URL.createObjectURL(file) : null,
          status: "uploading",
          abort: new AbortController(),
        };
        setDrafts((d) => [...d, draft]);
        uploadAttachment(projectId, file, draft.abort.signal)
          .then((ref) => setDrafts((d) => d.map((x) => (x.localId === draft.localId ? { ...x, status: "ready", ref, kind: ref.kind } : x))))
          .catch((err: Error) => {
            if (draft.abort.signal.aborted) return;
            setDrafts((d) => d.map((x) => (x.localId === draft.localId ? { ...x, status: "error", error: err.message } : x)));
            toast.error(`${file.name}: ${err.message}`);
          });
      }
      if (files.length > room) toast.error(`Only ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
    },
    [projectId],
  );

  const removeDraft = (d: Draft) => {
    d.abort.abort();
    if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
    if (d.ref) void deleteDraftAttachment(projectId, d.ref.id);
    setDrafts((list) => list.filter((x) => x.localId !== d.localId));
  };

  const uploading = drafts.some((d) => d.status === "uploading");
  const canSend = !disabled && !busy && !submitting && !uploading && (text.trim().length > 0 || drafts.some((d) => d.status === "ready"));

  const submit = async () => {
    if (!canSend) return;
    if (speech.listening) speech.stop();
    const refs = drafts.filter((d) => d.status === "ready" && d.ref).map((d) => d.ref!);
    const value = text;
    setSubmitting(true);
    try {
      const ok = await onSubmit(value.trim(), refs);
      if (ok) {
        setText("");
        drafts.forEach((d) => d.previewUrl && URL.revokeObjectURL(d.previewUrl));
        setDrafts([]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (mod || (!e.shiftKey && !coarse)) {
      e.preventDefault();
      void submit();
    }
  };

  const toggleVoice = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    dictationBase.current = text;
    speech.start();
  };

  return (
    <div
      className={cn(
        "relative rounded-3xl border bg-card shadow-soft transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:shadow-md",
        dragging && "border-brand ring-4 ring-brand/15",
        disabled && "opacity-70",
        props.className,
      )}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files") || disabled) return;
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files") && !disabled) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length || disabled) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-3xl bg-brand-soft/80 text-sm font-medium text-brand backdrop-blur-[1px]"
          >
            <Upload className="size-4" /> Drop files to attach
          </motion.div>
        )}
      </AnimatePresence>

      {drafts.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pt-3 scrollbar-none">
          {drafts.map((d) => (
            <div
              key={d.localId}
              className={cn(
                "group/att relative flex h-14 max-w-[13rem] shrink-0 items-center gap-2 rounded-xl border bg-background pr-7 pl-1.5",
                d.status === "error" && "border-destructive/40",
              )}
              title={d.error ?? d.name}
            >
              {d.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.previewUrl} alt="" className="size-11 rounded-lg object-cover" />
              ) : (
                <span className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  {d.kind === "csv" ? <FileSpreadsheet className="size-5" /> : <FileText className="size-5" />}
                </span>
              )}
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-medium">{d.name}</span>
                <span className={cn("text-[11px] text-muted-foreground", d.status === "error" && "text-destructive")}>
                  {d.status === "uploading" ? "Uploading…" : d.status === "error" ? "Failed" : `${d.kind.toUpperCase()} · ${formatBytes(d.size)}`}
                </span>
              </span>
              {d.status === "uploading" && <Loader2 className="absolute top-1.5 right-1.5 size-3.5 animate-spin text-muted-foreground" />}
              {d.status !== "uploading" && (
                <button
                  type="button"
                  onClick={() => removeDraft(d)}
                  className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Remove ${d.name}`}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files ?? []);
          if (files.length) {
            e.preventDefault();
            addFiles(files);
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={1}
        disabled={disabled}
        placeholder={placeholderText}
        aria-label="Message"
        className="block max-h-60 min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
      />

      <div className="flex items-center gap-1 px-2 pt-1 pb-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ATTACHMENT_LIMITS.accept}
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-8 rounded-full text-muted-foreground" onClick={() => fileRef.current?.click()} disabled={disabled} aria-label="Attach files">
              <Paperclip className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Attach images, PDFs, CSV or text</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("size-8 rounded-full text-muted-foreground", speech.listening && "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive")}
                onClick={toggleVoice}
                disabled={disabled || !speech.supported}
                aria-label={speech.listening ? "Stop dictation" : "Voice input"}
                aria-pressed={speech.listening}
              >
                {speech.listening ? (
                  <span className="relative flex">
                    <span className="absolute inset-0 animate-ping rounded-full bg-destructive/30" />
                    <MicOff className="relative size-4" />
                  </span>
                ) : (
                  <Mic className="size-4" />
                )}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{speech.supported ? (speech.listening ? "Stop dictation" : "Dictate") : "Voice input isn't supported in this browser"}</TooltipContent>
        </Tooltip>
        <ModelSelector value={model} onChange={onModelChange} options={modelOptions} disabled={disabled} />
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11px] text-muted-foreground sm:inline">{busy ? "" : "↵ send · ⇧↵ new line"}</span>
          {busy ? (
            <Button type="button" size="icon" className="size-9 rounded-full" onClick={onStop} aria-label="Stop answering">
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button type="button" size="icon" className="size-9 rounded-full" onClick={() => void submit()} disabled={!canSend} aria-label="Send message">
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </Button>
          )}
        </div>
      </div>
      {disabled && props.disabledReason && <div className="border-t px-4 py-2 text-xs text-muted-foreground">{props.disabledReason}</div>}
    </div>
  );
});
