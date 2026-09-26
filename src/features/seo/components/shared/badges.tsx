"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { scoreTier, type KeywordIntent } from "@/server/seo/lib/keywords";
import { resolveTagColor, TAG_COLOR_HEX } from "@/server/seo/lib/tags";
import { formatUsd } from "@/server/seo/lib/costs";
import { cn } from "@/lib/utils";

const TIER_CLASSES = [
  "bg-muted text-muted-foreground",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  "bg-lime-500/15 text-lime-700 dark:text-lime-400",
  "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  "bg-amber-500/20 text-amber-700 dark:text-amber-400",
  "bg-orange-500/20 text-orange-700 dark:text-orange-400",
  "bg-rose-500/15 text-rose-700 dark:text-rose-400",
];

export const KD_HELP = "Organic ranking difficulty (0-100): higher means harder to reach Google's top 10.";
export const CPC_HELP = "Cost per click in USD.";
export const COMP_HELP = "Paid-search competition from Google Ads (0-1): higher means more advertisers bidding.";

/** Round keyword-difficulty badge coloured by tier (≤20, ≤35, ≤50, ≤65, ≤80, >80). */
export function DifficultyBadge({ value, className }: { value: number | null | undefined; className?: string }) {
  const tier = scoreTier(value);
  return (
    <span
      className={cn("inline-flex size-7 items-center justify-center rounded-full text-[11px] font-semibold tabular", TIER_CLASSES[tier], className)}
      title={value == null ? "No difficulty data" : `Difficulty ${Math.round(value)}`}
    >
      {value == null ? "—" : Math.round(value)}
    </span>
  );
}

const INTENT: Record<KeywordIntent, { short: string; cls: string; help: string }> = {
  informational: { short: "Info", cls: "bg-info/12 text-info", help: "The searcher wants to learn something or find an answer." },
  commercial: { short: "Comm", cls: "bg-warning/15 text-warning", help: "The searcher is researching options before a purchase (reviews, comparisons, best-of lists)." },
  transactional: { short: "Trans", cls: "bg-success/12 text-success", help: "The searcher is ready to act — buy, sign up or download." },
  navigational: { short: "Nav", cls: "bg-primary/10 text-foreground", help: "The searcher is looking for a specific site or brand." },
  unknown: { short: "?", cls: "bg-muted text-muted-foreground", help: "No intent data for this keyword." },
};

export function IntentBadge({ intent }: { intent: KeywordIntent | string | null | undefined }) {
  const key = (intent && intent in INTENT ? intent : "unknown") as KeywordIntent;
  const i = INTENT[key];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium", i.cls)}>{i.short}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-60">
        <span className="font-medium capitalize">{key}</span> — {i.help}
      </TooltipContent>
    </Tooltip>
  );
}

export function TagPill({ tag, className, onRemove }: { tag: { id: string; name: string; color?: string | null }; className?: string; onRemove?: () => void }) {
  const hex = TAG_COLOR_HEX[resolveTagColor(tag)];
  return (
    <span
      className={cn("inline-flex h-5 max-w-40 items-center gap-1 rounded-full px-2 text-[11px] font-medium", className)}
      style={{ background: `${hex}1f`, color: hex }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: hex }} />
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 opacity-70 hover:opacity-100" aria-label={`Remove ${tag.name}`}>
          ×
        </button>
      )}
    </span>
  );
}

/** Small "≈ $0.03" pill shown next to buttons that trigger paid DataForSEO calls. */
export function CostPill({ usd, max, label, className }: { usd: number; max?: number; label?: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex h-6 items-center gap-1 rounded-full border bg-background px-2 text-[11px] text-muted-foreground tabular", className)}>
          ≈ {formatUsd(usd)}
          {max != null && max > usd ? `–${formatUsd(max)}` : ""}
          {label ? ` ${label}` : ""}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        Estimated DataForSEO cost (charged to your DataForSEO balance). Cached results are free; the actual cost is recorded in Settings → Usage.
      </TooltipContent>
    </Tooltip>
  );
}

export function HelpTip({ text, className }: { text: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className={cn("inline size-3.5 cursor-help text-muted-foreground/70", className)} />
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  );
}
