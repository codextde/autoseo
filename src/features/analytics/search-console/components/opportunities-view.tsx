"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, BarChart3, Copy, Download, ExternalLink, Info, Loader2, Plus, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable, type Column, type SortState } from "@/components/app/data-table";
import { Meter, formatNumber } from "@/components/app/metrics";
import { EmptyState } from "@/components/app/empty-state";
import { Panel } from "@/components/app/page";
import { cn } from "@/lib/utils";
import { sanitizeForSpreadsheet, toCsv } from "@/server/analytics/search-console/classify";
import type { StrikingRow } from "@/server/analytics/search-console/queries";
import type { SearchOpportunitiesResult, SearchOpportunityRow } from "@/server/analytics/search-console/opportunities";
import { AddPromptButton, sortRows, useAddPrompts } from "./common";

function pathOf(url: string) {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function StrikingDistanceTable({
  projectId,
  rows: input,
  canAddPrompts,
  range,
}: {
  projectId: string;
  rows: StrikingRow[];
  canAddPrompts: boolean;
  range: { from: string; to: string };
}) {
  const [sort, setSort] = useState<SortState>({ id: "impressions", dir: "desc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { added, add, pending } = useAddPrompts(projectId);
  const rows = useMemo(
    () =>
      sortRows(input, sort, {
        query: (r) => r.query,
        page: (r) => r.page,
        impressions: (r) => r.impressions,
        clicks: (r) => r.clicks,
        position: (r) => r.position,
      }),
    [input, sort],
  );
  const chosen = rows.filter((r) => selected.has(r.query));
  const target = chosen.length ? chosen : rows;

  const copyKeywords = async () => {
    const list = [...new Set(target.map((r) => sanitizeForSpreadsheet(r.query.trim())))];
    await navigator.clipboard.writeText(list.join("\n"));
    toast.success(`Copied ${list.length} keyword${list.length === 1 ? "" : "s"}.`);
  };
  const exportCsv = () =>
    download(
      `search-performance-striking-distance-${range.from}-to-${range.to}.csv`,
      toCsv([["Query", "Page", "Impressions", "Clicks", "Position"], ...target.map((r) => [r.query, r.page, r.impressions, r.clicks, r.position.toFixed(1)])]),
    );

  const columns: Column<StrikingRow>[] = [
    {
      id: "query",
      header: "Query",
      sortable: true,
      cell: (r) => (
        <span className="flex min-w-44 items-start gap-1.5 font-medium">
          {r.isPrompt && <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand" />}
          <span className="break-words">{r.query}</span>
        </span>
      ),
    },
    {
      id: "page",
      header: "Page",
      sortable: true,
      hideBelow: "md",
      cell: (r) =>
        /^https?:\/\//.test(r.page) ? (
          <a href={r.page} target="_blank" rel="noreferrer noopener" className="block max-w-72 truncate text-muted-foreground hover:text-foreground hover:underline">
            {pathOf(r.page)}
          </a>
        ) : (
          <span className="block max-w-72 truncate text-muted-foreground">{r.page}</span>
        ),
    },
    { id: "impressions", header: "Impressions", sortable: true, align: "right", cell: (r) => formatNumber(r.impressions, { maximumFractionDigits: 0 }) },
    { id: "clicks", header: "Clicks", sortable: true, align: "right", hideBelow: "sm", cell: (r) => formatNumber(r.clicks, { maximumFractionDigits: 0 }) },
    {
      id: "position",
      header: "Position",
      sortable: true,
      align: "right",
      cell: (r) => (
        <span className={cn("inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium tabular", r.position <= 10 ? "bg-brand/12 text-brand" : "bg-warning/15 text-warning")}>
          {r.position.toFixed(1)}
        </span>
      ),
    },
    ...(canAddPrompts
      ? [
          {
            id: "add",
            header: <span className="sr-only">Track</span>,
            align: "center" as const,
            width: "52px",
            cell: (r: StrikingRow) => (
              <AddPromptButton query={r.query} tracked={r.tracked || added.has(r.query.toLowerCase())} onAdd={(q) => add([q])} disabled={pending} />
            ),
          },
        ]
      : []),
  ];

  return (
    <Panel
      title={
        <>
          <Target className="size-4 text-brand" /> Striking distance
          <span className="text-xs font-normal text-muted-foreground tabular">({input.length})</span>
        </>
      }
      description="Queries ranking at positions 5 to 20, sorted by impressions. Improve the listed page to move them into the top results."
      actions={
        input.length > 0 && (
          <>
            <Button size="sm" variant="outline" onClick={copyKeywords}>
              <Copy className="size-3.5" /> Copy {chosen.length ? chosen.length : ""} keywords
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download className="size-3.5" /> CSV
            </Button>
            {canAddPrompts && chosen.length > 0 && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => add(chosen.filter((r) => !r.tracked).map((r) => r.query), () => setSelected(new Set()))}
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add {chosen.length} as prompts
              </Button>
            )}
          </>
        )
      }
      contentClassName="p-3 sm:p-4"
    >
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.query}
        sort={sort}
        onSortChange={setSort}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        pageSize={50}
        dense
        empty={
          <EmptyState
            icon={Target}
            compact
            title="No striking-distance queries"
            description="No query ranks between positions 5 and 20 in this period (needs Google Search Console query × page data)."
          />
        }
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 text-sm font-medium break-words">{r.query}</span>
              {canAddPrompts && (
                <AddPromptButton query={r.query} tracked={r.tracked || added.has(r.query.toLowerCase())} onAdd={(q) => add([q])} disabled={pending} />
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">{pathOf(r.page)}</p>
            <p className="text-xs text-muted-foreground tabular">
              Pos. <b className="text-foreground">{r.position.toFixed(1)}</b> · {formatNumber(r.impressions, { maximumFractionDigits: 0 })} impr. · {r.clicks} clicks
            </p>
          </div>
        )}
      />
    </Panel>
  );
}

