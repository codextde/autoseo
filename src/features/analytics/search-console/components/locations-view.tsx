"use client";

import { useMemo } from "react";
import { MapPinOff, Sparkles } from "lucide-react";
import { DataTable, type Column } from "@/components/app/data-table";
import { WorldMap } from "@/components/app/world-map";
import { CountryFlag } from "@/components/app/misc";
import { Delta, Meter, formatNumber } from "@/components/app/metrics";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlListState, useUrlPatch } from "@/hooks/use-url-state";
import type { ScLocationRow } from "@/server/analytics/search-console/queries";
import { countryName, sortRows, useUrlSort } from "./common";

export function LocationsView({ rows: input, view }: { rows: ScLocationRow[]; view: "all" | "prompts" }) {
  const [sort, setSort] = useUrlSort("impressions.desc");
  const [countries] = useUrlListState("country");
  const [patch] = useUrlPatch();
  const rows = useMemo(
    () =>
      sortRows(input, sort, {
        country: (r) => countryName(r.country),
        prompts: (r) => r.promptCount,
        impressions: (r) => r.impressions,
        share: (r) => r.share,
        clicks: (r) => r.clicks,
      }),
    [input, sort],
  );
  const values = useMemo(() => Object.fromEntries(input.map((r) => [r.country, r.impressions])), [input]);
  const rank = useMemo(() => new Map(rows.map((r, i) => [r.country, i + 1])), [rows]);

  const columns: Column<ScLocationRow>[] = [
    { id: "rank", header: "#", width: "44px", cell: (r) => <span className="text-xs text-muted-foreground tabular">{rank.get(r.country)}</span> },
    { id: "country", header: "Country", sortable: true, cell: (r) => <CountryFlag iso={r.country} withName className="font-medium" /> },
    {
      id: "prompts",
      header: "AI Prompts",
      sortable: true,
      align: "right",
      cell: (r) => (
        <span className="inline-flex items-center gap-1 tabular">
          {r.promptCount > 0 && <Sparkles className="size-3 text-brand" />}
          {r.promptCount.toLocaleString("en-US")}
        </span>
      ),
    },
    {
      id: "impressions",
      header: "Impressions",
      sortable: true,
      align: "right",
      cell: (r) => (
        <span className="inline-flex flex-col items-end">
          <span className="font-medium tabular">{formatNumber(r.impressions, { maximumFractionDigits: 0 })}</span>
          <Delta value={r.deltaPct} suffix="%" showZero={false} className="text-[11px]" />
        </span>
      ),
    },
    { id: "clicks", header: "Clicks", sortable: true, align: "right", hideBelow: "md", cell: (r) => formatNumber(r.clicks, { maximumFractionDigits: 0 }) },
    {
      id: "share",
      header: "Share",
      sortable: true,
      align: "right",
      cell: (r) => (
        <span className="ml-auto flex w-28 items-center justify-end gap-2">
          <Meter value={r.share} className="hidden w-14 sm:block" />
          <span className="tabular">{r.share.toFixed(1)}%</span>
        </span>
      ),
    },
  ];

  if (!input.length)
    return (
      <EmptyState
        icon={MapPinOff}
        title={view === "prompts" ? "No AI-prompt impressions by country yet" : "No country data in this period"}
        description="Country breakdowns come from Google Search Console (Bing does not report countries)."
      />
    );

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border bg-muted/20 p-2">
        <WorldMap
          values={values}
          height={320}
          label={view === "prompts" ? "AI prompt impressions" : "Impressions"}
          selected={countries.length === 1 ? countries[0] : null}
          onSelect={(iso) => patch({ tab: "queries", country: iso, sort: null })}
        />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.country}
        sort={sort}
        onSortChange={setSort}
        pageSize={50}
        dense
        onRowClick={(r) => patch({ tab: "queries", country: r.country, sort: null })}
        mobileCard={(r) => (
          <div className="flex items-center gap-3">
            <CountryFlag iso={r.country} withName className="min-w-0 flex-1 text-sm font-medium" />
            <span className="text-right text-xs text-muted-foreground tabular">
              <b className="text-foreground">{formatNumber(r.impressions, { maximumFractionDigits: 0 })}</b> · {r.share.toFixed(1)}%
              <br />
              {r.promptCount} AI prompts
            </span>
          </div>
        )}
      />
    </div>
  );
}
