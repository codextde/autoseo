"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, BookmarkPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type Column, type SortState } from "@/components/app/data-table";
import { Panel } from "@/components/app/page";
import { formatNumber } from "@/components/app/metrics";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ResearchKeywordsOutput } from "@/server/seo/keywords";
import {
  activeKeywordFilterCount,
  applyKeywordFiltersAndSort,
  KEYWORD_INTENTS,
  type KeywordFilterValues,
  type KeywordResearchRow,
  type KeywordSortField,
} from "@/server/seo/lib/keywords";
import { COMP_HELP, CPC_HELP, DifficultyBadge, IntentBadge, KD_HELP } from "../shared/badges";
import { FilterPanel, FiltersToggle, type FilterValues } from "../shared/filter-panel";
import { ExportMenu } from "../shared/export-menu";
import { TablePagination } from "../shared/table-pagination";
import { BulkBar } from "../shared/bulk-bar";
import type { ParamPatch } from "../../hooks/use-query-params";
import { OverviewStats, SearchTrendsPanel } from "./overview";
import { SerpPanel } from "./serp-panel";
import { SaveKeywordsDialog } from "./save-dialog";
import { capitalize, PAGE_SIZES, type KeywordUrlState } from "./params";
import { cn } from "@/lib/utils";

const HEADERS = ["Keyword", "Volume", "CPC", "Competition", "Score", "Intent"];
const INTENT_LABELS: Record<string, string> = {
  informational: "Informational",
  commercial: "Commercial",
  transactional: "Transactional",
  navigational: "Navigational",
  unknown: "Unknown",
};

function exportRows(rows: KeywordResearchRow[]) {
  return rows.map((r) => [
    r.keyword,
    r.searchVolume ?? "",
    r.cpc != null ? r.cpc.toFixed(2) : "",
    r.competition != null ? r.competition.toFixed(2) : "",
    r.keywordDifficulty ?? "",
    r.intent,
  ]);
}

const vol = (v: number | null) => (v != null ? formatNumber(v, { maximumFractionDigits: 0 }) : "-");

/**
 * Results: overview strip + keyword table (client-side filters / sort / pagination, selection → save / export)
 * and the right column with Search Trends + SERP Analysis. Keyed by the research query in the parent.
 */