function ScoreCell({ row }: { row: SearchOpportunityRow }) {
  if (row.score == null)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs text-muted-foreground">Not in GA4</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">No organic Google Analytics landing-page data matched this URL, so it can’t be scored.</TooltipContent>
      </Tooltip>
    );
  const c = row.scoreComponents!;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex w-24 items-center gap-2">
          <span className="w-7 text-right text-sm font-semibold tabular">{row.score}</span>
          <Meter value={row.score} className="w-14" tone={row.score >= 70 ? "brand" : row.score >= 40 ? "warning" : "foreground"} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        <div className="space-y-0.5 tabular">
          <div>Demand {Math.round(c.demand * 100)} · 50%</div>
          <div>Business value {Math.round(c.businessValue * 100)} · 30%</div>
          <div>Reachability {Math.round(c.reachability * 100)} · 20%</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function OpportunityScoring({ result, projectId }: { result: SearchOpportunitiesResult; projectId: string }) {
  const [sort, setSort] = useState<SortState>(null);
  const rows = useMemo(
    () =>
      sortRows(result.status === "ok" ? result.rows : [], sort, {
        page: (r) => r.page,
        score: (r) => r.score,
        impressions: (r) => r.impressions,
        position: (r) => r.position,
        sessions: (r) => r.ga4?.sessions,
        rate: (r) => r.ga4?.sessionKeyEventRate,
      }),
    [result, sort],
  );

  const header = (
    <>
      <BarChart3 className="size-4 text-brand" /> Search opportunities
      <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">GSC × GA4</span>
    </>
  );

  if (result.status === "ga4_not_connected")
    return (
      <Panel title={header} description="Scores pages ranking 4–20 by demand, business value and reachability.">
        <EmptyState
          icon={BarChart3}
          compact
          title="Connect Google Analytics to score opportunities"
          description="The score joins Search Console pages with GA4 organic landing-page performance (key-event rate) to show which pages are worth improving first."
          action={
            <Button asChild size="sm">
              <Link href={`/p/${projectId}/analytics/traffic?tab=settings`}>Connect Google Analytics</Link>
            </Button>
          }
        />
      </Panel>
    );
  if (result.status !== "ok")
    return (
      <Panel title={header}>
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Couldn’t load opportunities</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      </Panel>
    );

  const bv = result.scoring.engagementFallback ? "Engagement rate" : "Key-event rate";
  const columns: Column<SearchOpportunityRow>[] = [
    {
      id: "page",
      header: "Page",
      sortable: true,
      cell: (r) => (
        <a href={r.page} target="_blank" rel="noreferrer noopener" className="group/link flex max-w-[24rem] items-center gap-1.5 font-medium hover:underline">
          <span className="truncate">{pathOf(r.page)}</span>
          <ExternalLink className="size-3 shrink-0 opacity-0 group-hover/link:opacity-60" />
        </a>
      ),
    },
    { id: "score", header: "Score", sortable: true, cell: (r) => <ScoreCell row={r} /> },
    { id: "impressions", header: "Impressions", sortable: true, align: "right", cell: (r) => formatNumber(r.impressions, { maximumFractionDigits: 0 }) },
    { id: "position", header: "Position", sortable: true, align: "right", cell: (r) => r.position.toFixed(1) },
    { id: "sessions", header: "Organic sessions", sortable: true, align: "right", hideBelow: "md", cell: (r) => (r.ga4 ? formatNumber(r.ga4.sessions, { maximumFractionDigits: 0 }) : "—") },
    {
      id: "rate",
      header: bv,
      sortable: true,
      align: "right",
      hideBelow: "lg",
      cell: (r) => {
        const v = result.scoring.engagementFallback ? r.ga4?.engagementRate : r.ga4?.sessionKeyEventRate;
        return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
      },
    },
  ];

  return (
    <Panel
      title={header}
      description={`Pages ranking 4–20 · ${result.request.dateRange.startDate} → ${result.request.dateRange.endDate} · ${result.coverage.matchedRows} of ${result.totalCandidateRows} matched in GA4`}
      contentClassName="space-y-3 p-3 sm:p-4"
    >
      {result.warnings.map((w) => (
        <p key={w.code} className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3 shrink-0" /> {w.message}
        </p>
      ))}
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.normalizedPage}
        sort={sort}
        onSortChange={setSort}
        pageSize={25}
        dense
        empty={<EmptyState icon={BarChart3} compact title="No pages ranking 4–20" description="No Search Console page ranks between positions 4 and 20 in this window." />}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{pathOf(r.page)}</span>
              <ScoreCell row={r} />
            </div>
            <p className="text-xs text-muted-foreground tabular">
              Pos. {r.position.toFixed(1)} · {formatNumber(r.impressions, { maximumFractionDigits: 0 })} impr.
              {r.ga4 ? ` · ${formatNumber(r.ga4.sessions, { maximumFractionDigits: 0 })} sessions` : ""}
            </p>
          </div>
        )}
      />
      <p className="text-[11px] text-muted-foreground">
        Score = 50% demand (impressions) + 30% business value ({bv.toLowerCase()}) + 20% reachability (distance to the top), as percentile ranks across matched pages.
      </p>
    </Panel>
  );
}
