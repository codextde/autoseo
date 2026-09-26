"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, ExternalLink, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { RankedBars, TrendChart } from "@/components/app/charts";
import { KpiStrip } from "@/components/app/metrics";
import { EngineIcon, EngineStack } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import { CountryFlag } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { getEngine } from "@/lib/engines";
import { cn } from "@/lib/utils";
import type { SourceDetail } from "@/server/ai/insights/sources";
import { getListedAdvice } from "../../lib/source-types";
import { YouBadge } from "../brand";
import { openAnswer } from "../answer-sheet";
import { TypeBadge } from "./sources-view";
import { PageCrumb } from "@/components/app/page-crumb";

type PromptRow = SourceDetail["prompts"][number];

export function SourceDetailView({ projectId, data, query, filters }: { projectId: string; data: SourceDetail; query: string; filters?: React.ReactNode }) {
  const youMentioned = (data.kpis.youShare ?? 0) > 0;
  const advice = getListedAdvice(data.contentType, { youMentioned, ownership: data.ownership });
  const safeUrl = /^https?:\/\//i.test(data.url) ? data.url : null;

  const columns: Column<PromptRow>[] = [
    {
      id: "prompt",
      header: "Prompt",
      sortValue: (p) => p.text.toLowerCase(),
      cell: (p) => (
        <span className="flex min-w-56 items-start gap-1.5">
          <CountryFlag iso={p.country} className="mt-0.5" />
          <span className="line-clamp-2 text-sm">{p.text}</span>
        </span>
      ),
    },
    { id: "engines", header: "Models", hideBelow: "md", cell: (p) => <EngineStack ids={p.engines} max={5} /> },
    { id: "citations", header: "Citations", align: "right", sortValue: (p) => p.citations, cell: (p) => <span className="tabular">{p.citations}</span> },
    {
      id: "you",
      header: "You mentioned",
      align: "right",
      sortValue: (p) => p.youMentioned / (p.answers || 1),
      cell: (p) => (
        <span className={cn("tabular", p.youMentioned === 0 && "text-destructive")}>
          {p.youMentioned}/{p.answers}
        </span>
      ),
    },
    { id: "last", header: "Last cited", align: "right", hideBelow: "lg", sortValue: (p) => p.lastCited, cell: (p) => <span className="text-xs text-muted-foreground tabular">{p.lastCited}</span> },
    {
      id: "action",
      header: <span className="sr-only">Action</span>,
      align: "right",
      cell: (p) => (
        <Button variant="outline" size="sm" className="h-7" onClick={() => openAnswer(p.latestAnswerId)}>
          View answer
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon-sm" aria-label="Back to sources">
            <Link href={`/p/${projectId}/ai/sources${query}`}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <Favicon domain={data.domain} className="size-9 rounded-lg" />
          <div className="min-w-0">
            <PageCrumb label={data.kind === "domain" ? data.domain : data.title || data.url.replace(/^https?:\/\/(www\.)?/, "")} />
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{data.kind === "domain" ? data.domain : data.title || data.url.replace(/^https?:\/\/(www\.)?/, "")}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <TypeBadge type={data.contentType} />
              {data.ownership === "own" && <YouBadge />}
              {data.ownership === "competitor" && <Badge variant="outline">{data.competitor ? `${data.competitor.name} (competitor)` : "Competitor"}</Badge>}
              {safeUrl && (
                <a href={safeUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1 truncate hover:underline">
                  <span className="truncate">{data.url.replace(/^https?:\/\//, "")}</span> <ExternalLink className="size-3 shrink-0" />
                </a>
              )}
              {data.kind === "url" && (
                <Link href={`/p/${projectId}/ai/sources/${encodeURIComponent(data.domain)}${query}`} className="underline-offset-2 hover:underline">
                  All pages on {data.domain}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {filters}

      <KpiStrip
        items={[
          { key: "c", label: "Citations", value: data.kpis.citations.toLocaleString(), delta: data.kpis.citationsDelta, deltaSuffix: "" },
          { key: "p", label: "Prompts", value: data.kpis.prompts, delta: data.kpis.promptsDelta },
          { key: "a", label: "Answers citing it", value: data.kpis.answers.toLocaleString() },
          { key: "pos", label: "Avg citation position", value: data.kpis.avgPosition?.toFixed(1) ?? "—", hint: "Order of this source among the citations of an answer (1 = first)." },
          { key: "you", label: "You mentioned", value: data.kpis.youShare == null ? "—" : `${data.kpis.youShare.toFixed(0)}%`, hint: "Share of answers citing this source that also name your brand." },
        ]}
      />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Citations over time">
          {data.kpis.citations === 0 ? (
            <EmptyState compact title="Not cited in this period" />
          ) : (
            <TrendChart data={data.dates.map((d, i) => ({ date: d, n: data.daily[i] }))} series={[{ key: "n", label: "Citations", color: "var(--chart-3)" }]} height={240} />
          )}
        </Panel>
        <Panel title="By engine">
          {data.engines.length === 0 ? (
            <EmptyState compact title="No engines" />
          ) : (
            <RankedBars
              items={data.engines.map((e) => ({ key: e.engine, label: getEngine(e.engine)?.name ?? e.engine, value: e.citations, icon: <EngineIcon id={e.engine} size="xs" withTooltip={false} /> }))}
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <Panel title="Brands in answers citing this source" description="Which brands AI names when it relies on this page">
          {data.brands.length === 0 ? (
            <EmptyState compact title="No brands named" />
          ) : (
            <ul className="space-y-2">
              {data.brands.map((b) => (
                <li key={b.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">{b.isOwn ? "You" : b.name}</span>
                      {b.isOwn && <YouBadge />}
                      {!b.isOwn && !b.tracked && <span className="text-[10px] text-muted-foreground">untracked</span>}
                    </span>
                    <span className="text-xs text-muted-foreground tabular">
                      {b.answers} answers · {b.share.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", b.isOwn ? "bg-brand" : "bg-chart-1")} style={{ width: `${b.share}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={advice.title} icon={youMentioned ? <CheckCircle2 className="size-4 text-success" /> : <Lightbulb className="size-4 text-warning" />}>
          <ol className="space-y-2.5">
            {advice.steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          {!youMentioned && data.kpis.answers > 0 && (
            <p className="mt-4 rounded-lg bg-warning/10 p-3 text-xs text-foreground">
              {data.kpis.answers} answers cite this source without naming you — being listed here directly improves your visibility for {data.kpis.prompts} prompts.
            </p>
          )}
        </Panel>
      </div>

      {data.kind === "domain" && data.urls.length > 0 && (
        <Panel title={`Pages on ${data.domain}`} contentClassName="p-2 sm:p-3">
          <ol className="space-y-0.5">
            {data.urls.map((u) => (
              <li key={u.id}>
                <Link href={`/p/${projectId}/ai/sources/${u.id}${query}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                  <span className="min-w-0 flex-1 truncate">{u.title || u.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                  <span className="text-xs text-muted-foreground tabular">{u.citations}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel title="Prompts citing this source">
        <DataTable
          columns={columns}
          data={data.prompts}
          getRowId={(p) => p.id}
          pageSize={25}
          initialSort={{ id: "citations", dir: "desc" }}
          empty={<EmptyState compact title="No prompts cite this source in this period" />}
          mobileCard={(p) => (
            <div className="space-y-1.5">
              <p className="text-sm">{p.text}</p>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <EngineStack ids={p.engines} />
                <span className="tabular">
                  {p.citations} citations · you {p.youMentioned}/{p.answers}
                </span>
              </div>
              <button type="button" className="text-xs font-medium underline-offset-2 hover:underline" onClick={() => openAnswer(p.latestAnswerId)}>
                View answer
              </button>
            </div>
          )}
        />
      </Panel>
    </div>
  );
}
