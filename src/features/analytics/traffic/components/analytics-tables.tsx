"use client";

import { useMemo } from "react";
import { Bot } from "lucide-react";
import { Panel } from "@/components/app/page";
import { DataTable, type Column, type SortState } from "@/components/app/data-table";
import { MultiSelect } from "@/components/app/filters";
import { CountryFlag } from "@/components/app/misc";
import { formatCurrency, formatNumber, formatPercent } from "@/components/app/metrics";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUrlPatch } from "@/hooks/use-url-state";
import { getAiPlatform } from "@/server/analytics/ai-platforms";
import type { TrafficTableRow } from "@/server/analytics/traffic/queries";
import { cn } from "@/lib/utils";
import { countryName, formatDuration, PlatformIcon, PlatformStack } from "./common";

export type AnalyticsTab = "urls" | "location" | "engagement";

const TABS: { key: AnalyticsTab; label: string }[] = [
  { key: "urls", label: "URLs" },
  { key: "location", label: "Location" },
  { key: "engagement", label: "Engagement" },
];

export const SORT_OPTIONS = [
  { key: "sessions", label: "Sessions" },
  { key: "conversions", label: "Conversions" },
  { key: "revenue", label: "Revenue" },
  { key: "avg_time", label: "Avg. time" },
  { key: "conv_rate", label: "Conversion rate" },
  { key: "engagement_rate", label: "Engagement rate" },
] as const;

const SORT_VALUE: Record<string, (r: TrafficTableRow) => number> = {
  sessions: (r) => r.sessions,
  conversions: (r) => r.conversions,
  revenue: (r) => r.revenue,
  avg_time: (r) => r.avgTime ?? -1,
  conv_rate: (r) => r.conversionRate ?? -1,
  engagement_rate: (r) => r.engagementRate ?? -1,
  label: () => 0,
};

/** `?sort=` → "revenue" (desc) or "revenue.asc". */
export function parseSort(raw: string | undefined): { id: string; dir: "asc" | "desc" } {
  const [id, dir] = (raw ?? "sessions").split(".");
  return { id: id && id in SORT_VALUE ? id : "sessions", dir: dir === "asc" ? "asc" : "desc" };
}

