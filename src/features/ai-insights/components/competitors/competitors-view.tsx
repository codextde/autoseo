"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, Columns3, Download, Grid3x3, LineChart, MoreHorizontal, Plus, Settings2, Swords } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel } from "@/components/app/page";
import { DataTable, type Column, type SortState } from "@/components/app/data-table";
import { BarsChart, Heatmap, TrendChart, type ValueFormat } from "@/components/app/charts";
import { SearchInput } from "@/components/app/filters";
import { EmptyState } from "@/components/app/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getEngine } from "@/lib/engines";
import { cn } from "@/lib/utils";
import { removeCompetitorAction, setCompetitorTrackedAction } from "../../actions";
import { downloadCsv } from "../../lib/csv";
import { useClientListParam, useClientParam } from "../../lib/client-url";
import { formatMetric, METRICS, type MetricKey } from "../../lib/metrics";
import type { BrandDTO, CompetitorsData, RankingRow } from "../../types";
import { BrandLabel, MetricCell, ModelVisibility, YouBadge } from "../brand";
import { CompetitorDialog, type CompetitorFormValue } from "./competitor-dialog";
import { SuggestedCompetitors } from "./suggestions";

const BASE_TABS: MetricKey[] = ["mentionRate", "visibility", "mentions", "sentiment", "citations", "sov"];
const EXTRA_TABS: MetricKey[] = ["citationRate", "avgPosition", "mentionDepth", "firstShare", "top3Share", "citationShare"];

export function chartFormat(m: MetricKey): ValueFormat {
  const f = METRICS[m].format;
  return f === "percent" ? "percent" : f === "decimal" ? "decimal" : "number";
}

function chartDomain(m: MetricKey): [number | "auto", number | "auto"] {
  if (m === "sentiment") return [0, 100];
  if (METRICS[m].format === "percent") return [0, "auto"];
  return ["auto", "auto"];
}

type Row = RankingRow & { brand: BrandDTO; rank: number };

const TABLE_COLUMNS: { id: string; label: string; metric?: MetricKey }[] = [
  { id: "avgPosition", label: "Avg Position", metric: "avgPosition" },
  { id: "mentionDepth", label: "Mention Depth", metric: "mentionDepth" },
  { id: "mentions", label: "Mentions", metric: "mentions" },
  { id: "citationRate", label: "Citation Rate", metric: "citationRate" },
  { id: "sentiment", label: "Sentiment", metric: "sentiment" },
  { id: "mentionRate", label: "Mention Rate", metric: "mentionRate" },
  { id: "visibility", label: "Visibility", metric: "visibility" },
  { id: "sov", label: "Share of Voice", metric: "sov" },
  { id: "models", label: "Model Visibility" },
];

