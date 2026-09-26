"use client";

import { useMemo } from "react";
import { TrendChart } from "@/components/app/charts";
import { formatNumber } from "@/components/app/metrics";
import { Panel } from "@/components/app/page";
import type { KeywordResearchRow } from "@/server/seo/lib/keywords";
import { DifficultyBadge, IntentBadge } from "../shared/badges";
import { capitalize } from "./params";

const MONTH = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));

/** Keyword headline strip: keyword + difficulty, Vol, CPC, Comp, intent. */
export function OverviewStats({ row }: { row: KeywordResearchRow }) {
  const cells: { label: string; value: React.ReactNode }[] = [
    { label: "Vol", value: row.searchVolume != null ? formatNumber(row.searchVolume, { maximumFractionDigits: 0 }) : "-" },
    { label: "CPC", value: row.cpc != null ? `$${row.cpc.toFixed(2)}` : "-" },
    { label: "Comp", value: row.competition != null ? row.competition.toFixed(2) : "-" },
    { label: "Intent", value: <IntentBadge intent={row.intent} /> },
  ];
  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-soft sm:flex-row sm:items-center sm:gap-4 sm:p-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <DifficultyBadge value={row.keywordDifficulty} className="size-9 text-xs" />
        <div className="min-w-0">
          <div className="text-[11px] tracking-wide text-muted-foreground uppercase">Keyword</div>
          <div className="truncate text-base font-semibold tracking-tight">{capitalize(row.keyword)}</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted/70 p-1 sm:ml-auto sm:min-w-[22rem]">
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg px-2.5 py-1.5">
            <div className="text-[11px] text-muted-foreground">{c.label}</div>
            <div className="mt-0.5 text-sm font-semibold tabular">{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Search Trends <Mon YYYY - Mon YYYY>" — last 12 months of the overview keyword. */
export function SearchTrendsPanel({ row }: { row: KeywordResearchRow }) {
  const points = useMemo(
    () =>
      [...row.trend]
        .filter((t) => t.year > 0 && t.month > 0)
        .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month))
        .slice(-12)
        .map((t) => ({ date: MONTH(t.year, t.month).toISOString().slice(0, 10), volume: t.searchVolume })),
    [row.trend],
  );
  if (points.length === 0) return null;
  const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const range = `${fmt(points[0]!.date)} - ${fmt(points[points.length - 1]!.date)}`;
  return (
    <Panel title="Search Trends" description={range} contentClassName="p-3 sm:p-4">
      <TrendChart
        data={points}
        series={[{ key: "volume", label: "Search volume", color: "var(--brand)" }]}
        type="area"
        format="compact"
        height={210}
        xFormatter={(v) => new Date(`${v}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}
      />
    </Panel>
  );
}
