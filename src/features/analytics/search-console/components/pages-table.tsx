"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ExternalLink, FileSearch, ListFilter, ScanSearch, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/app/data-table";
import { SearchInput } from "@/components/app/filters";
import { Delta, formatNumber } from "@/components/app/metrics";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlState } from "@/hooks/use-url-state";
import type { ScPageRow } from "@/server/analytics/search-console/queries";
import { sortRows, useUrlSort } from "./common";

function pathOf(url: string) {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
}

export function PagesTable({ rows: input, truncated, source }: { rows: ScPageRow[]; truncated: boolean; source: "google" | "bing" }) {
  const [sort, setSort] = useUrlSort("impressions.desc");
  const [q, setQ] = useUrlState("q", "");
  const pathname = usePathname();
  const params = useSearchParams();
  const rows = useMemo(
    () =>
      sortRows(input, sort, {
        page: (r) => r.page,
        prompts: (r) => r.promptCount,
        impressions: (r) => r.impressions,
        clicks: (r) => r.clicks,
        position: (r) => r.position,
      }),
    [input, sort],
  );
  const rank = useMemo(() => new Map(rows.map((r, i) => [r.page, i + 1])), [rows]);

  const inspectHref = (page: string) => {
    const next = new URLSearchParams();
    for (const k of ["source", "period", "from", "to"]) {
      const v = params.get(k);
      if (v) next.set(k, v);
    }
    next.set("tab", "inspect");
    next.set("url", page);
    return `${pathname}?${next.toString()}`;
  };

  const queriesHref = (page: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "queries");
    next.set("page", page);
    next.delete("sort");
    next.delete("q");
    return `${pathname}?${next.toString()}`;
  };

  const columns: Column<ScPageRow>[] = [
    { id: "rank", header: "#", width: "44px", cell: (r) => <span className="text-xs text-muted-foreground tabular">{rank.get(r.page)}</span> },
    {
      id: "page",
      header: "Page",
      sortable: true,
      cell: (r) => (
        <a href={r.page} target="_blank" rel="noreferrer noopener" className="group/link flex min-w-0 items-center gap-1.5 font-medium hover:underline">
          <span className="max-w-[28rem] truncate">{pathOf(r.page)}</span>
          <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover/link:opacity-60" />
        </a>
      ),
    },
    {
      id: "prompts",
      header: "AI Prompts",
      sortable: true,
      align: "right",
      hint: "Distinct AI-style (conversational) queries this page appears for",
      cell: (r) =>
        source === "bing" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="inline-flex items-center gap-1 tabular">
            {r.promptCount > 0 && <Sparkles className="size-3 text-brand" />}
            {r.promptCount.toLocaleString("en-US")}
            <span className="text-[11px] text-muted-foreground">/ {r.queryCount.toLocaleString("en-US")}</span>
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
    { id: "position", header: "Pos.", sortable: true, align: "right", hideBelow: "lg", cell: (r) => (r.position == null ? "—" : r.position.toFixed(1)) },
    ...(source === "google"
      ? [
          {
            id: "actions",
            header: <span className="sr-only">Actions</span>,
            align: "right" as const,
            cell: (r: ScPageRow) => (
              <span className="inline-flex gap-0.5">
                <Button asChild variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                  <Link href={queriesHref(r.page)} scroll={false}>
                    <ListFilter className="size-3.5" /> Queries
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="sm" className="h-7 gap-1 text-xs" title="Inspect this URL in Google (URL Inspection API)">
                  <Link href={inspectHref(r.page)} scroll={false}>
                    <ScanSearch className="size-3.5" /> Inspect
                  </Link>
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search pages…" className="w-full sm:w-72" />
        {truncated && <span className="text-xs text-muted-foreground">Showing the top 1,000 pages by impressions</span>}
      </div>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.page}
        sort={sort}
        onSortChange={setSort}
        pageSize={50}
        dense
        empty={<EmptyState icon={FileSearch} compact title="No pages in this period" description="Pages appear once Search Console reports impressions for them." />}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <a href={r.page} target="_blank" rel="noreferrer noopener" className="block truncate text-sm font-medium">
              {pathOf(r.page)}
            </a>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="tabular">
                <b className="text-foreground">{formatNumber(r.impressions, { maximumFractionDigits: 0 })}</b> impr.
              </span>
              <Delta value={r.deltaPct} suffix="%" showZero={false} />
              {source === "google" && (
                <span className="inline-flex items-center gap-1 tabular">
                  <Sparkles className="size-3 text-brand" /> {r.promptCount} AI prompts
                </span>
              )}
              {source === "google" && (
                <Link href={queriesHref(r.page)} className="text-foreground underline underline-offset-2" scroll={false}>
                  Queries
                </Link>
              )}
              {source === "google" && (
                <Link href={inspectHref(r.page)} className="text-foreground underline underline-offset-2" scroll={false}>
                  Inspect
                </Link>
              )}
            </div>
          </div>
        )}
      />
    </div>
  );
}
