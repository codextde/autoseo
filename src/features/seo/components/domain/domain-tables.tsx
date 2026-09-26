"use client";

import { useMemo, useState } from "react";
import { Bookmark, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable, type Column, type SortState } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { formatNumber } from "@/components/app/metrics";
import {
  defaultOrderForSort,
  resolveUrlHref,
  type DomainKeywordRow,
  type DomainPageRow,
  type DomainSortMode,
  type SortOrder,
} from "@/server/seo/lib/domain";
import type { Cell } from "@/server/seo/lib/csv";
import { saveKeywordsAction } from "../../actions/keywords";
import { toastError, unwrap } from "../../lib/client";
import { CPC_HELP, DifficultyBadge, KD_HELP } from "../shared/badges";
import { BulkBar } from "../shared/bulk-bar";
import { ExportMenu } from "../shared/export-menu";
import { ExternalUrl } from "../shared/external-link";
import { FilterPanel, FiltersToggle, type FilterValues } from "../shared/filter-panel";
import { TablePagination } from "../shared/table-pagination";
import { countActiveFilterConditions } from "./filter-utils";

export const KEYWORD_EXPORT_HEADERS = ["Keyword", "Rank", "Volume", "Traffic", "CPC", "URL", "Score"];
export const PAGE_EXPORT_HEADERS = ["Page", "Organic Traffic", "Keywords"];

export function keywordExportRows(rows: DomainKeywordRow[]): Cell[][] {
  return rows.map((r) => [r.keyword, r.position ?? "", r.searchVolume ?? "", r.traffic != null ? Math.round(r.traffic) : "", r.cpc != null ? r.cpc.toFixed(2) : "", r.url ?? "", r.keywordDifficulty ?? ""]);
}

export function pageExportRows(rows: DomainPageRow[]): Cell[][] {
  return rows.map((r) => [r.page, r.organicTraffic ?? "", r.keywords ?? ""]);
}

const rowId = (r: DomainKeywordRow) => `${r.keyword}\u0000${r.url ?? ""}`;

const fmt = (n: number | null | undefined) => (n == null ? "-" : formatNumber(Math.round(n), { maximumFractionDigits: 0 }));

type Paging = {
  page: number;
  size: number;
  totalCount: number | null;
  hasMore: boolean;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};

type FiltersProps = {
  values: FilterValues;
  onApply: (v: FilterValues) => void;
  budget: number;
  countConditions: (v: FilterValues) => number;
  warning?: string | null;
};

/* ───────────────────────────── Top Keywords ───────────────────────────── */

