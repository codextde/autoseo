"use client";

import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";
import { StackedBar, TickGauge } from "@/components/app/charts";
import { Meter } from "@/components/app/metrics";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FC_VERDICT_META } from "@/features/optimize/constants";
import type { VerdictCounts } from "../types";
import { VERDICT_COLORS } from "./badges";

const DEVIATIONS = ["off_label", "contradicted", "unsupported", "outdated"] as const;

function pct(n: number, d: number) {
  return d ? (n / d) * 100 : 0;
}

export function LabelAlignment({ projectId, totals }: { projectId: string; totals: VerdictCounts }) {
  const deviate = DEVIATIONS.reduce((a, k) => a + totals[k], 0);
  const matchPct = pct(totals.matched, totals.checked);
  const checkedPct = pct(totals.checked, totals.collected);
  const findingsHref = (type: string) => `/p/${projectId}/fact-check/findings?type=${type}&status=all`;
  const hasData = totals.collected > 0;

  return (
    <section className="grid gap-3 lg:grid-cols-[1.1fr_1fr_1.3fr]">
      {/* Gauge */}
      <div className="flex flex-col rounded-2xl border bg-card p-5 shadow-soft">
        <h3 className="text-sm font-medium text-muted-foreground">How much matches the label</h3>
        <div className="relative mx-auto mt-3 w-[220px]">
          <TickGauge value={hasData ? matchPct : 0} size={220} />
          <div className="absolute inset-x-0 bottom-1 flex flex-col items-center">
            <span className="text-4xl font-semibold tracking-tight tabular">{totals.checked ? `${Math.round(matchPct)}%` : "—"}</span>
          </div>
        </div>
        <p className="mt-3 text-center text-sm text-muted-foreground tabular">
          {totals.checked ? (
            <>
              <span className="font-medium text-foreground">
                {totals.matched}/{totals.checked}
              </span>{" "}
              match · {deviate} deviate · {totals.needs_review} undecided
            </>
          ) : (
            "No statements checked yet"
          )}
        </p>
      </div>

      {/* Checked progress */}
      <div className="flex flex-col rounded-2xl border bg-card p-5 shadow-soft">
        <h3 className="text-sm font-medium text-muted-foreground">How much has been checked</h3>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-4xl font-semibold tracking-tight tabular">
            {totals.checked}
            <span className="text-2xl text-muted-foreground">/{totals.collected}</span>
          </span>
          <span className="text-sm text-muted-foreground">collected</span>
        </div>
        <Meter value={checkedPct} className="mt-4 h-2" tone="foreground" />
        <div className="mt-2 flex justify-between text-xs text-muted-foreground tabular">
          <span>{Math.round(checkedPct)}% checked</span>
          <span>{totals.pending} waiting</span>
        </div>
        <p className="mt-auto pt-4 text-xs text-muted-foreground">
          Statements are collected from tracked AI answers that mention an asset, then compared word-for-word with its reference documents.
        </p>
      </div>

      {/* Why statements deviate */}
      <div className="flex flex-col rounded-2xl border bg-card p-5 shadow-soft">
        <h3 className="text-sm font-medium text-muted-foreground">Why statements deviate</h3>
        <ul className="mt-3 space-y-1">
          {DEVIATIONS.map((k) => (
            <ReasonRow
              key={k}
              color={VERDICT_COLORS[k]!}
              label={FC_VERDICT_META[k].label}
              hint={FC_VERDICT_META[k].description}
              count={totals[k]}
              share={pct(totals[k], totals.checked)}
              href={findingsHref(k)}
            />
          ))}
        </ul>
        <div className="mt-2 border-t pt-2">
          <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Not a deviation</div>
          <ul>
            <ReasonRow
              color={VERDICT_COLORS.needs_review!}
              label={FC_VERDICT_META.needs_review.label}
              hint={FC_VERDICT_META.needs_review.description}
              count={totals.needs_review}
              share={pct(totals.needs_review, totals.checked)}
              href={findingsHref("needs_review")}
            />
          </ul>
        </div>
        <StackedBar
          className="mt-auto"
          height={8}
          parts={[
            { key: "matched", value: totals.matched, color: VERDICT_COLORS.matched!, label: "Matched" },
            ...DEVIATIONS.map((k) => ({ key: k, value: totals[k], color: VERDICT_COLORS[k]!, label: FC_VERDICT_META[k].label })),
            { key: "needs_review", value: totals.needs_review, color: VERDICT_COLORS.needs_review!, label: "Needs review" },
          ]}
        />
      </div>
    </section>
  );
}

function ReasonRow({
  color,
  label,
  hint,
  count,
  share,
  href,
}: {
  color: string;
  label: string;
  hint: string;
  count: number;
  share: number;
  href: string;
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-sm hover:bg-muted/50">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
        {label}
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="size-3 shrink-0 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent className="max-w-60">{hint}</TooltipContent>
        </Tooltip>
      </span>
      <span className="w-8 text-right font-medium tabular">{count}</span>
      <span className="w-12 text-right text-xs text-muted-foreground tabular">{share.toFixed(share >= 10 || share === 0 ? 0 : 1)}%</span>
      <Link href={href} className="inline-flex w-12 items-center justify-end gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        View <ArrowRight className="size-3" />
      </Link>
    </li>
  );
}
