"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiStrip, formatCompact, formatNumber } from "@/components/app/metrics";
import { Sparkline, RankedBars } from "@/components/app/charts";
import { Panel } from "@/components/app/page";
import { cn } from "@/lib/utils";
import { AnalysisShell } from "./analysis-shell";
import { ProviderNotice, topicColor } from "../shared/bits";
import type { InterestCluster, InterestData, KnowledgeState, SearchIntent } from "../../types";

const INTENT_STYLE: Record<SearchIntent, string> = {
  informational: "bg-info/10 text-info",
  commercial: "bg-warning/15 text-warning",
  transactional: "bg-success/12 text-success",
  navigational: "bg-muted text-muted-foreground",
  mixed: "bg-muted text-muted-foreground",
};

function TrendBadge({ c }: { c: InterestCluster }) {
  if (!c.trendDirection || c.trendPct == null) return null;
  const Icon = c.trendDirection === "up" ? ArrowUpRight : c.trendDirection === "down" ? ArrowDownRight : ArrowRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular", c.trendDirection === "up" ? "text-success" : c.trendDirection === "down" ? "text-destructive" : "text-muted-foreground")}>
      <Icon className="size-3" />
      {c.trendPct > 0 ? "+" : ""}
      {c.trendPct}%
    </span>
  );
}

function ClusterCard({ c, estimated }: { c: InterestCluster; estimated: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = open ? c.keywords : c.keywords.slice(0, 6);
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: topicColor(c.name) }} />
            <h3 className="truncate text-sm font-semibold">{c.name}</h3>
          </div>
          {c.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.description}</p>}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold tracking-tight tabular">{c.volume != null ? formatCompact(c.volume) : "—"}</div>
          <div className="text-[10px] text-muted-foreground">{estimated ? "est. / month" : "searches / month"}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium capitalize", INTENT_STYLE[c.intent])}>{c.intent}</span>
        {c.branded && <Badge variant="outline" className="h-[18px] text-[10px]">Branded</Badge>}
        <TrendBadge c={c} />
        <span className="ml-auto text-[11px] text-muted-foreground tabular">{c.keywords.length} queries</span>
      </div>
      {c.trend.length > 2 && <Sparkline values={c.trend.map((t) => t.volume)} height={32} color={topicColor(c.name)} className="mt-2" />}
      <div className="mt-3 flex flex-wrap gap-1">
        {shown.map((k) => (
          <span key={k.keyword} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px]">
            <span className="truncate">{k.keyword}</span>
            {k.volume != null && <span className="text-muted-foreground tabular">{formatCompact(k.volume)}</span>}
          </span>
        ))}
      </div>
      {c.keywords.length > 6 && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
          {open ? "Show less" : `Show all ${c.keywords.length}`}
        </button>
      )}
    </div>
  );
}

export function InterestTab({
  projectId,
  state,
  canManage,
  providers,
}: {
  projectId: string;
  state: KnowledgeState<InterestData>;
  canManage: boolean;
  providers: { dataforseo: boolean; llm: boolean };
}) {
  const data = state.data;
  const [intent, setIntent] = useState<string>("all");
  const clusters = useMemo(() => (data?.clusters ?? []).filter((c) => intent === "all" || c.intent === intent), [data, intent]);
  const blocked =
    !providers.dataforseo && !providers.llm ? (
      <ProviderNotice title="Needs DataForSEO or an AI provider" href="/admin/data" linkLabel="Data Providers">
        Interest clustering uses DataForSEO keyword data (real search volumes). Without it, an AI provider can estimate clusters.
      </ProviderNotice>
    ) : undefined;
  const estimated = data?.volumeSource === "estimated";
  const topicsForHelper = (data?.clusters ?? []).filter((c) => !c.branded && c.name !== "Other").slice(0, 8).map((c) => c.name);

  return (
    <AnalysisShell
      projectId={projectId}
      kind="interest"
      state={state}
      canManage={canManage}
      source="Your queries"
      hasData={!!data}
      blocked={blocked}
      intro={
        <>
          <p className="text-base font-semibold text-foreground">What do people search around your brand?</p>
          <p>We collect the queries around your brand and product categories, cluster them into interest topics with search volumes, trends and intent — the foundation for your prompt research.</p>
          {!providers.dataforseo && providers.llm && <p className="text-xs">DataForSEO is not configured — volumes will be AI estimates.</p>}
        </>
      }
    >
      {data && (
        <div className="space-y-4">
          {estimated && (
            <ProviderNotice title="Estimated volumes" href="/admin/data" linkLabel="Connect DataForSEO" tone="info">
              These clusters and volumes were estimated by AI. Connect DataForSEO for real Google search volumes and 12-month trends.
            </ProviderNotice>
          )}
          <KpiStrip
            items={[
              { key: "clusters", label: "Interest clusters", value: formatNumber(data.clusters.length) },
              { key: "queries", label: "Queries analysed", value: formatNumber(data.totalKeywords) },
              { key: "volume", label: estimated ? "Est. monthly searches" : "Monthly searches", value: formatCompact(data.totalVolume) },
              { key: "source", label: "Volume source", value: estimated ? "AI estimate" : "DataForSEO" },
            ]}
          />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap rounded-lg bg-muted p-0.5">
                  {["all", "informational", "commercial", "transactional", "navigational", "mixed"].map((i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setIntent(i)}
                      className={cn("rounded-md px-2 py-1 text-xs font-medium capitalize", intent === i ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")}
                    >
                      {i}
                    </button>
                  ))}
                </div>
                {topicsForHelper.length > 0 && (
                  <Button asChild size="sm" variant="outline" className="ml-auto max-w-full">
                    <Link href={`/p/${projectId}/ai/prompt-research?helper=1&ht=${encodeURIComponent(topicsForHelper.join(","))}`}>
                      <Sparkles className="size-3.5" /> <span className="truncate">Generate prompts from clusters</span>
                    </Link>
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {clusters.map((c) => (
                  <ClusterCard key={c.id} c={c} estimated={estimated} />
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <Panel title="Share of interest" description="Monthly searches by cluster">
                <RankedBars
                  items={data.clusters.slice(0, 12).map((c) => ({
                    key: c.id,
                    label: c.name,
                    value: c.volume ?? 0,
                    icon: <span className="block size-2 rounded-full" style={{ background: topicColor(c.name) }} />,
                  }))}
                  format="compact"
                />
              </Panel>
              <Panel title="Seed terms" description="Where the analysis started">
                <div className="flex flex-wrap gap-1">
                  {data.seeds.map((s) => (
                    <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
                      {s}
                    </span>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        </div>
      )}
    </AnalysisShell>
  );
}