export function CompetitorsView({
  projectId,
  data,
  canManage,
  query,
}: {
  projectId: string;
  data: CompetitorsData;
  canManage: boolean;
  /** Current filter query string (e.g. "?period=90d") to keep on detail links. */
  query: string;
}) {
  const [metric, setMetric] = useClientParam("metric", "mentionRate");
  const [chart, setChart] = useClientParam("chart", "line");
  const [slice, setSlice] = useClientParam("slice", "model");
  const [extra, setExtra] = useClientListParam("extra");
  const [list, setList] = useClientParam("list", "all");
  const [q, setQ] = useClientParam("q", "");
  const [sortParam, setSortParam] = useClientParam("sort", "visibility:desc");
  const [hidden, setHidden] = useClientListParam("hide");
  const [hiddenBrands, setHiddenBrands] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ open: boolean; value: CompetitorFormValue | null }>({ open: false, value: null });

  const m = (Object.keys(METRICS).includes(metric) ? metric : "mentionRate") as MetricKey;
  const tabs = [...BASE_TABS, ...EXTRA_TABS.filter((t) => extra.includes(t))];
  const brandByKey = useMemo(() => new Map(data.brands.map((b) => [b.key, b])), [data.brands]);

  const allRows: Row[] = useMemo(() => {
    const ranked = [...data.rows].sort((a, b) => (b.metrics.visibility ?? 0) - (a.metrics.visibility ?? 0));
    return ranked.map((r, i) => ({ ...r, brand: brandByKey.get(r.key)!, rank: i + 1 }));
  }, [data.rows, brandByKey]);

  const myList = allRows.filter((r) => r.brand.tracked);
  const scoped = list === "mine" ? myList : allRows;

  // Brands shown in the chart: own + My List, ranked by the active metric (max 10).
  const chartBrands = useMemo(() => {
    const dir = METRICS[m].invert ? 1 : -1;
    return [...allRows]
      .filter((r) => r.brand.isOwn || r.brand.tracked)
      .sort((a, b) => {
        const av = a.metrics[m];
        const bv = b.metrics[m];
        if (av == null) return 1;
        if (bv == null) return -1;
        return dir * (av - bv);
      })
      .slice(0, 10);
  }, [allRows, m]);

  const visibleChartBrands = chartBrands.filter((r) => !hiddenBrands.has(r.key));

  /* ── table ── */
  const [sortId, sortDir] = sortParam.split(":") as [string, "asc" | "desc"];
  const sort: SortState = useMemo(() => (sortId ? { id: sortId, dir: sortDir === "asc" ? "asc" : "desc" } : null), [sortId, sortDir]);
  const tableRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? scoped.filter((r) => r.brand.name.toLowerCase().includes(needle) || (r.brand.domain ?? "").includes(needle))
      : scoped;
    if (!sort) return filtered;
    const get = (r: Row): number | string | null => (sort.id === "brand" ? r.brand.name.toLowerCase() : sort.id === "rank" ? r.rank : (r.metrics[sort.id as MetricKey] ?? null));
    return [...filtered].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [scoped, q, sort]);

  const onToggleTracked = async (b: BrandDTO) => {
    const r = await setCompetitorTrackedAction(projectId, b.competitorId!, !b.tracked);
    if (!r.ok) toast.error(r.error);
    else toast.success(b.tracked ? `${b.name} removed from My List` : `${b.name} added to My List`);
  };

  const columns: Column<Row>[] = [
    {
      id: "rank",
      header: "Ranking",
      sortable: true,
      sticky: true,
      cell: (r) => (
        <div className="flex min-w-44 items-center gap-2.5">
          <span className="w-5 shrink-0 text-xs text-muted-foreground tabular">{r.rank}</span>
          <BrandLabel name={r.brand.name} domain={r.brand.domain} isOwn={r.brand.isOwn} color={r.brand.color} showDomain />
        </div>
      ),
    },
    ...TABLE_COLUMNS.filter((c) => !hidden.includes(c.id)).map<Column<Row>>((c) =>
      c.metric
        ? {
            id: c.id,
            header: c.label,
            align: "right",
            sortable: true,
            hint: METRICS[c.metric].hint,
            cell: (r) => <MetricCell metric={c.metric!} value={r.metrics[c.metric!]} delta={r.deltas[c.metric!]} />,
          }
        : {
            id: c.id,
            header: c.label,
            hideBelow: "md",
            cell: (r) => <ModelVisibility engines={r.engines} />,
          },
    ),
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (r) => <RowActions row={r} projectId={projectId} query={query} canManage={canManage} onEdit={() => setDialog({ open: true, value: toForm(r.brand) })} onToggle={() => onToggleTracked(r.brand)} />,
    },
  ];

  const exportCsv = () =>
    downloadCsv(
      `competitors-${new Date().toISOString().slice(0, 10)}`,
      ["Rank", "Brand", "Domain", "You", "Avg Position", "Mention Depth %", "Mentions", "Citation Rate %", "Sentiment", "Mention Rate %", "Visibility %", "Share of Voice %", "My List"],
      tableRows.map((r) => [
        r.rank,
        r.brand.name,
        r.brand.domain,
        r.brand.isOwn ? "yes" : "",
        r.metrics.avgPosition,
        r.metrics.mentionDepth,
        r.metrics.mentions,
        r.metrics.citationRate,
        r.metrics.sentiment,
        r.metrics.mentionRate,
        r.metrics.visibility,
        r.metrics.sov,
        r.brand.tracked ? "yes" : "no",
      ]),
    );

  const noData = data.totals.answers === 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Panel contentClassName="p-0 sm:p-0">
        <div className="flex flex-col gap-2 border-b px-3 pt-2 sm:flex-row sm:items-center sm:px-4">
          <nav className="scrollbar-none -mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setMetric(t)}
                className={cn(
                  "shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
                  t === m ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {METRICS[t].label}
              </button>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="my-1 shrink-0" aria-label="Metric settings">
                  <Settings2 className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>More metrics</DropdownMenuLabel>
                {EXTRA_TABS.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t}
                    checked={extra.includes(t)}
                    onCheckedChange={(v) => setExtra(v ? [...extra, t] : extra.filter((x) => x !== t))}
                  >
                    {METRICS[t].label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
          <div className="flex items-center gap-2 pb-2 sm:pb-0">
            {chart !== "line" && (
              <div className="flex items-center gap-1 text-xs">
                <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Slice</span>
                <div className="flex rounded-lg bg-muted p-0.5">
                  {(["tag", "model"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSlice(s)}
                      className={cn("rounded-md px-2 py-1 font-medium capitalize", slice === s ? "bg-background shadow-xs" : "text-muted-foreground")}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex rounded-lg bg-muted p-0.5">
              {[
                { k: "line", icon: LineChart, label: "Line chart" },
                { k: "bar", icon: BarChart3, label: "Bar chart" },
                { k: "heatmap", icon: Grid3x3, label: "Heatmap" },
              ].map(({ k, icon: Icon, label }) => (
                <button
                  key={k}
                  type="button"
                  aria-label={label}
                  title={label}
                  onClick={() => setChart(k)}
                  className={cn("rounded-md p-1.5", chart === k ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")}
                >
                  <Icon className="size-3.5" />
                </button>
              ))}
            </div>
          </div>
        </div>
        {noData ? (
          <EmptyState
            icon={Swords}
            title="No answers in this period yet"
            description="Competitor metrics appear once tracked prompts have been answered by the enabled AI engines. Try a longer period or check the Tracker."
          />
        ) : (
          <div className="grid gap-4 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0">
              <MetricChart data={data} metric={m} chart={chart} slice={slice} brands={visibleChartBrands.map((r) => r.brand)} />
            </div>
            <ol className="space-y-0.5 lg:border-l lg:pl-4">
              {chartBrands.map((r, i) => {
                const off = hiddenBrands.has(r.key);
                return (
                  <li key={r.key}>
                    <button
                      type="button"
                      onClick={() => {
                        const next = new Set(hiddenBrands);
                        if (off) next.delete(r.key);
                        else next.add(r.key);
                        setHiddenBrands(next);
                      }}
                      className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted", off && "opacity-40")}
                    >
                      <span className="w-4 text-xs text-muted-foreground tabular">{i + 1}</span>
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.brand.color }} />
                      <span className="min-w-0 flex-1 truncate">{r.brand.name}</span>
                      {r.brand.isOwn && <YouBadge />}
                      <span className="text-xs font-medium tabular">{formatMetric(m, r.metrics[m])}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </Panel>

      <Panel
        title="Visibility Ranking"
        description={`${data.totals.answers.toLocaleString()} answers across ${data.totals.prompts} prompts`}
        actions={
          canManage && (
            <Button size="sm" onClick={() => setDialog({ open: true, value: null })}>
              <Plus className="size-3.5" /> Add competitor
            </Button>
          )
        }
      >
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex rounded-lg bg-muted p-0.5 text-xs">
            {[
              { k: "all", label: `All Competitors (${allRows.length})` },
              { k: "mine", label: `My List (${myList.length})` },
            ].map((t) => (
              <button
                key={t.k}
                type="button"
                onClick={() => setList(t.k)}
                className={cn("rounded-md px-2.5 py-1 font-medium whitespace-nowrap", list === t.k ? "bg-background shadow-xs" : "text-muted-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search competitors…" className="sm:max-w-64 sm:flex-1" />
          <div className="flex items-center gap-2 sm:ml-auto">
            <Select value={sortParam} onValueChange={(v) => setSortParam(v)}>
              <SelectTrigger size="sm" className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["visibility", "mentionRate", "mentions", "sentiment", "citationRate", "sov", "avgPosition", "mentionDepth"] as MetricKey[]).map((k) => (
                  <SelectItem key={k} value={`${k}:${METRICS[k].invert ? "asc" : "desc"}`}>
                    Sort: {METRICS[k].label}
                  </SelectItem>
                ))}
                <SelectItem value="brand:asc">Sort: Name</SelectItem>
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-sm" className="size-8" aria-label="Columns">
                  <Columns3 className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Columns</DropdownMenuLabel>
                {TABLE_COLUMNS.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={!hidden.includes(c.id)}
                    onCheckedChange={(v) => setHidden(v ? hidden.filter((h) => h !== c.id) : [...hidden, c.id])}
                  >
                    {c.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" className="h-8" onClick={exportCsv} disabled={!tableRows.length}>
              <Download className="size-3.5" /> Export ({tableRows.length})
            </Button>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={tableRows}
          getRowId={(r) => r.key}
          sort={sort}
          onSortChange={(s) => setSortParam(s ? `${s.id}:${s.dir}` : null)}
          rowClassName={(r) => (r.brand.isOwn ? "bg-brand-soft/30" : undefined)}
          empty={
            <EmptyState
              compact
              icon={Swords}
              title={list === "mine" ? "Your list is empty" : "No competitors yet"}
              description={canManage ? "Add the brands you compete with — or accept a suggestion below." : "Ask a project manager to add competitors."}
            />
          }
          mobileCard={(r) => (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular">#{r.rank}</span>
                  <BrandLabel name={r.brand.name} domain={r.brand.domain} isOwn={r.brand.isOwn} color={r.brand.color} showDomain />
                </div>
                <RowActions row={r} projectId={projectId} query={query} canManage={canManage} onEdit={() => setDialog({ open: true, value: toForm(r.brand) })} onToggle={() => onToggleTracked(r.brand)} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {(["visibility", "mentionRate", "sentiment"] as MetricKey[]).map((k) => (
                  <div key={k} className="rounded-lg bg-muted/60 px-2 py-1.5">
                    <div className="text-[10px] text-muted-foreground">{METRICS[k].label}</div>
                    <MetricCell metric={k} value={r.metrics[k]} delta={r.deltas[k]} className="items-start" />
                  </div>
                ))}
              </div>
              <ModelVisibility engines={r.engines} />
            </div>
          )}
        />
      </Panel>

      <SuggestedCompetitors projectId={projectId} suggestions={data.suggestions} canManage={canManage} />

      {canManage && (
        <CompetitorDialog projectId={projectId} open={dialog.open} initial={dialog.value} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} />
      )}
    </div>
  );
}

function toForm(b: BrandDTO): CompetitorFormValue {
  return { id: b.competitorId ?? undefined, name: b.name, domain: b.domain, aliases: b.aliases, tracked: b.tracked };
}

function RowActions({
  row,
  projectId,
  query,
  canManage,
  onEdit,
  onToggle,
}: {
  row: Row;
  projectId: string;
  query: string;
  canManage: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const b = row.brand;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const href = b.isOwn ? `/p/${projectId}/ai/tracker` : `/p/${projectId}/ai/competitors/${b.competitorId}${query}`;
  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <Button asChild variant="outline" size="sm" className="h-7">
        <Link href={href}>Analyze</Link>
      </Button>
      {canManage && !b.isOwn && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
              <DropdownMenuItem onSelect={onToggle}>{b.tracked ? "Remove from My List" : "Add to My List"}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialog open={confirm} onOpenChange={setConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {b.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  The competitor is removed from this project. Its past mentions stay available as an untracked brand and can be re-added later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy}
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    const r = await removeCompetitorAction(projectId, b.competitorId!);
                    setBusy(false);
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(`${b.name} removed`);
                    setConfirm(false);
                  }}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

function MetricChart({ data, metric, chart, slice, brands }: { data: CompetitorsData; metric: MetricKey; chart: string; slice: string; brands: BrandDTO[] }) {
  const format = chartFormat(metric);
  const series = brands.map((b) => ({ key: b.key, label: b.name, color: b.color }));

  if (chart === "line") {
    const rows = data.dates.map((d, i) => {
      const row: Record<string, unknown> = { date: d };
      for (const b of brands) row[b.key] = data.series[b.key]?.[metric]?.[i] ?? null;
      return row;
    });
    return <TrendChart data={rows} series={series} type="line" format={format} domain={chartDomain(metric)} height={320} />;
  }

  const sliceKeys =
    slice === "tag"
      ? data.byTag.keys.map((t) => ({ key: t.id, label: t.name }))
      : data.byEngine.keys.map((e) => ({ key: e, label: getEngine(e)?.shortName ?? e }));
  const valueOf = (brandKey: string, sliceKey: string) =>
    (slice === "tag" ? data.byTag.values[brandKey]?.[sliceKey] : data.byEngine.values[brandKey]?.[sliceKey])?.[metric] ?? null;

  if (!sliceKeys.length)
    return <EmptyState compact title={slice === "tag" ? "No tags yet" : "No engines"} description={slice === "tag" ? "Tag your prompts in the Tracker to slice by tag." : undefined} />;

  if (chart === "bar") {
    const rows = sliceKeys.map((s) => {
      const row: Record<string, unknown> = { slice: s.label };
      for (const b of brands) row[b.key] = valueOf(b.key, s.key);
      return row;
    });
    return <BarsChart data={rows} series={series} xKey="slice" format={format} height={320} xFormatter={(v) => v} />;
  }

  const values: Record<string, Record<string, number | null>> = {};
  for (const b of brands) {
    values[b.key] = {};
    for (const s of sliceKeys) values[b.key]![s.key] = valueOf(b.key, s.key);
  }
  return (
    <Heatmap
      rows={brands.map((b) => ({
        key: b.key,
        label: (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: b.color }} />
            {b.name}
            {b.isOwn && <YouBadge />}
          </span>
        ),
      }))}
      cols={sliceKeys}
      values={values}
      format={format}
      rowHeader={slice === "tag" ? "Brand × Tag" : "Brand × Model"}
    />
  );
}
