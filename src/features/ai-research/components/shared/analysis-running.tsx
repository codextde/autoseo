"use client";

import { motion } from "motion/react";
import { BookOpen, Mail, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { JobStatus } from "../../types";

/**
 * finseo-style "Analysis running" state: animated "Your X → Knowledge" diagram, time estimate,
 * email note and live progress from the background job.
 */
export function AnalysisRunning({
  source,
  title = "Analysis running",
  description,
  status,
  estimate = "This usually takes 30–60 minutes.",
  showPromptResearchNote = true,
  className,
}: {
  source: string;
  title?: string;
  description?: React.ReactNode;
  status?: JobStatus | null;
  estimate?: string;
  showPromptResearchNote?: boolean;
  className?: string;
}) {
  const p = status?.progress;
  const pct = p?.total ? Math.min(100, Math.round(((p.done ?? 0) / p.total) * 100)) : null;
  return (
    <div className={cn("flex flex-col items-center gap-6 rounded-2xl border bg-card px-5 py-10 text-center shadow-soft sm:px-10", className)}>
      <div className="flex w-full max-w-md items-center justify-between gap-3">
        <Node label={source} icon={<Sparkles className="size-4" />} />
        <div className="relative h-10 flex-1">
          <svg className="absolute inset-0 size-full" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden>
            <path d="M0 20 C 60 0, 140 40, 200 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 5" className="text-border" />
          </svg>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-brand shadow-[0_0_0_4px_var(--brand-soft)]"
              initial={{ left: "0%", opacity: 0 }}
              animate={{ left: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeInOut" }}
            />
          ))}
        </div>
        <Node label="Knowledge" icon={<BookOpen className="size-4" />} accent />
      </div>
      <div className="space-y-2">
        <h3 className="flex items-center justify-center gap-2 text-base font-semibold">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-brand" />
          </span>
          {title}
        </h3>
        {description && <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>}
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{estimate}</p>
      </div>
      {(p?.message || pct != null) && (
        <div className="w-full max-w-sm space-y-1.5">
          {pct != null && <Progress value={pct} />}
          {p?.message && <p className="truncate text-xs text-muted-foreground">{p.message}</p>}
        </div>
      )}
      <div className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground sm:flex-row sm:gap-4">
        <span className="inline-flex items-center gap-1.5">
          <Mail className="size-3.5" /> We&apos;ll email you when it&apos;s ready
        </span>
        {showPromptResearchNote && (
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3.5" /> Results also appear in Prompt Research
          </span>
        )}
      </div>
    </div>
  );
}

function Node({ label, icon, accent }: { label: string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={cn(
          "flex size-11 items-center justify-center rounded-xl border shadow-xs",
          accent ? "border-brand/30 bg-brand-soft text-brand" : "bg-background text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <span className="text-xs font-medium whitespace-nowrap">{label}</span>
    </div>
  );
}
