"use client";

import { useMemo, useState } from "react";
import { Globe2, Hash, ListFilter, Loader2, Plus, SearchX, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/app/data-table";
import { FilterBar, MultiSelect, SearchInput } from "@/components/app/filters";
import { CountryFlag } from "@/components/app/misc";
import { Delta, formatNumber } from "@/components/app/metrics";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlListState, useUrlPatch, useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { INTENT_LABELS, QUERY_INTENTS, WORD_BUCKETS } from "@/server/analytics/search-console/classify";
import type { ScQueriesResult, ScQueryRow } from "@/server/analytics/search-console/queries";
import { AddPromptButton, countryName, CountryFlags, IntentBadge, sortRows, useAddPrompts, useUrlSort } from "./common";

export function ViewToggle({ view, allCount, promptCount }: { view: string; allCount: number; promptCount: number }) {
  const [patch] = useUrlPatch();
  const items = [
    { key: "all", label: "All", count: allCount, icon: null },
    { key: "prompts", label: "AI Prompts", count: promptCount, icon: <Sparkles className="size-3 text-brand" /> },
  ];
  return (
    <div className="flex shrink-0 rounded-lg bg-muted p-0.5">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => patch({ view: it.key === "all" ? null : it.key })}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            view === it.key ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {it.icon}
          {it.label}
          <span className="text-[11px] text-muted-foreground tabular">{it.count.toLocaleString("en-US")}</span>
        </button>
      ))}
    </div>
  );
}

export function QueryFilters({
  countries,
  showCountries = true,
  showSearch = true,
  searchPlaceholder = "Search queries…",
}: {
  countries?: { code: string; impressions: number }[];
  showCountries?: boolean;
  showSearch?: boolean;
  searchPlaceholder?: string;
}) {
  const [words, setWords] = useUrlState("words", "");
  const [intents, setIntents] = useUrlListState("intent");
  const [selCountries, setCountries] = useUrlListState("country");
  const [q, setQ] = useUrlState("q", "");
  const active = (words ? 1 : 0) + intents.length + selCountries.length;
  return (
    <FilterBar
      activeCount={active}
      search={showSearch ? <SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder={searchPlaceholder} /> : undefined}
    >
      <MultiSelect
        single
        options={WORD_BUCKETS.map((b) => ({ value: b, label: `${b} words` }))}
        value={words ? [words] : []}
        onChange={(v) => setWords(v[0] ?? null)}
        placeholder="All Words"
        icon={<Hash className="size-3.5 text-muted-foreground" />}
        className="w-full sm:w-auto"
        searchable={false}
      />
      <MultiSelect
        options={QUERY_INTENTS.map((i) => ({ value: i, label: INTENT_LABELS[i] }))}
        value={intents}
        onChange={setIntents}
        placeholder="All Intent Types"
        label="Intents"
        icon={<ListFilter className="size-3.5 text-muted-foreground" />}
        className="w-full sm:w-auto"
        searchable={false}
      />
      {showCountries && countries && countries.length > 0 && (
        <MultiSelect
          options={countries.map((c) => ({
            value: c.code,
            label: countryName(c.code),
            icon: <CountryFlag iso={c.code} />,
            count: Math.round(c.impressions),
          }))}
          value={selCountries}
          onChange={setCountries}
          placeholder="All Countries"
          label="Countries"
          icon={<Globe2 className="size-3.5 text-muted-foreground" />}
          className="w-full sm:w-auto"
        />
      )}
    </FilterBar>
  );
}

