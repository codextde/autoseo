"use client";

import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Brain, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSeconds, toTimestamp } from "./format";

/**
 * Reasoning indicator. While `active` it shows a shimmering "Thinking…" label with a live
 * elapsed-seconds counter; once finished it collapses to "Thought for Ns" and reveals the
 * reasoning text (`children`) on click.
 */
export function ThinkingState({
  active,
  durationMs,
  startedAt,
  label,
  children,
  defaultOpen = false,
  className,
}: {
  active: boolean;
  durationMs?: number;
  startedAt?: number | Date;
  label?: string;
  children?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const contentId = useId();
  const start = toTimestamp(startedAt);
  const [open, setOpen] = useState(defaultOpen);
  const [now, setNow] = useState(() => Date.now());
  // Only derive "Thought for Ns" from the clock when we witnessed the active phase ourselves.
  const [sawActive, setSawActive] = useState(active);
  if (active && !sawActive) setSawActive(true);

  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(timer);
      // Freeze the clock at the moment thinking ended.
      tick();
    };
  }, [active]);

  const elapsedMs = start != null ? Math.max(0, now - start) : null;
  const finalMs = durationMs ?? (sawActive && start != null ? Math.max(0, now - start) : null);
  const hasContent = children != null && children !== false && children !== "";

  if (active) {
    return (
      <div className={cn("flex min-w-0 items-center gap-2 py-1 text-sm", className)} role="status" aria-live="polite">
        <motion.span
          className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
          animate={reduceMotion ? undefined : { scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <Brain className="size-4" />
        </motion.span>
        <span className={cn("truncate font-medium", reduceMotion ? "text-muted-foreground" : "shimmer-text")}>
          {label ?? "Thinking…"}
        </span>
        {elapsedMs != null && (
          <span className="shrink-0 text-xs text-muted-foreground tabular">{Math.floor(elapsedMs / 1000)}s</span>
        )}
      </div>
    );
  }

  const title = finalMs != null ? `Thought for ${formatSeconds(finalMs)}` : (label ?? "Thought");

  return (
    <div className={cn("min-w-0 text-sm", className)}>
      {hasContent ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={contentId}
          className="group inline-flex max-w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Brain className="size-4 shrink-0" />
          <span className="truncate">{title}</span>
          <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-200", open && "rotate-90")} />
        </button>
      ) : (
        <div className="inline-flex max-w-full items-center gap-1.5 py-1 text-muted-foreground">
          <Brain className="size-4 shrink-0" />
          <span className="truncate">{title}</span>
        </div>
      )}
      <AnimatePresence initial={false}>
        {hasContent && open && (
          <motion.div
            id={contentId}
            key="thinking-content"
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-1 mb-2 ml-2 border-l-2 border-border pl-3 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
