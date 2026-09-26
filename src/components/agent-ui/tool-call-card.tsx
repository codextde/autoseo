"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, Circle, Loader2, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, stringifyValue } from "./format";

export type ToolCallStatus = "pending" | "running" | "success" | "error";

const STATUS_LABEL: Record<ToolCallStatus, string> = {
  pending: "Pending",
  running: "Running",
  success: "Done",
  error: "Failed",
};

function StatusIndicator({ status }: { status: ToolCallStatus }) {
  const label = STATUS_LABEL[status];
  if (status === "running")
    return (
      <span className="flex size-5 items-center justify-center text-info" role="status" aria-label={label}>
        <Loader2 className="size-4 animate-spin" />
      </span>
    );
  if (status === "success")
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-success/12 text-success" aria-label={label}>
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  if (status === "error")
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-destructive/12 text-destructive" aria-label={label}>
        <X className="size-3" strokeWidth={3} />
      </span>
    );
  return (
    <span className="flex size-5 items-center justify-center text-muted-foreground/70" aria-label={label}>
      <Circle className="size-3.5" strokeDasharray="3 3" />
    </span>
  );
}

function ValueBlock({ label, value, tone }: { label: string; value: unknown; tone?: "error" }) {
  const text = stringifyValue(value);
  return (
    <div className="min-w-0 space-y-1">
      <div
        className={cn(
          "text-[11px] font-medium tracking-wide uppercase",
          tone === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {label}
      </div>
      <pre
        className={cn(
          "max-h-64 overflow-auto rounded-lg border px-3 py-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap",
          tone === "error" ? "border-destructive/25 bg-destructive/5 text-destructive" : "bg-muted/50 text-foreground/90",
        )}
      >
        {text || <span className="text-muted-foreground italic">empty</span>}
      </pre>
    </div>
  );
}

/**
 * Compact card for a single tool invocation (MCP / CLI tool call): name, status and duration in
 * the header; input and output (or error) in an expandable body.
 */
export function ToolCallCard({
  name,
  title,
  args,
  status,
  result,
  error,
  durationMs,
  icon,
  badge,
  resultContent,
  defaultOpen = false,
  className,
}: {
  name: string;
  title?: string;
  args?: unknown;
  status: ToolCallStatus;
  result?: unknown;
  error?: string | null;
  durationMs?: number;
  icon?: React.ReactNode;
  /** Small label next to the name (e.g. the tool's source). */
  badge?: React.ReactNode;
  /** Custom rendering of the result (replaces the raw "Output" block). */
  resultContent?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const bodyId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const hasArgs = args !== undefined && args !== null && !(typeof args === "object" && Object.keys(args as object).length === 0);
  const hasResult = (result !== undefined && result !== null) || resultContent != null;
  const hasError = !!error;
  const expandable = hasArgs || hasResult || hasError;
  const duration = formatDuration(durationMs);

  const header = (
    <>
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground [&_svg]:size-3.5",
          status === "running" && "text-info",
        )}
      >
        {icon ?? <Wrench />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        {title ? (
          <>
            <span className="truncate text-sm font-medium">{title}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{name}</span>
          </>
        ) : (
          <span className="truncate font-mono text-[13px] font-medium">{name}</span>
        )}
      </span>
      {badge}
      {duration && <span className="hidden shrink-0 text-xs text-muted-foreground tabular sm:inline">{duration}</span>}
      <StatusIndicator status={status} />
      {expandable && (
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      )}
    </>
  );

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-soft transition-colors",
        status === "error" && "border-destructive/30",
        className,
      )}
      data-status={status}
    >
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
        >
          {header}
        </button>
      ) : (
        <div className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2">{header}</div>
      )}
      <AnimatePresence initial={false}>
        {expandable && open && (
          <motion.div
            id={bodyId}
            key="tool-body"
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t px-3 py-3">
              {duration && <div className="text-xs text-muted-foreground tabular sm:hidden">Took {duration}</div>}
              {hasArgs && <ValueBlock label="Input" value={args} />}
              {hasError ? (
                <ValueBlock label="Error" value={error} tone="error" />
              ) : resultContent != null ? (
                resultContent
              ) : hasResult ? (
                <ValueBlock label="Output" value={result} />
              ) : status === "running" || status === "pending" ? (
                <div className="text-xs text-muted-foreground">Waiting for output…</div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
