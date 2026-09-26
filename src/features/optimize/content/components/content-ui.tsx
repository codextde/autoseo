"use client";

import { Loader2 } from "lucide-react";
import { aeoBand } from "@/server/optimize/content/aeo-score";
import { CONTENT_STATUS_META } from "@/features/optimize/constants";
import { cn } from "@/lib/utils";

export function bandColor(score: number) {
  const b = aeoBand(score).key;
  return b === "primary" ? "var(--brand)" : b === "strong" ? "var(--chart-2)" : b === "needs_work" ? "var(--warning)" : "var(--destructive)";
}

/** Compact AEO score chip: number + colored bar + band label. */
export function AeoScoreChip({ score, baseline, className, showBand = true }: { score: number | null; baseline?: number | null; className?: string; showBand?: boolean }) {
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>;
  const band = aeoBand(score);
  const delta = baseline != null ? score - baseline : 0;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="w-7 text-right text-sm font-semibold tabular">{score}</span>
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${score}%`, background: bandColor(score) }} />
      </span>
      {showBand && <span className="hidden text-[11px] text-muted-foreground xl:inline">{band.label}</span>}
      {delta > 0 && <span className="text-[11px] font-medium text-success tabular">+{delta}</span>}
    </span>
  );
}

const TONE: Record<string, string> = {
  published: "bg-success/12 text-success ring-success/25",
  generating: "bg-info/12 text-info ring-info/25",
  draft: "bg-muted text-muted-foreground ring-border",
  in_review: "bg-warning/15 text-warning ring-warning/30",
  failed: "bg-destructive/10 text-destructive ring-destructive/25",
};

export function ContentStatusBadge({ status, stage }: { status: keyof typeof CONTENT_STATUS_META; stage?: string | null }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", TONE[status])}>
      {status === "generating" ? <Loader2 className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
      {CONTENT_STATUS_META[status].label}
      {status === "generating" && stage && stage !== "queued" && <span className="font-normal opacity-75">· {stage}</span>}
    </span>
  );
}