export function DomainKeywordsTab({
  projectId,
  rows,
  hostname,
  exportName,
  sort,
  order,
  onSort,
  paging,
  filters,
  save,
}: {
  projectId: string;
  rows: DomainKeywordRow[];
  hostname: string;
  exportName: string;
  sort: DomainSortMode;
  order: SortOrder;
  onSort: (sort: DomainSortMode, order: SortOrder) => void;
  paging: Paging;
  filters: FiltersProps;
  save: { enabled: boolean; locationCode: number; reason?: string };
}) {
  const [filtersOpen, setFiltersOpen] = useState(() => countActiveFilterConditions(filters.values) > 0);
  const [rawSelected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Selection is pruned to the visible rows when the page changes.
  const selected = useMemo(() => {
    const visible = new Set(rows.map(rowId));
    return new Set([...rawSelected].filter((id) => visible.has(id)));
  }, [rows, rawSelected]);

  const selectedRows = rows.filter((r) => selected.has(rowId(r)));

  const columns: Column<DomainKeywordRow>[] = [
    { id: "keyword", header: "Keyword", cell: (r) => <span className="font-medium">{r.keyword}</span>, className: "max-w-[18rem]" },
    { id: "rank", header: "Rank", sortable: true, align: "right", cell: (r) => (r.position != null ? r.position : "-") },
    { id: "volume", header: "Volume", sortable: true, align: "right", cell: (r) => fmt(r.searchVolume) },
    { id: "traffic", header: "Traffic", sortable: true, align: "right", cell: (r) => fmt(r.traffic) },
    { id: "cpc", header: "CPC", hint: CPC_HELP, sortable: true, align: "right", hideBelow: "md", cell: (r) => (r.cpc != null ? `$${r.cpc.toFixed(2)}` : "-") },
    {
      id: "url",
      header: "URL",
      hideBelow: "md",
      cell: (r) => <ExternalUrl href={resolveUrlHref(r.url ?? r.relativeUrl, hostname)} label={r.relativeUrl ?? r.url} maxWidth="max-w-[16rem]" />,
    },
    { id: "score", header: "Score", hint: KD_HELP, sortable: true, align: "center", cell: (r) => <DifficultyBadge value={r.keywordDifficulty} /> },
  ];

  const onSortChange = (s: SortState) => {
    if (!s || s.id === sort) onSort(sort, order === "desc" ? "asc" : "desc");
    else onSort(s.id as DomainSortMode, defaultOrderForSort(s.id as DomainSortMode));
  };

  const saveSelected = async () => {
    setSaving(true);
    try {
      const res = unwrap(
        await saveKeywordsAction(projectId, {
          keywords: selectedRows.map((r) => r.keyword),
          locationCode: save.locationCode,
          metrics: selectedRows.map((r) => ({ keyword: r.keyword, searchVolume: r.searchVolume, cpc: r.cpc, keywordDifficulty: r.keywordDifficulty })),
        }),
      );
      toast.success(`Saved ${res.savedCount} keyword${res.savedCount === 1 ? "" : "s"}`);
      setSelected(new Set());
    } catch (err) {
      toastError(err, "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const active = countActiveFilterConditions(filters.values);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <FiltersToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} active={active} />
        <span className="text-xs text-muted-foreground tabular">
          {paging.totalCount != null ? `${paging.totalCount.toLocaleString()} keywords` : `${rows.length} keywords`}
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">·</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">{selected.size > 0 ? `${selected.size} selected` : "Select keywords to save"}</span>
        <div className="ml-auto flex items-center gap-2">
          {paging.loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          <ExportMenu excel json disabled={rows.length === 0} getData={() => ({ headers: KEYWORD_EXPORT_HEADERS, rows: keywordExportRows(rows), filename: `${exportName}-keywords`, json: rows })} />
        </div>
      </div>
      {filters.warning && <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{filters.warning}</p>}
      <FilterPanel
        open={filtersOpen}
        mode="apply"
        values={filters.values}
        onApply={filters.onApply}
        budget={filters.budget}
        countConditions={filters.countConditions}
        textFields={[
          { key: "include", label: "Include Terms", placeholder: "audit, checker, template" },
          { key: "exclude", label: "Exclude Terms", placeholder: "jobs, salary, course" },
        ]}
        rangeFields={[
          { label: "Traffic", minKey: "minTraffic", maxKey: "maxTraffic", min: 0 },
          { label: "Volume", minKey: "minVol", maxKey: "maxVol", min: 0 },
          { label: "CPC (USD)", minKey: "minCpc", maxKey: "maxCpc", step: 0.01, min: 0 },
          { label: "Score", minKey: "minKd", maxKey: "maxKd", min: 0, max: 100 },
          { label: "Rank", minKey: "minRank", maxKey: "maxRank", min: 1 },
        ]}
      />
      <div className="mt-3">
        <DataTable
          columns={columns}
          data={rows}
          getRowId={rowId}
          sort={{ id: sort, dir: order }}
          onSortChange={onSortChange}
          paginate={false}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          dense
          empty={<EmptyState compact icon={Search} title="No keywords match" description={active > 0 ? "Try loosening the filters." : "This target has no ranking keywords in this market yet."} />}
          mobileCard={(r) => (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{r.keyword}</span>
                <DifficultyBadge value={r.keywordDifficulty} />
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <Stat label="Rank" value={r.position ?? "-"} />
                <Stat label="Volume" value={fmt(r.searchVolume)} />
                <Stat label="Traffic" value={fmt(r.traffic)} />
                <Stat label="CPC" value={r.cpc != null ? `$${r.cpc.toFixed(2)}` : "-"} />
              </div>
              <ExternalUrl href={resolveUrlHref(r.url ?? r.relativeUrl, hostname)} label={r.relativeUrl ?? r.url} className="text-xs" maxWidth="max-w-full" />
            </div>
          )}
        />
        <TablePagination
          page={paging.page}
          pageSize={paging.size}
          pageSizes={[50, 100, 200]}
          total={paging.totalCount}
          rowCount={rows.length}
          hasMore={paging.hasMore}
          loading={paging.loading}
          onPageChange={paging.onPageChange}
          onPageSizeChange={paging.onPageSizeChange}
        />
      </div>
      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button size="sm" onClick={saveSelected} disabled={!save.enabled || saving} title={save.reason}>
          {saving ? <Loader2 className="animate-spin" /> : <Bookmark />} Save Keywords
        </Button>
        <ExportMenu getData={() => ({ headers: KEYWORD_EXPORT_HEADERS, rows: keywordExportRows(selectedRows), filename: `${exportName}-keywords` })} />
      </BulkBar>
    </div>
  );
}

/* ───────────────────────────── Top Pages ───────────────────────────── */

/** open-seo quirk kept: the table renders at most the first 100 rows of a page. */
const MAX_RENDERED_PAGES = 100;

export function DomainPagesTab({
  rows,
  hostname,
  exportName,
  sort,
  order,
  onSort,
  paging,
  filters,
}: {
  rows: DomainPageRow[];
  hostname: string;
  exportName: string;
  /** "traffic" | "keywords" */
  sort: "traffic" | "keywords";
  order: SortOrder;
  /** Maps back to the shared URL sort: traffic → traffic, keywords → volume. */
  onSort: (sort: DomainSortMode, order: SortOrder) => void;
  paging: Paging;
  filters: FiltersProps;
}) {
  const [filtersOpen, setFiltersOpen] = useState(() => countActiveFilterConditions(filters.values) > 0);
  const shown = rows.slice(0, MAX_RENDERED_PAGES);
  const active = countActiveFilterConditions(filters.values);
  const columns: Column<DomainPageRow>[] = [
    {
      id: "page",
      header: "Page",
      cell: (r) => <ExternalUrl href={resolveUrlHref(r.page, hostname)} label={r.relativePath ?? r.page} maxWidth="max-w-[420px]" />,
    },
    { id: "traffic", header: "Organic Traffic", sortable: true, align: "right", cell: (r) => fmt(r.organicTraffic) },
    { id: "keywords", header: "Keywords", sortable: true, align: "right", cell: (r) => fmt(r.keywords) },
  ];
  const onSortChange = (s: SortState) => {
    const mode = !s || s.id === sort ? sort : (s.id as "traffic" | "keywords");
    const nextOrder: SortOrder = !s || s.id === sort ? (order === "desc" ? "asc" : "desc") : "desc";
    onSort(mode === "keywords" ? "volume" : "traffic", nextOrder);
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <FiltersToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} active={active} />
        <span className="text-xs text-muted-foreground tabular">{paging.totalCount != null ? `${paging.totalCount.toLocaleString()} pages` : `${rows.length} pages`}</span>
        <div className="ml-auto flex items-center gap-2">
          {paging.loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          <ExportMenu excel json disabled={rows.length === 0} getData={() => ({ headers: PAGE_EXPORT_HEADERS, rows: pageExportRows(rows), filename: `${exportName}-pages`, json: rows })} />
        </div>
      </div>
      {filters.warning && <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{filters.warning}</p>}
      <FilterPanel
        open={filtersOpen}
        mode="apply"
        values={filters.values}
        onApply={filters.onApply}
        budget={filters.budget}
        countConditions={filters.countConditions}
        textFields={[
          { key: "pInclude", label: "Include Page Terms", placeholder: "pricing, tools, guides" },
          { key: "pExclude", label: "Exclude Page Terms", placeholder: "blog, tag, archive" },
        ]}
        rangeFields={[
          { label: "Traffic", minKey: "pMinTraffic", maxKey: "pMaxTraffic", min: 0 },
          { label: "Keywords", minKey: "pMinVol", maxKey: "pMaxVol", min: 0 },
        ]}
      />
      <div className="mt-3">
        <DataTable
          columns={columns}
          data={shown}
          getRowId={(r) => r.page}
          sort={{ id: sort, dir: order }}
          onSortChange={onSortChange}
          paginate={false}
          dense
          empty={<EmptyState compact icon={Search} title="No pages match" description={active > 0 ? "Try loosening the filters." : "No ranking pages found for this target."} />}
          mobileCard={(r) => (
            <div className="space-y-2">
              <ExternalUrl href={resolveUrlHref(r.page, hostname)} label={r.relativePath ?? r.page} className="text-sm font-medium" maxWidth="max-w-full" />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="Organic Traffic" value={fmt(r.organicTraffic)} />
                <Stat label="Keywords" value={fmt(r.keywords)} />
              </div>
            </div>
          )}
        />
        <TablePagination
          page={paging.page}
          pageSize={paging.size}
          pageSizes={[50, 100, 200]}
          total={paging.totalCount}
          rowCount={rows.length}
          hasMore={paging.hasMore}
          loading={paging.loading}
          onPageChange={paging.onPageChange}
          onPageSizeChange={paging.onPageSizeChange}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="truncate tabular">{value}</div>
    </div>
  );
}
