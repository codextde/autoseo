"use client";

import { motion } from "motion/react";
import { Lightbulb } from "lucide-react";
import { ScoreRing } from "@/components/app/charts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AEO_PILLARS, type AeoPillarKey, type AeoResult } from "@/server/optimize/content/aeo-score";
import { bandColor } from "./content-ui";

const PILLAR_TAB: Record<AeoPillarKey, string> = {
  extractability: "write",
  factDensity: "sources",
  structure: "write",
  schema: "schema",
  depth: "faq",
  metadata: "meta",
};

export function ScorePanel({
  result,
  baseline,
  onGoTo,
  compact,
}: {
  result: AeoResult;
  baseline?: number | null;
  onGoTo?: (tab: string) => void;
  compact?: boolean;
}) {
  const s = result.stats;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <ScoreRing value={result.score} size={compact ? 72 : 92} stroke={compact ? 7 : 9} color={bandColor(result.score)} label="AEO" />
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-semibold" style={{ color: bandColor(result.score) }}>
            {result.band.label}
          </div>
          <p className="text-xs text-muted-foreground">
            {result.score >= 87 ? "Primary Source band — engines can lift answers straight from this page." : `${87 - result.score} points to the Primary Source band (87+).`}
          </p>
          {baseline != null && baseline !== result.score && (
            <p className={`text-xs font-medium tabular ${result.score > baseline ? "text-success" : "text-destructive"}`}>
              {result.score > baseline ? "+" : ""}
              {result.score - baseline} vs original ({baseline})
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {AEO_PILLARS.map((p) => {
          const v = result.pillars[p.key];
          return (
            <Tooltip key={p.key}>
              <TooltipTrigger asChild>
                <button type="button" className="grid w-full grid-cols-[7.5rem_1fr_2rem] items-center gap-2 text-left text-xs" onClick={() => onGoTo?.(PILLAR_TAB[p.key])}>
                  <span className="truncate text-muted-foreground">{p.label}</span>
                  <span className="relative h-2 overflow-hidden rounded-full bg-muted">
                    <motion.span
                      className="absolute inset-y-0 left-0 rounded-full"
                      initial={false}
                      animate={{ width: `${v}%` }}
                      transition={{ type: "spring", stiffness: 180, damping: 26 }}
                      style={{ background: bandColor(v) }}
                    />
                  </span>
                  <span className="text-right font-medium tabular">{v}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-60">
                {p.hint} · weight {p.weight}%
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t pt-3 text-[11px] text-muted-foreground tabular">
        <span>{s.wordCount.toLocaleString()} words</span>
        <span>{s.readingMinutes} min read</span>
        <span>{s.h2} H2 · {s.h3} H3</span>
        <span>{s.lists} lists · {s.tables} tables</span>
        <span>{s.citations} sources</span>
        <span>{s.faqs} FAQs</span>
      </div>

      {!compact && result.suggestions.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase">
            <Lightbulb className="size-3.5" /> Suggestions
          </div>
          <ul className="space-y-1">
            {result.suggestions.slice(0, 10).map((sg, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onGoTo?.(PILLAR_TAB[sg.pillar])}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="mt-0.5 shrink-0 rounded bg-success/12 px-1 text-[10px] font-semibold text-success tabular">+{sg.impact.toFixed(sg.impact < 10 ? 1 : 0)}</span>
                  <span className="min-w-0 flex-1">
                    {sg.message}
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{AEO_PILLARS.find((p) => p.key === sg.pillar)?.label}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
