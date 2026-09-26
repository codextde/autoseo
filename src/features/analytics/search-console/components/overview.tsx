"use client";

import { KpiStrip, formatCompact, formatNumber } from "@/components/app/metrics";
import { TrendChart } from "@/components/app/charts";
import type { ScOverview } from "@/server/analytics/search-console/queries";

export function ScOverviewPanel({ overview, periodLabel }: { overview: ScOverview; periodLabel: string }) {
  const { totals, deltas } = overview;
  return (
    <section className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
      <KpiStrip
        items={[
          { key: "clicks", label: "CLICKS", value: formatCompact(totals.clicks), delta: deltas.clicks, deltaSuffix: "%", hint: `Clicks from search, ${periodLabel} vs previous period` },
          { key: "impressions", label: "IMPRESSIONS", value: formatCompact(totals.impressions), delta: deltas.impressions, deltaSuffix: "%", hint: `Times your site appeared in results, ${periodLabel} vs previous period` },
          { key: "ctr", label: "CTR", value: totals.ctr == null ? "—" : `${totals.ctr.toFixed(1)}%`, delta: deltas.ctr, deltaSuffix: " pp" },
          {
            key: "position",
            label: "AVG. POSITION",
            value: totals.position == null ? "—" : formatNumber(totals.position, { maximumFractionDigits: 1 }),
            delta: deltas.position,
            hint: "Impression-weighted average position (positive change = moved up)",
          },
        ]}
      />
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-chart-3" /> Clicks
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-chart-2" /> Impressions
        </span>
        <span className="ml-auto tabular">{periodLabel}</span>
      </div>
      <TrendChart
        data={overview.series}
        type="line"
        height={260}
        series={[
          { key: "clicks", label: "Clicks", color: "var(--chart-3)", yAxis: "left" },
          { key: "impressions", label: "Impressions", color: "var(--chart-2)", yAxis: "right" },
        ]}
        format="number"
        rightFormat="compact"
      />
    </section>
  );
}