export function KeywordResults({
  projectId,
  canRun,
  result,
  state,
  setParams,
}: {
  projectId: string;
  canRun: boolean;
  result: ResearchKeywordsOutput;
  state: KeywordUrlState;
  setParams: (patch: ParamPatch) => void;
}) {
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<"keywords" | "serp">("keywords");
  const [filters, setFilters] = useState<KeywordFilterValues>(state.filters);
  const [filtersOpen, setFiltersOpen] = useState(activeKeywordFilterCount(state.filters) > 0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveOpen, setSaveOpen] = useState(false);

  // Filters are initialised from the URL on mount (the parent keys this component by the research query) and
  // written back on every change, so the URL stays the source of truth without a sync effect.
  const rows = result.rows;
  const filtered = useMemo(() => applyKeywordFiltersAndSort(rows, filters, state.sort, state.order), [rows, filters, state.sort, state.order]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / state.size));
  const page = Math.min(state.page, pageCount);
  const pageRows = filtered.slice((page - 1) * state.size, page * state.size);
  const activeFilters = activeKeywordFilterCount(filters);

  const overviewRow = rows.find((r) => r.keyword === state.kw) ?? rows.find((r) => r.keyword === result.seed) ?? rows[0]!;
  const approximate = result.diagnostics.requestedMode !== "auto" && rows.length > 0 && !rows.some((r) => r.keyword === result.seed);
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.keyword)), [rows, selected]);

  const selectRow = (r: KeywordResearchRow) => {
    setParams({ kw: r.keyword === result.seed ? null : r.keyword });
    if (isMobile) setMobileTab("serp");
  };

  const toggle = (keyword: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(keyword);
    else next.delete(keyword);
    setSelected(next);
  };

  const columns: Column<KeywordResearchRow>[] = [
    { id: "keyword", header: "Keyword", sortable: true, className: "max-w-[18rem]", cell: (r) => <span className="block truncate font-medium capitalize" title={r.keyword}>{r.keyword}</span> },
    { id: "searchVolume", header: "Volume", sortable: true, align: "right", cell: (r) => vol(r.searchVolume) },
    { id: "cpc", header: "CPC", hint: CPC_HELP, sortable: true, align: "right", cell: (r) => (r.cpc != null ? r.cpc.toFixed(2) : "-") },
    { id: "competition", header: "Comp.", hint: COMP_HELP, sortable: true, align: "right", hideBelow: "lg", cell: (r) => (r.competition != null ? r.competition.toFixed(2) : "-") },
    { id: "keywordDifficulty", header: "Score", hint: KD_HELP, sortable: true, align: "center", cell: (r) => <DifficultyBadge value={r.keywordDifficulty} /> },
    { id: "intent", header: "Intent", align: "center", cell: (r) => <IntentBadge intent={r.intent} /> },
  ];

  const sort: SortState = { id: state.sort, dir: state.order };
  const onSortChange = (s: SortState) => {
    // A new column starts descending; clicking the active column flips the order.
    const next = s && s.id !== state.sort ? { id: s.id, dir: "desc" as const } : { id: state.sort, dir: state.order === "desc" ? ("asc" as const) : ("desc" as const) };
    setParams({ sort: next.id === "searchVolume" ? null : (next.id as KeywordSortField), order: next.dir === "desc" ? null : "asc", page: null });
  };

  const applyFilters = (values: FilterValues) => {
    const next = { ...filters, ...values } as KeywordFilterValues;
    setFilters(next);
    setParams({ ...next, page: null });
  };

  const countLine =
    selected.size > 0
      ? `${selected.size} of ${filtered.length} selected`
      : activeFilters > 0
        ? `Showing ${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} keywords`
        : `Showing ${rows.length.toLocaleString()} keywords`;

  const table = (
    <Panel contentClassName="p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FiltersToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} active={activeFilters} />
        <span className="text-xs text-muted-foreground tabular">{countLine}</span>
        <div className="ml-auto">
          <ExportMenu getData={() => ({ headers: HEADERS, rows: exportRows(filtered), filename: "keyword-research" })} disabled={filtered.length === 0} />
        </div>
      </div>
      <FilterPanel
        open={filtersOpen}
        mode="live"
        values={filters}
        onApply={applyFilters}
        textFields={[
          { key: "include", label: "Include Terms", placeholder: "audit, checker, template" },
          { key: "exclude", label: "Exclude Terms", placeholder: "jobs, salary, course" },
        ]}
        rangeFields={[
          { label: "Search Volume", minKey: "minVol", maxKey: "maxVol", min: 0 },
          { label: "CPC (USD)", minKey: "minCpc", maxKey: "maxCpc", step: 0.01, min: 0 },
          { label: "Difficulty", minKey: "minKd", maxKey: "maxKd", min: 0, max: 100 },
        ]}
        extras={(draft, set) => {
          const current = new Set((draft.intents ?? "").split(",").filter(Boolean));
          return (
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Intent</span>
              <div className="flex flex-wrap gap-1.5">
                {KEYWORD_INTENTS.map((intent) => {
                  const on = current.has(intent);
                  return (
                    <Button
                      key={intent}
                      type="button"
                      size="sm"
                      variant={on ? "default" : "outline"}
                      className="h-7"
                      aria-pressed={on}
                      onClick={() => {
                        const next = new Set(current);
                        if (on) next.delete(intent);
                        else next.add(intent);
                        set("intents", KEYWORD_INTENTS.filter((i) => next.has(i)).join(","));
                      }}
                    >
                      {INTENT_LABELS[intent]}
                    </Button>
                  );
                })}
              </div>
            </div>
          );
        }}
      />
      <div className="mt-3">
        <DataTable
          columns={columns}
          data={pageRows}
          getRowId={(r) => r.keyword}
          sort={sort}
          onSortChange={onSortChange}
          paginate={false}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          onRowClick={selectRow}
          rowClassName={(r) => (r.keyword === overviewRow.keyword ? "bg-brand-soft/50 shadow-[inset_2px_0_0_var(--brand)]" : undefined)}
          dense
          stickyHeader={false}
          empty={<div className="py-12 text-center text-sm text-muted-foreground">No keywords match these filters.</div>}
          mobileCard={(r) => (
            <div className={cn("space-y-2", r.keyword === overviewRow.keyword && "-m-3 rounded-xl bg-brand-soft/40 p-3")}>
              <div className="flex items-start gap-2">
                <span onClick={(e) => e.stopPropagation()} className="pt-0.5">
                  <Checkbox checked={selected.has(r.keyword)} onCheckedChange={(v) => toggle(r.keyword, v === true)} aria-label={`Select ${r.keyword}`} />
                </span>
                <span className="min-w-0 flex-1 font-medium capitalize">{r.keyword}</span>
                <DifficultyBadge value={r.keywordDifficulty} />
              </div>
              <div className="grid grid-cols-4 gap-2 pl-6 text-xs">
                <div>
                  <div className="text-muted-foreground">Volume</div>
                  <div className="tabular">{vol(r.searchVolume)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">CPC</div>
                  <div className="tabular">{r.cpc != null ? r.cpc.toFixed(2) : "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Comp.</div>
                  <div className="tabular">{r.competition != null ? r.competition.toFixed(2) : "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Intent</div>
                  <IntentBadge intent={r.intent} />
                </div>
              </div>
            </div>
          )}
        />
        <TablePagination
          page={page}
          pageSize={state.size}
          pageSizes={PAGE_SIZES}
          total={filtered.length}
          rowCount={pageRows.length}
          onPageChange={(p) => setParams({ page: p > 1 ? p : null })}
          onPageSizeChange={(s) => setParams({ size: s === 50 ? null : s, page: null })}
        />
      </div>
    </Panel>
  );

  const left = (
    <div className="min-w-0 space-y-3">
      {approximate && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            No exact match for &ldquo;{result.seed}&rdquo;. Showing closest related keywords instead.
            {result.usedFallback && <span className="text-muted-foreground"> Source: {result.source} fallback.</span>}
          </span>
        </div>
      )}
      <OverviewStats row={overviewRow} />
      {table}
    </div>
  );

  const serp = <SerpPanel key={`${overviewRow.keyword}:${result.locationCode}`} projectId={projectId} keyword={overviewRow.keyword} locationCode={result.locationCode} />;

  return (
    <>
      {isMobile ? (
        <Tabs value={mobileTab} onValueChange={(v) => setMobileTab(v as "keywords" | "serp")}>
          <TabsList className="w-full">
            <TabsTrigger value="keywords">Keywords ({rows.length})</TabsTrigger>
            <TabsTrigger value="serp">SERP Analysis</TabsTrigger>
          </TabsList>
          <TabsContent value="keywords" className="mt-1">
            {left}
          </TabsContent>
          <TabsContent value="serp" className="mt-1 space-y-3">
            <OverviewStats row={overviewRow} />
            <SearchTrendsPanel row={overviewRow} />
            {serp}
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 xl:basis-3/5">{left}</div>
          <div className="order-first min-w-0 space-y-4 xl:order-none xl:basis-2/5">
            <SearchTrendsPanel row={overviewRow} />
            {serp}
          </div>
        </div>
      )}

      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button size="sm" onClick={() => setSaveOpen(true)} disabled={!canRun} title={canRun ? undefined : "Requires the “Run paid SEO research” permission"}>
          <BookmarkPlus /> Save Keywords
        </Button>
        <ExportMenu label="Export" getData={() => ({ headers: HEADERS, rows: exportRows(selectedRows), filename: "keyword-research" })} />
      </BulkBar>

      <SaveKeywordsDialog
        projectId={projectId}
        open={saveOpen}
        onOpenChange={setSaveOpen}
        rows={selectedRows}
        locationCode={result.locationCode}
        languageCode={result.languageCode}
        onSaved={() => setSelected(new Set())}
      />
      <span className="sr-only" aria-live="polite">
        Overview keyword: {capitalize(overviewRow.keyword)}
      </span>
    </>
  );
}
