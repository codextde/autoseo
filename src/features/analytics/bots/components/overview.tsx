"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Bot, ShieldCheck, ShieldAlert } from "lucide-react";
import { BarsChart, LegendList, CHART_COLORS } from "@/components/app/charts";
import { KpiStrip, formatNumber, formatPercent, Delta } from "@/components/app/metrics";
import { Panel } from "@/components/app/page";
import { TimeAgo } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pctChange } from "@/server/analytics/period";
import type { BotOverview } from "@/server/analytics/bots/queries";
import { BotAvatar } from "./bot-avatar";

const PURPOSE_LABEL: Record<string, string> = {
  training: "Training",
  search: "Search index",
  user: "User-triggered",
  seo: "SEO tool",
  other: "Crawler",
};

export function BotOverviewView({
  data,
  periodLabel,
  pagesHrefBase,
  canUpload,
  syncHref,
}: {
  data: BotOverview;
  periodLabel: string;
  /** Crawled-pages URL (with current filters); `&bots=<bot>` is appended per card. */
  pagesHrefBase: string;
  canUpload: boolean;
  syncHref: string;
}) {
  const t = data.totals;
  const statusTotal = t.ok + t.redirects + t.clientErrors + t.serverErrors;
  const okShare = statusTotal ? (t.ok / statusTotal) * 100 : null;
  const verifiable = t.verified + t.unverified;

  if (!data.hasAnyData) {
    return (
      <Panel>
        <EmptyState
          icon={Bot}
          title="No bot traffic yet"
          description={
            canUpload
              ? "Upload an access log (nginx, Apache, Cloudflare, Akamai) or connect a live source in the Sync tab to see which AI crawlers visit your site."
              : "Once an admin uploads logs or connects Cloudflare, Akamai or the server-log API, AI crawler visits appear here."
          }
          action={canUpload ? { label: "Set up a live connection", href: syncHref } : undefined}
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <KpiStrip
        items={[
          {
            key: "visits",
            label: "Bot Visits",
            value: formatNumber(t.visits),
            delta: pctChange(t.visits, t.prevVisits),
            deltaSuffix: "%",
            hint: "Requests from AI and search crawlers in the selected period (vs. previous period).",
          },
          {
            key: "urls",
            label: "Unique URLs",
            value: formatNumber(t.uniqueUrls),
            delta: pctChange(t.uniqueUrls, t.prevUniqueUrls),
            deltaSuffix: "%",
          },
          {
            key: "status",
            label: "Response Status",
            value: okShare == null ? "—" : formatPercent(okShare),
            sub: `${formatNumber(t.clientErrors + t.serverErrors)} errors · ${formatNumber(t.redirects)} redirects`,
            hint: "Share of bot requests answered with 2xx.",
          },
          {
            key: "verified",
            label: "Verified",
            value: verifiable ? formatPercent((t.verified / verifiable) * 100) : "—",
            sub: t.unverified ? `${formatNumber(t.unverified)} spoofed` : "IP matched published ranges",
            hint: "Requests whose IP lies inside the crawler operator's published IP ranges. Spoofed = UA claims a bot but the IP is outside its ranges.",
          },
        ]}
      />

      <Panel title="Crawler visits per day" description={periodLabel} contentClassName="p-3 sm:p-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
          <BarsChart data={data.daily} series={data.series} stacked height={280} barSize={data.daily.length > 60 ? undefined : 14} />
          <LegendList
            format="number"
            items={data.series.map((s, i) => ({
              name: s.label,
              value: data.daily.reduce((sum, d) => sum + Number(d[s.key] ?? 0), 0),
              color: CHART_COLORS[i % CHART_COLORS.length],
            }))}
          />
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.bots.map((b, i) => (
          <motion.div key={b.bot} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}>
            <Link
              href={`${pagesHrefBase}${pagesHrefBase.includes("?") ? "&" : "?"}bots=${encodeURIComponent(b.bot)}`}
              className="flex h-full flex-col rounded-2xl border bg-card p-4 shadow-soft transition-shadow hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <BotAvatar bot={b.bot} company={b.company} size="lg" withTooltip={false} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate text-sm font-semibold">{b.bot}</h3>
                    {b.unverified > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <ShieldAlert className="size-3.5 shrink-0 text-warning" />
                        </TooltipTrigger>
                        <TooltipContent>{formatNumber(b.unverified)} requests from IPs outside the published ranges</TooltipContent>
                      </Tooltip>
                    ) : b.verified > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <ShieldCheck className="size-3.5 shrink-0 text-success" />
                        </TooltipTrigger>
                        <TooltipContent>IPs verified against the published ranges</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {b.company} · {PURPOSE_LABEL[b.purpose] ?? "Crawler"}
                  </p>
                </div>
                {b.trend != null ? (
                  <Delta value={b.trend} suffix="%" digits={0} />
                ) : (
                  <span className="text-[11px] text-muted-foreground">new</span>
                )}
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-muted/60 px-2.5 py-2">
                  <dt className="text-[11px] text-muted-foreground">Total Visits</dt>
                  <dd className="text-base font-semibold tabular">{formatNumber(b.visits)}</dd>
                </div>
                <div className="rounded-lg bg-muted/60 px-2.5 py-2">
                  <dt className="text-[11px] text-muted-foreground">Pages Crawled</dt>
                  <dd className="text-base font-semibold tabular">{formatNumber(b.pages)}</dd>
                </div>
              </dl>
              {b.lastSeen && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Last seen <TimeAgo date={b.lastSeen} />
                </p>
              )}
            </Link>
          </motion.div>
        ))}
        {!data.bots.length && (
          <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
            No crawler visits in this period. Try a longer range.
          </div>
        )}
      </div>
    </div>
  );
}
