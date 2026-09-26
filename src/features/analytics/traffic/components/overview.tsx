"use client";

import { motion } from "motion/react";
import { BarChart3 } from "lucide-react";
import { KpiStrip, formatCurrency, formatNumber, formatPercent } from "@/components/app/metrics";
import { BarsChart, TrendChart } from "@/components/app/charts";
import { Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import type { TrafficOverview } from "@/server/analytics/traffic/queries";
import { PlatformIcon } from "./common";

function monthLabel(v: string) {
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function TrafficOverviewPanel({
  overview,
  currency,
  granularity,
  periodLabel,
  sourceLabel,
}: {
  overview: TrafficOverview;
  currency: string;
  granularity: "daily" | "monthly";
  periodLabel: string;
  sourceLabel: string;
}) {
  const { kpis } = overview;
  const series = overview.seriesKeys.map((s) => ({ key: s.key, label: s.label, color: s.color }));
  const totalSessions = overview.platforms.reduce((a, p) => a + p.sessions, 0);
  return (
    <Panel
      title={
        <span>
          Human Traffic from AI Platforms <span className="font-normal text-muted-foreground">— {periodLabel}</span>
        </span>
      }
      description={`Sessions referred by ChatGPT, Perplexity, Gemini, Claude, Copilot & co. · Source: ${sourceLabel}`}
    >
      <div className="space-y-5">
        <KpiStrip
          items={[
            {
              key: "sessions",
              label: "Sessions",
              value: formatNumber(kpis.sessions, { maximumFractionDigits: 0 }),
              delta: kpis.sessionsDelta,
              deltaSuffix: "%",
              sub: kpis.aiShare != null ? `${formatPercent(kpis.aiShare, kpis.aiShare < 1 ? 2 : 1)} of all sessions` : undefined,
              hint: "Sessions whose source or referrer is an AI platform, vs the previous period of equal length.",
            },
            {
              key: "conversions",
              label: "Conversions",
              value: formatNumber(kpis.conversions, { maximumFractionDigits: 0 }),
              delta: kpis.conversionsDelta,
              deltaSuffix: "%",
              sub: kpis.conversionRate != null ? `${formatPercent(kpis.conversionRate)} conversion rate` : undefined,
              hint: "Key events / goal conversions from AI-referred sessions.",
            },
            {
              key: "revenue",
              label: "Revenue",
              value: formatCurrency(kpis.revenue, currency),
              delta: kpis.revenueDelta,
              deltaSuffix: "%",
              sub: kpis.sessions > 0 ? `${formatCurrency(kpis.revenue / kpis.sessions, currency, 2)} per session` : undefined,
              hint: "Revenue attributed to AI-referred sessions.",
            },
          ]}
        />
        {totalSessions === 0 ? (
          <EmptyState
            compact
            icon={BarChart3}
            title="No AI-referred sessions in this period"
            description="As soon as visitors arrive from ChatGPT, Perplexity, Gemini or other AI assistants, they show up here. Try a longer period."
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="min-w-0">
              {granularity === "monthly" || overview.series.length <= 45 ? (
                <BarsChart
                  data={overview.series}
                  series={series}
                  stacked
                  height={280}
                  xFormatter={granularity === "monthly" ? monthLabel : undefined}
                />
              ) : (
                <TrendChart data={overview.series} series={series} stacked height={280} />
              )}
            </motion.div>
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Visitors by AI platform</p>
              <ol className="space-y-1">
                {overview.platforms.slice(0, 10).map((p, i) => (
                  <li key={p.platform} className="relative flex items-center gap-2.5 overflow-hidden rounded-lg px-2 py-1.5 text-sm">
                    <span className="absolute inset-y-0 left-0 rounded-lg bg-muted" style={{ width: `${Math.max(3, p.share)}%` }} />
                    <span className="relative w-4 shrink-0 text-xs text-muted-foreground tabular">{i + 1}</span>
                    <span className="relative">
                      <PlatformIcon id={p.platform} />
                    </span>
                    <span className="relative min-w-0 flex-1 truncate font-medium">{p.name}</span>
                    <span className="relative text-xs font-medium tabular">{formatNumber(p.sessions, { maximumFractionDigits: 0 })}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