export function QueriesTable({
  projectId,
  data,
  view,
  pageFilter,
  canAddPrompts,
  source,
}: {
  projectId: string;
  data: ScQueriesResult;
  view: "all" | "prompts";
  pageFilter: string | null;
  canAddPrompts: boolean;
  source: "google" | "bing";
}) {
  const [sort, setSort] = useUrlSort("impressions.desc");
  const [patch] = useUrlPatch();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { added, add, pending } = useAddPrompts(projectId);

  const rows = useMemo(
    () =>
      sortRows(data.rows, sort, {
        query: (r) => r.query,
        intent: (r) => r.intent,
        words: (r) => r.words,
        impressions: (r) => r.impressions,
        delta: (r) => r.deltaPct,
        clicks: (r) => r.clicks,
        position: (r) => r.position,
        countries: (r) => r.countries.length,
      }),
    [data.rows, sort],
  );
  const rank = useMemo(() => new Map(rows.map((r, i) => [r.query, i + 1])), [rows]);
  const isTracked = (r: ScQueryRow) => r.tracked || added.has(r.query.toLowerCase());

  const columns: Column<ScQueryRow>[] = [
    { id: "rank", header: "#", cell: (r) => <span className="text-xs text-muted-foreground tabular">{rank.get(r.query)}</span>, width: "44px" },
    {
      id: "query",
      header: "Query",
      sortable: true,
      cell: (r) => (
        <span className="flex min-w-0 items-start gap-1.5">
          {r.isPrompt && <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand" aria-label="AI prompt" />}
          <span className="line-clamp-2 min-w-48 font-medium break-words">{r.query}</span>
        </span>
      ),
    },
    { id: "intent", header: "Intent", sortable: true, cell: (r) => <IntentBadge intent={r.intent} source={r.intentSource} /> },
    ...(source === "google"
      ? [{ id: "countries", header: "Countries", sortable: true, cell: (r: ScQueryRow) => <CountryFlags countries={r.countries} />, hideBelow: "md" as const }]
      : []),
    { id: "words", header: "Words", sortable: true, align: "right", cell: (r) => r.words, hideBelow: "lg" },
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
    { id: "clicks", header: "Clicks", sortable: true, align: "right", cell: (r) => formatNumber(r.clicks, { maximumFractionDigits: 0 }), hideBelow: "md" },
    {
      id: "position",
      header: "Pos.",
      sortable: true,
      align: "right",
      hint: "Impression-weighted average position",
      cell: (r) => (r.position == null ? "—" : r.position.toFixed(1)),
      hideBelow: "lg",
    },
    ...(canAddPrompts
      ? [
          {
            id: "add",
            header: <span className="sr-only">Track</span>,
            align: "center" as const,
            width: "52px",
            cell: (r: ScQueryRow) => <AddPromptButton query={r.query} tracked={isTracked(r)} onAdd={(q) => add([q])} disabled={pending} />,
          },
        ]
      : []),
  ];

  const selectedQueries = [...selected].filter((q) => !rows.find((r) => r.query === q && isTracked(r)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="tabular">
          Found <b className="text-foreground">{data.promptCount.toLocaleString("en-US")}</b> prompts from{" "}
          <b className="text-foreground">{data.queryCount.toLocaleString("en-US")}</b> queries
        </span>
        {pageFilter && (
          <span className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-foreground">
            <span className="text-muted-foreground">Page:</span>
            <span className="max-w-64 truncate">{pageFilter.replace(/^https?:\/\/[^/]+/, "") || "/"}</span>
            <button type="button" aria-label="Clear page filter" onClick={() => patch({ page: null })} className="text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          </span>
        )}
        {data.truncated && <span>· showing the top {data.rows.length.toLocaleString("en-US")} by impressions</span>}
      </div>

      {canAddPrompts && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-brand-soft/40 px-3 py-2 text-sm">
          <span className="font-medium tabular">{selected.size} selected</span>
          <Button size="sm" disabled={pending || !selectedQueries.length} onClick={() => add(selectedQueries, () => setSelected(new Set()))}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add {selectedQueries.length} as prompts
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.query}
        sort={sort}
        onSortChange={setSort}
        selectable={canAddPrompts}
        selected={selected}
        onSelectedChange={setSelected}
        pageSize={50}
        dense
        empty={
          <EmptyState
            icon={SearchX}
            compact
            title={view === "prompts" ? "No AI-style prompts in this period" : "No queries match these filters"}
            description={
              view === "prompts"
                ? "Long, question-like queries appear here once Search Console reports them. Try a longer period or switch to All."
                : "Try another period, clear filters, or wait for the next sync — Search Console data trails by 2–3 days."
            }
          />
        }
        mobileCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              {r.isPrompt && <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand" />}
              <span className="min-w-0 flex-1 text-sm font-medium break-words">{r.query}</span>
              {canAddPrompts && <AddPromptButton query={r.query} tracked={isTracked(r)} onAdd={(q) => add([q])} disabled={pending} />}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              <IntentBadge intent={r.intent} source={r.intentSource} />
              <span className="tabular">
                <b className="text-foreground">{formatNumber(r.impressions, { maximumFractionDigits: 0 })}</b> impr.
              </span>
              <Delta value={r.deltaPct} suffix="%" showZero={false} />
              <span className="tabular">{r.clicks.toLocaleString("en-US")} clicks</span>
              {r.countries.length > 0 && <CountryFlags countries={r.countries} max={4} />}
            </div>
          </div>
        )}
      />
    </div>
  );
}
