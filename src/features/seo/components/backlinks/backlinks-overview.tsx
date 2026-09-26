"use client";

import { Info } from "lucide-react";
import { Panel } from "@/components/app/page";
import { StatCard, formatNumber } from "@/components/app/metrics";
import { TrendChart } from "@/components/app/charts";
import { Skeleton } from "@/components/ui/skeleton";
import type { BacklinksOverview } from "@/server/seo/lib/backlinks";
import type { ResearchScope } from "@/server/seo/lib/research-scope";
import { HelpTip } from "../shared/badges";

const int = (v: number | null | undefined) => (v == null ? "—" : formatNumber(Math.round(v), { maximumFractionDigits: 0 }));
const dec1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));

function monthTick(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return `${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} '${String(d.getUTCFullYear()).slice(2)}`;
}

function Label({ text, help }: { text: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {text}
      <HelpTip text={help} />
    </span>
  );
}

function NewLost({ added, lost }: { added: number | null; lost: number | null }) {
  if (added == null && lost == null) return null;
  return (
    <div className="mt-1 flex items-center gap-2 text-xs tabular">
      {added != null && <span className={added > 0 ? "text-success" : "text-muted-foreground"}>▲ {int(added)} new</span>}
      {lost != null && <span className={lost > 0 ? "text-destructive" : "text-muted-foreground"}>▼ {int(lost)} lost</span>}
    </div>
  );
}

/** Summary stats (8 cards) + 1-year trend charts (domain / subdomains scopes only) + scope notes. */
export function BacklinksOverviewPanels({ overview, scope }: { overview: BacklinksOverview; scope: ResearchScope }) {
  const s = overview.summary;
  const showTrends = scope === "domain" || scope === "subdomains";
  return (
    <div className="space-y-4">
      {scope === "exact_url" && (
        <Note>Showing backlinks for this exact page. Switch the scope to Domain or Subdomains for site-wide results — trend charts need one of those.</Note>
      )}
      {scope === "subfolder" && (
        <Note>
          Showing backlinks pointing into this subfolder. Counts come from filtered backlink totals; rank, trends, and the referring-domains breakdown need
          Domain or Subdomains scope.
        </Note>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={<Label text="Backlinks" help="Total links pointing to this site or page." />} value={int(s.backlinks)}>
          <NewLost added={s.newBacklinks} lost={s.lostBacklinks} />
        </StatCard>
        <StatCard label={<Label text="Referring Domains" help="Unique domains linking to this site or page." />} value={int(s.referringDomains)}>
          <NewLost added={s.newReferringDomains} lost={s.lostReferringDomains} />
        </StatCard>
        <StatCard label={<Label text="Referring Pages" help="Unique pages linking to this site or page." />} value={int(s.referringPages)} />
        <StatCard label={<Label text="Rank" help="DataForSEO's 0-100 authority score." />} value={int(s.rank)} />
        <StatCard label={<Label text="Backlink Spam Score" help="Estimated spam risk of links pointing here." />} value={dec1(s.backlinksSpamScore)} />
        <StatCard label={<Label text="Broken Backlinks" help="Links pointing to broken pages here." />} value={int(s.brokenBacklinks)} />
        <StatCard label={<Label text="Broken Pages" help="Broken pages here that still have backlinks." />} value={int(s.brokenPages)} />
        <StatCard label={<Label text="Target Spam Score" help="Estimated spam risk of this site or page." />} value={dec1(s.targetSpamScore)} />
      </div>
      {showTrends && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Backlink growth" description="Backlinks and referring domains over the last year">
            {overview.trends.length === 0 ? (
              <EmptyChart />
            ) : (
              <TrendChart
                data={overview.trends}
                type="line"
                height={224}
                format="compact"
                rightFormat="compact"
                xFormatter={monthTick}
                legend
                series={[
                  { key: "backlinks", label: "Backlinks", color: "#2563eb" },
                  { key: "referringDomains", label: "Referring domains", color: "#14b8a6", yAxis: "right" },
                ]}
              />
            )}
          </Panel>
          <Panel title="New vs lost" description="Backlink acquisition and attrition">
            {overview.newLostTrends.length === 0 ? (
              <EmptyChart />
            ) : (
              <TrendChart
                data={overview.newLostTrends}
                type="line"
                height={224}
                format="compact"
                xFormatter={monthTick}
                legend
                series={[
                  { key: "lostBacklinks", label: "Lost backlinks", color: "#ef4444" },
                  { key: "newBacklinks", label: "New backlinks", color: "#16a34a" },
                ]}
              />
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function EmptyChart() {
  return <div className="flex h-[224px] items-center justify-center text-sm text-muted-foreground">Not enough historical data yet.</div>;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-info/25 bg-info/8 px-4 py-3 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-info" />
      <span>{children}</span>
    </div>
  );
}

export function BacklinksOverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-[300px] rounded-2xl" />
        <Skeleton className="h-[300px] rounded-2xl" />
      </div>
    </div>
  );
}
