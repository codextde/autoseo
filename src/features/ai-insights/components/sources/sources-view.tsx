"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Download, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { DonutChart, TrendChart, CHART_COLORS } from "@/components/app/charts";
import { MultiSelect, SearchInput } from "@/components/app/filters";
import { Delta } from "@/components/app/metrics";
import { EngineIcon, EngineStack } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import type { SourceRow, SourcesOverview } from "@/server/ai/insights/sources";
import { downloadCsv } from "../../lib/csv";
import { useClientListParam, useClientParam } from "../../lib/client-url";
import { sourceType, SOURCE_TYPES } from "../../lib/source-types";
import { YouBadge } from "../brand";

export function TypeBadge({ type }: { type: string }) {
  const t = sourceType(type);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `color-mix(in oklch, ${t.color} 14%, transparent)`, color: t.color }}>
      <span className="size-1.5 rounded-full" style={{ background: t.color }} />
      {t.label}
    </span>
  );
}

export function SourcesView({ projectId, data, query }: { projectId: string; data: SourcesOverview; query: string }) {
  const [group, setGroup, groupPending] = useUrlState("group", "url");
  const [q, setQ] = useClientParam("q", "");
  const [types, setTypes] = useClientListParam("types");
  const [own, setOwn] = useClientParam("own", "all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.table.filter((r) => {
      if (types.length && !types.includes(r.contentType)) return false;
      if (own !== "all" && r.ownership !== own) return false;
      if (needle && !`${r.url} ${r.title ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data.table, q, types, own]);

  const seriesDomains = Object.keys(data.topSeries);
  const chartRows = data.dates.map((d, i) => {
    const row: Record<string, unknown> = { date: d };
    seriesDomains.forEach((dom, j) => (row[`s${j}`] = data.topSeries[dom]![i]));
    return row;
  });

  const detailHref = (r: SourceRow) => `/p/${projectId}/ai/sources/${encodeURIComponent(r.id)}${query}`;

  const columns: Column<SourceRow>[] = [
    {
      id: "source",
      header: "Source",
      sticky: true,
      sortValue: (r) => r.url,
      cell: (r) => (
        <Link href={detailHref(r)} className="flex max-w-md min-w-56 items-center gap-2.5 hover:underline">
          <Favicon domain={r.domain} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{data.group === "domain" ? r.domain : r.title || r.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
            {data.group === "url" && <span className="block truncate text-xs text-muted-foreground">{r.url.replace(/^https?:\/\/(www\.)?/, "")}</span>}
          </span>
          {r.ownership === "own" && <YouBadge />}
          {r.ownership === "competitor" && (
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
              Competitor
            </Badge>
          )}
        </Link>
      ),
    },
    { id: "type", header: "Content Type", hideBelow: "md", sortValue: (r) => r.contentType, cell: (r) => <TypeBadge type={r.contentType} /> },
    { id: "models", header: "Models", hideBelow: "lg", cell: (r) => <EngineStack ids={r.engines} max={4} /> },
    {
      id: "citations",
      header: "Citations",
      align: "right",
      sortValue: (r) => r.citations,
      cell: (r) => (
        <span className="inline-flex flex-col items-end leading-tight">
          <span className="font-medium tabular">{r.citations.toLocaleString()}</span>
          <Delta value={r.citationsDelta} digits={0} showZero={false} />
        </span>
      ),
    },
    {
      id: "prompts",
      header: "Prompts",
      align: "right",
      sortValue: (r) => r.prompts,
      cell: (r) => (
        <span className="inline-flex flex-col items-end leading-tight">
          <span className="font-medium tabular">{r.prompts}</span>
          <Delta value={r.promptsDelta} digits={0} showZero={false} />
        </span>
      ),
    },
    {
      id: "action",
      header: <span className="sr-only">Action</span>,
      align: "right",
      cell: (r) => (
        <Button asChild variant="outline" size="sm" className="h-7">
          <Link href={detailHref(r)}>Analyze</Link>
        </Button>
      ),
    },
  ];

  if (data.totals.citations === 0 && data.table.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={Link2}
          title="No citations in this period"
          description="Sources appear once AI engines answer your tracked prompts with citations (ChatGPT search, Perplexity, AI Overviews…). Try a longer period."
        />
      </Panel>
    );
  }

  const maxTop = Math.max(1, ...data.top.map((t) => t.citations));

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Top Sources" description={`${data.totals.citations.toLocaleString()} citations · ${data.totals.domains} domains · ${data.totals.answers.toLocaleString()} answers`}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <TrendChart
              data={chartRows}
              series={seriesDomains.map((d, j) => ({ key: `s${j}`, label: d, color: CHART_COLORS[j % CHART_COLORS.length] }))}
              type="line"
              height={280}
            />
            <ol className="space-y-0.5">
              {data.top.map((t, i) => (
                <li key={t.domain}>
                  <Link
                    href={`/p/${projectId}/ai/sources/${encodeURIComponent(t.domain)}${query}`}
                    className="relative flex items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-sm hover:ring-1 hover:ring-border"
                  >
                    <span className="absolute inset-y-0 left-0 rounded-lg bg-muted" style={{ width: `${(t.citations / maxTop) * 100}%` }} />
                    <span className="relative w-4 text-xs text-muted-foreground tabular">{i + 1}</span>
                    {i < seriesDomains.length && <span className="relative size-2 shrink-0 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />}
                    <Favicon domain={t.domain} className="relative" />
                    <span className="relative min-w-0 flex-1 truncate">{t.domain}</span>
                    {t.ownership === "own" && <YouBadge className="relative" />}
                    <span className="relative text-xs tabular">{t.citations.toLocaleString()}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </Panel>
        <Panel title="Source Types" description="What kind of pages AI engines cite">
          <DonutChart
            data={data.types.map((t) => ({ name: sourceType(t.type).label, value: t.citations, color: sourceType(t.type).color }))}
            height={200}
            center={
              <div className="flex max-w-24 flex-wrap justify-center gap-0.5">
                {data.engines.slice(0, 6).map((e) => (
                  <EngineIcon key={e} id={e} size="xs" withTooltip={false} />
                ))}
              </div>
            }
          />
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {data.types.map((t) => (
              <li key={t.type} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: sourceType(t.type).color }} />
                  <span className="truncate">{sourceType(t.type).label}</span>
                </span>
                <span className="text-xs text-muted-foreground tabular">{t.share.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title="Source Analysis"
        description="Every page AI engines cite in answers to your prompts"
        actions={
          <div className={cn("flex rounded-lg bg-muted p-0.5 text-xs", groupPending && "opacity-60")}>
            {[
              { k: "url", label: "Pages" },
              { k: "domain", label: "Domains" },
            ].map((t) => (
              <button
                key={t.k}
                type="button"
                onClick={() => setGroup(t.k)}
                className={cn("rounded-md px-2.5 py-1 font-medium", group === t.k ? "bg-background shadow-xs" : "text-muted-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search sources…" className="sm:max-w-72 sm:flex-1" />
          <MultiSelect
            options={Object.entries(SOURCE_TYPES)
              .filter(([k]) => data.types.some((t) => t.type === k))
              .map(([value, v]) => ({ value, label: v.label, count: data.types.find((t) => t.type === value)?.citations }))}
            value={types}
            onChange={setTypes}
            placeholder="All Types"
            label="Types"
          />
          <MultiSelect
            single
            options={[
              { value: "own", label: "Your domain" },
              { value: "competitor", label: "Competitor domains" },
              { value: "third_party", label: "Third-party" },
            ]}
            value={own === "all" ? [] : [own]}
            onChange={(v) => setOwn(v[0] ?? null)}
            placeholder="All owners"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 sm:ml-auto"
            disabled={!filtered.length}
            onClick={() =>
              downloadCsv(
                `sources-${new Date().toISOString().slice(0, 10)}`,
                ["Source", "Title", "Domain", "Content type", "Ownership", "Models", "Citations", "Citations Δ", "Prompts", "Prompts Δ"],
                filtered.map((r) => [r.url, r.title, r.domain, r.contentType, r.ownership, r.engines.join(" "), r.citations, r.citationsDelta, r.prompts, r.promptsDelta]),
              )
            }
          >
            <Download className="size-3.5" /> Export ({filtered.length})
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={filtered}
          getRowId={(r) => r.id}
          initialSort={{ id: "citations", dir: "desc" }}
          pageSize={25}
          empty={<EmptyState compact title="No sources match" description="Try clearing the filters." />}
          mobileCard={(r) => (
            <Link href={detailHref(r)} className="block space-y-1.5">
              <div className="flex items-center gap-2">
                <Favicon domain={r.domain} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{data.group === "domain" ? r.domain : r.title || r.url}</span>
                {r.ownership === "own" && <YouBadge />}
              </div>
              <div className="flex items-center justify-between gap-2">
                <TypeBadge type={r.contentType} />
                <span className="text-xs text-muted-foreground tabular">
                  {r.citations} citations · {r.prompts} prompts
                </span>
              </div>
            </Link>
          )}
        />
      </Panel>
    </div>
  );
}
