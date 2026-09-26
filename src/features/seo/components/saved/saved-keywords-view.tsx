"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, ChevronDown, ClipboardCopy, Loader2, RefreshCw, Search, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DataTable, type Column, type SortState } from "@/components/app/data-table";
import { Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import { ConfirmButton } from "@/components/app/misc";
import { useUrlPatch } from "@/hooks/use-url-state";
import type { SavedKeywordRow, SavedKeywordTagSummary, SavedSortField } from "@/server/seo/saved-keywords";
import { formatNumber } from "@/components/app/metrics";
import { exportSavedKeywordsAction, refreshSavedKeywordMetricsAction, removeSavedKeywordsAction } from "../../actions/saved";
import { copyText, formatDate, toastError, unwrap } from "../../lib/client";
import { useJobPoll } from "../../hooks/use-job-poll";
import { ChipInput } from "../shared/chip-input";
import { FilterPanel, FiltersToggle, type FilterValues } from "../shared/filter-panel";
import { ExportMenu, type ExportData } from "../shared/export-menu";
import { TablePagination } from "../shared/table-pagination";
import { COMP_HELP, CPC_HELP, DifficultyBadge, IntentBadge, KD_HELP, TagPill } from "../shared/badges";
import { BulkBar } from "../shared/bulk-bar";
import { BulkTagDialog } from "./bulk-tag-dialog";
import { TagFilter } from "./tag-filter";
import type { ClientPageInfo } from "../../server/page-context";

export type SavedQuery = {
  include: string[];
  exclude: string[];
  minVol: string;
  maxVol: string;
  minCpc: string;
  maxCpc: string;
  minKd: string;
  maxKd: string;
  tags: string[];
  sort: SavedSortField;
  order: "asc" | "desc";
  page: number;
  size: 50 | 100 | 250;
};

const HEADERS = ["Keyword", "Volume", "CPC", "Competition", "Score", "Intent", "Tags", "Fetched At"];

function exportRows(rows: SavedKeywordRow[]) {
  return rows.map((r) => [
    r.keyword,
    r.searchVolume ?? "",
    r.cpc != null ? r.cpc.toFixed(2) : "",
    r.competition != null ? r.competition.toFixed(2) : "",
    r.keywordDifficulty ?? "",
    r.intent ?? "",
    r.tags.map((t) => t.name).join(", "),
    r.fetchedAt ? new Date(r.fetchedAt).toISOString() : "",
  ]);
}

function toServerInput(q: SavedQuery) {
  const n = (v: string) => (v.trim() === "" ? undefined : Number(v));
  return {
    includeTerms: q.include,
    excludeTerms: q.exclude,
    minVolume: n(q.minVol),
    maxVolume: n(q.maxVol),
    minCpc: n(q.minCpc),
    maxCpc: n(q.maxCpc),
    minDifficulty: n(q.minKd) != null ? Math.min(100, Math.max(0, n(q.minKd)!)) : undefined,
    maxDifficulty: n(q.maxKd) != null ? Math.min(100, Math.max(0, n(q.maxKd)!)) : undefined,
    tagIds: q.tags,
    sort: q.sort,
    order: q.order,
  };
}

export function SavedKeywordsView({
  info,
  query,
  rows,
  totalCount,
  tags,
}: {
  info: ClientPageInfo;
  query: SavedQuery;
  rows: SavedKeywordRow[];
  totalCount: number;
  tags: SavedKeywordTagSummary[];
}) {
  const router = useRouter();
  const [patch, pending] = useUrlPatch();
  const [, startRefresh] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(
    Boolean(query.include.length || query.exclude.length || query.minVol || query.maxVol || query.minCpc || query.maxCpc || query.minKd || query.maxKd),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagDialog, setTagDialog] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [inc, setInc] = useState(query.include);
  const [exc, setExc] = useState(query.exclude);
  const canEdit = info.canRun;

  // Selection is cleared on page / filter / tag / sort change.
  const signature = JSON.stringify(query);
  const [selectionKey, setSelectionKey] = useState(signature);
  if (selectionKey !== signature) {
    setSelectionKey(signature);
    setSelected(new Set());
  }

  // Debounced (350 ms) server-side filters, reset to page 1.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = (values: Record<string, string | null>, immediate = false) => {
    if (debounce.current) clearTimeout(debounce.current);
    const run = () => patch({ ...values, page: null });
    if (immediate) run();
    else debounce.current = setTimeout(run, 350);
  };

  const refresh = () => startRefresh(() => router.refresh());

  useJobPoll(info.projectId, jobId, (job) => {
    setJobId(null);
    if (job.status === "succeeded") {
      const updated = (job.result as { updated?: number } | null)?.updated ?? 0;
      toast.success(`Updated stats for ${updated} keyword${updated === 1 ? "" : "s"}`);
      refresh();
    } else toast.error(job.lastError ?? "Updating keyword stats failed");
  });

  const startRefreshJob = async () => {
    try {
      const res = unwrap(await refreshSavedKeywordMetricsAction(info.projectId));
      if (res.jobId) setJobId(res.jobId);
      toast.message(`Updating stats for ${res.keywordCount} keywords…`);
    } catch (err) {
      toastError(err);
    }
  };

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);

  const columns: Column<SavedKeywordRow>[] = [
    {
      id: "keyword",
      header: "Keyword",
      sortable: true,
      cell: (r) => <span className="font-medium">{r.keyword}</span>,
      className: "max-w-[22rem]",
    },
    { id: "searchVolume", header: "Volume", sortable: true, align: "right", cell: (r) => (r.searchVolume != null ? formatNumber(r.searchVolume, { maximumFractionDigits: 0 }) : "-") },
    { id: "cpc", header: "CPC", hint: CPC_HELP, sortable: true, align: "right", cell: (r) => (r.cpc != null ? `$${r.cpc.toFixed(2)}` : "-") },
    { id: "competition", header: "Competition", hint: COMP_HELP, sortable: true, align: "right", hideBelow: "lg", cell: (r) => (r.competition != null ? r.competition.toFixed(2) : "-") },
    { id: "keywordDifficulty", header: "Difficulty", hint: KD_HELP, sortable: true, align: "center", cell: (r) => <DifficultyBadge value={r.keywordDifficulty} /> },
    { id: "intent", header: "Intent", align: "center", hideBelow: "md", cell: (r) => <IntentBadge intent={r.intent ?? "unknown"} /> },
    {
      id: "tags",
      header: "Tags",
      hideBelow: "md",
      cell: (r) =>
        r.tags.length ? (
          <div className="flex max-w-60 flex-wrap gap-1">
            {r.tags.map((t) => (
              <TagPill key={t.id} tag={t} />
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    { id: "fetchedAt", header: "Last Fetched", sortable: true, align: "right", hideBelow: "lg", cell: (r) => <span className="text-muted-foreground tabular">{formatDate(r.fetchedAt)}</span> },
  ];

  const sort: SortState = { id: query.sort, dir: query.order };
  const onSortChange = (s: SortState) => {
    // Clicking the active column flips the order; a new column starts descending.
    const next = s ?? { id: query.sort, dir: query.order === "desc" ? "asc" : "desc" };
    patch({ sort: next.id, order: next.dir, page: null });
  };

  const filterValues: FilterValues = { minVol: query.minVol, maxVol: query.maxVol, minCpc: query.minCpc, maxCpc: query.maxCpc, minKd: query.minKd, maxKd: query.maxKd };
  const activeFilters = Object.values(filterValues).filter(Boolean).length + query.include.length + query.exclude.length;

  const exportAll = async (): Promise<ExportData> => {
    const res = unwrap(await exportSavedKeywordsAction(info.projectId, toServerInput(query)));
    return { headers: HEADERS, rows: exportRows(res.rows), filename: "saved-keywords" };
  };

  const hasAnyFilter = activeFilters > 0 || query.tags.length > 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={!canEdit || !info.configured || jobId != null}>
              {jobId ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {jobId ? "Updating…" : "Actions"}
              <ChevronDown className="size-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onSelect={startRefreshJob} className="flex-col items-start gap-0">
              <span className="font-medium">Update keyword stats</span>
              <span className="text-xs text-muted-foreground">Volume, difficulty & CPC (billed per 700 keywords)</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ExportMenu getData={exportAll} disabled={totalCount === 0} />
      </div>

      <Panel contentClassName="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FiltersToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} active={activeFilters} />
          <TagFilter
            projectId={info.projectId}
            tags={tags}
            selected={query.tags}
            onChange={(ids) => update({ tags: ids.join(",") || null }, true)}
            canManage={canEdit}
            onTagsChanged={refresh}
          />
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {(pending || jobId) && <Loader2 className="size-3.5 animate-spin" />}
            <span className="tabular">
              {totalCount.toLocaleString()} keyword{totalCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <FilterPanel
          open={filtersOpen}
          mode="live"
          values={filterValues}
          onApply={(v) => update(v)}
          rangeFields={[
            { label: "Search Volume", minKey: "minVol", maxKey: "maxVol", min: 0 },
            { label: "CPC (USD)", minKey: "minCpc", maxKey: "maxCpc", step: 0.01, min: 0 },
            { label: "Difficulty", minKey: "minKd", maxKey: "maxKd", min: 0, max: 100 },
          ]}
          extras={() => (
            <div className="grid w-full gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Include terms</span>
                <ChipInput
                  tone="include"
                  value={inc}
                  placeholder="Must contain… e.g. audit"
                  onChange={(v) => {
                    setInc(v);
                    update({ inc: v.join(",") || null });
                  }}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Exclude terms</span>
                <ChipInput
                  tone="exclude"
                  value={exc}
                  placeholder="Must not contain… e.g. jobs"
                  onChange={(v) => {
                    setExc(v);
                    update({ exc: v.join(",") || null });
                  }}
                />
              </label>
            </div>
          )}
        />

        <div className="mt-3">
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(r) => r.id}
            sort={sort}
            onSortChange={onSortChange}
            paginate={false}
            selectable={canEdit}
            selected={selected}
            onSelectedChange={setSelected}
            loading={false}
            dense
            empty={
              <EmptyState
                compact
                icon={hasAnyFilter ? Search : Bookmark}
                title={hasAnyFilter ? "No saved keywords match the current filters." : "No saved keywords yet"}
                description={hasAnyFilter ? undefined : "Use the Keyword Research page to find and save keywords."}
                action={hasAnyFilter ? undefined : { label: "Open Keyword Research", href: `/p/${info.projectId}/seo/keywords` }}
              />
            }
            mobileCard={(r) => (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{r.keyword}</span>
                  <DifficultyBadge value={r.keywordDifficulty} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Volume</div>
                    <div className="tabular">{r.searchVolume != null ? formatNumber(r.searchVolume, { maximumFractionDigits: 0 }) : "-"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">CPC</div>
                    <div className="tabular">{r.cpc != null ? `$${r.cpc.toFixed(2)}` : "-"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Intent</div>
                    <IntentBadge intent={r.intent ?? "unknown"} />
                  </div>
                </div>
                {r.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {r.tags.map((t) => (
                      <TagPill key={t.id} tag={t} />
                    ))}
                  </div>
                )}
              </div>
            )}
          />
          <TablePagination
            page={query.page}
            pageSize={query.size}
            pageSizes={[50, 100, 250]}
            total={totalCount}
            rowCount={rows.length}
            loading={pending}
            onPageChange={(p) => patch({ page: p > 1 ? String(p) : null })}
            onPageSizeChange={(s) => patch({ size: s === 50 ? null : String(s), page: null })}
          />
        </div>
      </Panel>

      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button size="sm" variant="secondary" onClick={() => setTagDialog(true)}>
          <Tags /> Tag
        </Button>
        <ExportMenu
          label="Export"
          getData={() => ({ headers: HEADERS, rows: exportRows(selectedRows), filename: "saved-keywords" })}
          extra={
            <DropdownMenuItem onSelect={() => copyText(selectedRows.map((r) => r.keyword).join("\n"), `Copied ${selectedRows.length} keywords`)}>
              <ClipboardCopy /> Copy keywords
            </DropdownMenuItem>
          }
        />
        <ConfirmButton
          title={`Delete ${selected.size} saved keyword${selected.size === 1 ? "" : "s"}?`}
          description="They will be removed from this project. Keyword research results are not affected."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            try {
              const res = unwrap(await removeSavedKeywordsAction(info.projectId, [...selected]));
              toast.success(`Deleted ${res.deletedCount} keyword${res.deletedCount === 1 ? "" : "s"}`);
              setSelected(new Set());
              refresh();
            } catch (err) {
              toastError(err);
            }
          }}
        >
          <Button size="sm" variant="destructive">
            <Trash2 /> Delete
          </Button>
        </ConfirmButton>
      </BulkBar>

      <BulkTagDialog projectId={info.projectId} open={tagDialog} onOpenChange={setTagDialog} selectedRows={selectedRows} tags={tags} onApplied={refresh} />
    </>
  );
}