export function TrafficAnalyticsPanel({
  tab,
  rows,
  sort,
  models,
  availableModels,
  currency,
  periodLabel,
}: {
  tab: AnalyticsTab;
  rows: TrafficTableRow[];
  sort: string;
  models: string[];
  availableModels: string[];
  currency: string;
  periodLabel: string;
}) {
  const [patch] = useUrlPatch();
  const s = parseSort(sort);
  const sorted = useMemo(() => {
    const get = SORT_VALUE[s.id] ?? SORT_VALUE.sessions!;
    const list = [...rows];
    if (s.id === "label") list.sort((a, b) => a.label.localeCompare(b.label) * (s.dir === "asc" ? 1 : -1));
    else list.sort((a, b) => (get(a) - get(b)) * (s.dir === "asc" ? 1 : -1));
    return list;
  }, [rows, s.id, s.dir]);

  const rankOf = useMemo(() => new Map(sorted.map((r, i) => [r.key, i + 1])), [sorted]);

  const setSort = (next: SortState) => {
    if (!next) return patch({ sort: null });
    const v = next.dir === "desc" ? next.id : `${next.id}.asc`;
    patch({ sort: v === "sessions" ? null : v });
  };

  const labelHeader = tab === "urls" ? "Page" : tab === "location" ? "Country" : "AI Model";
  const columns: Column<TrafficTableRow>[] = [
    {
      id: "rank",
      header: "#",
      cell: (r) => <span className="text-xs text-muted-foreground tabular">{rankOf.get(r.key)}</span>,
      width: "40px",
    },
    {
      id: "label",
      header: labelHeader,
      sortable: true,
      cell: (r) =>
        tab === "urls" ? (
          <span className="block max-w-[420px] truncate font-medium" title={r.label}>
            {r.label}
          </span>
        ) : tab === "location" ? (
          <span className="flex items-center gap-2 font-medium">
            {r.key !== "__unknown__" ? <CountryFlag iso={r.key} /> : <span className="text-muted-foreground">🌐</span>}
            {countryName(r.key)}
          </span>
        ) : (
          <span className="flex items-center gap-2 font-medium">
            <PlatformIcon id={r.key} size="sm" />
            {r.label}
          </span>
        ),
    },
    ...(tab !== "engagement"
      ? [
          {
            id: "models",
            header: "AI Models",
            cell: (r: TrafficTableRow) => <PlatformStack ids={r.platforms} />,
            hideBelow: "md" as const,
          },
        ]
      : []),
    {
      id: "sessions",
      header: "Sessions",
      align: "right",
      sortable: true,
      cell: (r) => (
        <span className="inline-flex flex-col items-end">
          <span className="font-medium">{formatNumber(r.sessions, { maximumFractionDigits: 0 })}</span>
          <span className="text-[11px] text-muted-foreground">{formatPercent(r.share)}</span>
        </span>
      ),
    },
    ...(tab === "engagement"
      ? [
          {
            id: "engagement_rate",
            header: "Engaged",
            align: "right" as const,
            sortable: true,
            cell: (r: TrafficTableRow) => formatPercent(r.engagementRate),
          },
        ]
      : []),
    {
      id: "conversions",
      header: "Conversions",
      align: "right",
      sortable: true,
      cell: (r) => formatNumber(r.conversions, { maximumFractionDigits: 0 }),
    },
    ...(tab === "engagement"
      ? [
          {
            id: "conv_rate",
            header: "Conv. rate",
            align: "right" as const,
            sortable: true,
            cell: (r: TrafficTableRow) => formatPercent(r.conversionRate),
          },
        ]
      : []),
    {
      id: "revenue",
      header: "Revenue",
      align: "right",
      sortable: true,
      cell: (r) => (r.revenue ? formatCurrency(r.revenue, currency) : <span className="text-muted-foreground">—</span>),
      hideBelow: "sm",
    },
    {
      id: "avg_time",
      header: "Avg. Time",
      align: "right",
      sortable: true,
      cell: (r) => formatDuration(r.avgTime),
      hideBelow: "sm",
    },
  ];

  return (
    <Panel
      title="AI Traffic Analytics"
      description={`Where AI visitors land, where they come from and how engaged they are · ${periodLabel}`}
      contentClassName="p-0"
    >
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex rounded-lg bg-muted p-0.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => patch({ atab: t.key === "urls" ? null : t.key })}
              className={cn(
                "flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors sm:flex-none",
                tab === t.key ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={s.id === "label" ? "sessions" : s.id} onValueChange={(v) => patch({ sort: v === "sessions" ? null : v })}>
            <SelectTrigger size="sm" className="h-8 bg-background text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.filter((o) => tab === "engagement" || (o.key !== "engagement_rate" && o.key !== "conv_rate")).map((o) => (
                <SelectItem key={o.key} value={o.key} className="text-xs">
                  {o.label} ↓
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <MultiSelect
            options={availableModels.map((m) => ({ value: m, label: getAiPlatform(m)?.name ?? m, icon: <PlatformIcon id={m} tooltip={false} /> }))}
            value={models}
            onChange={(v) => patch({ models: v.length ? v.join(",") : null })}
            placeholder="All AI Models"
            label="AI Models"
            icon={<Bot className="size-3.5 text-muted-foreground" />}
          />
        </div>
      </div>
      <div className="p-3 sm:p-4">
        <DataTable
          columns={columns}
          data={sorted}
          getRowId={(r) => r.key}
          sort={s}
          onSortChange={setSort}
          pageSize={25}
          dense
          empty={<div className="py-12 text-center text-sm text-muted-foreground">No AI-referred sessions for this selection.</div>}
          mobileCard={(r) => (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  {tab === "location" && r.key !== "__unknown__" && <CountryFlag iso={r.key} />}
                  {tab === "engagement" && <PlatformIcon id={r.key} size="sm" />}
                  <span className="truncate">{tab === "location" ? countryName(r.key) : r.label}</span>
                </span>
                {tab !== "engagement" && <PlatformStack ids={r.platforms} max={3} />}
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <Metric label="Sessions" value={formatNumber(r.sessions, { maximumFractionDigits: 0 })} />
                <Metric label="Conv." value={formatNumber(r.conversions, { maximumFractionDigits: 0 })} />
                <Metric label="Revenue" value={r.revenue ? formatCurrency(r.revenue, currency) : "—"} />
                <Metric label="Avg. time" value={formatDuration(r.avgTime)} />
              </div>
            </div>
          )}
        />
      </div>
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="truncate font-medium tabular">{value}</div>
    </div>
  );
}
