"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, RotateCw, Search, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import type { ResearchKeywordsOutput } from "@/server/seo/keywords";
import type { SearchHistoryItem } from "@/server/seo/history";
import { getLocationOption, locationLabel } from "@/server/seo/lib/locations";
import { clearSearchHistoryAction, listSearchHistoryAction, removeSearchHistoryAction } from "../../actions/common";
import { researchKeywordsAction } from "../../actions/keywords";
import { useQueryParams, type ParamPatch } from "../../hooks/use-query-params";
import { useSeoQuery } from "../../hooks/use-seo-query";
import { toastError, unwrap } from "../../lib/client";
import type { ClientPageInfo } from "../../server/page-context";
import { DataForSeoNotConfigured, ReadOnlyNote } from "../shared/empty-states";
import { RecentSearches, type RecentItem } from "../shared/recent-searches";
import { KeywordSearchCard } from "./search-card";
import { SearchTabStrip, useSearchTabs, type SearchTab } from "./search-tabs";
import { KeywordResults } from "./keyword-results";
import { readUrlState, researchKey, sameInput, searchPatch, type KeywordSearchInput } from "./params";

const RESEARCH_STALE_MS = 24 * 60 * 60_000;

/** Keyword Research page (open-seo §2): URL is the source of truth; every search is billed, so nothing refetches on its own. */
export function KeywordResearchView({ info, initialHistory }: { info: ClientPageInfo; initialHistory: SearchHistoryItem[] }) {
  const { projectId } = info;
  const defaultLoc = info.market.locationCode;
  const { params, set } = useQueryParams();
  const state = useMemo(() => readUrlState(params, defaultLoc), [params, defaultLoc]);
  const active: KeywordSearchInput | null = useMemo(
    () => (state.keyword ? { keyword: state.keyword, loc: state.loc, kLimit: state.kLimit, mode: state.mode, cs: state.cs } : null),
    [state.keyword, state.loc, state.kLimit, state.mode, state.cs],
  );

  const { tabs, open, close, markViewed } = useSearchTabs(projectId, defaultLoc);
  const [history, setHistory] = useState<SearchHistoryItem[]>(initialHistory);

  const setParams = useCallback((patch: ParamPatch) => set(patch), [set]);
  const key = active && info.configured ? researchKey(projectId, active) : null;
  const query = useSeoQuery<ResearchKeywordsOutput>(
    key,
    async () =>
      unwrap(
        await researchKeywordsAction(projectId, {
          keywords: [active!.keyword],
          locationCode: active!.loc,
          resultLimit: active!.kLimit,
          mode: active!.mode,
          clickstream: active!.cs,
        }),
      ),
    { staleMs: RESEARCH_STALE_MS },
  );

  // Every opened search (incl. deep links / recent-search clicks) gets a tab; viewing marks it as seen.
  useEffect(() => {
    if (!active) return;
    open([active]);
    markViewed(active);
  }, [active, open, markViewed]);
  const hasData = query.data !== undefined;
  useEffect(() => {
    if (active && hasData) markViewed(active);
  }, [active, hasData, markViewed]);
  // Leaving a tab while it is still loading → its result arrives "unviewed" (status dot).
  const prevRef = useRef<{ input: KeywordSearchInput; loading: boolean } | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    if (prev?.loading && (!active || !sameInput(prev.input, active))) markViewed(prev.input, null);
    prevRef.current = active ? { input: active, loading: query.loading } : null;
  }, [active, query.loading, markViewed]);

  // Refresh recent searches when returning to the start screen.
  useEffect(() => {
    if (active) return;
    let cancelled = false;
    void listSearchHistoryAction(projectId, "keywords").then((res) => {
      if (!cancelled && res.ok) setHistory(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [active, projectId]);

  // Filters, sort and page size are kept across searches (open-seo reuses filter defaults across searches).
  const go = (input: KeywordSearchInput) => set(searchPatch(input, defaultLoc), { push: true });
  const backToRecent = () => set({ q: null, loc: null, kLimit: null, mode: null, cs: null, kw: null, page: null }, { push: true });

  const onSubmit = (inputs: KeywordSearchInput[]) => {
    open(inputs);
    // Navigate to the last keyword (open-seo behaviour); the others wait in their tabs.
    go(inputs[inputs.length - 1]!);
  };

  const closeTab = (tab: SearchTab) => {
    const next = close(tab.id);
    if (!active || !sameInput(tab.input, active)) return;
    if (next) go(next.input);
    else backToRecent();
  };

  const recentItems: RecentItem[] = history.map((h) => ({
    id: h.id,
    label: String(h.params.q ?? h.label),
    sub: String(h.params.locationName ?? locationLabel(Number(h.params.loc))),
    createdAt: h.createdAt,
  }));

  const recent = (
    <RecentSearches
      items={recentItems}
      onSelect={(item) => {
        const h = history.find((x) => x.id === item.id);
        if (!h) return;
        go({ keyword: String(h.params.q ?? h.label), loc: Number(h.params.loc) || defaultLoc, kLimit: 150, mode: "auto", cs: false });
      }}
      onRemove={async (item) => {
        setHistory((hs) => hs.filter((x) => x.id !== item.id));
        const res = await removeSearchHistoryAction(projectId, [item.id]);
        if (!res.ok) toastError(new Error(res.error));
      }}
      onClear={async () => {
        setHistory([]);
        const res = await clearSearchHistoryAction(projectId, "keywords");
        if (!res.ok) toastError(new Error(res.error));
      }}
      empty={
        <Panel>
          <EmptyState icon={Search} title="Enter a keyword to get started" description="Search for any keyword to see volume, difficulty, CPC, and related keyword ideas." />
        </Panel>
      }
    />
  );

  return (
    <div className="space-y-4">
      <KeywordSearchCard
        key={active ? researchKey(projectId, active) : "new"}
        projectId={projectId}
        initial={active ?? { keyword: "", loc: defaultLoc, kLimit: 150, mode: "auto", cs: false }}
        disabled={!info.configured}
        onSubmit={onSubmit}
      />
      {!info.canRun && info.configured && <ReadOnlyNote />}

      {active && (
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant="ghost" size="sm" className="w-fit shrink-0" onClick={backToRecent}>
            <ArrowLeft /> Recent searches
          </Button>
          <div className="min-w-0 flex-1">
            <SearchTabStrip
              projectId={projectId}
              tabs={tabs}
              active={active}
              activeLoading={query.loading}
              activeError={Boolean(query.error)}
              onSelect={(tab) => go(tab.input)}
              onClose={closeTab}
            />
          </div>
        </div>
      )}

      {!info.configured ? (
        <div className="space-y-4">
          <DataForSeoNotConfigured isAdmin={info.isAdmin} feature="Keyword research" />
          {!active && recentItems.length > 0 && recent}
        </div>
      ) : !active ? (
        recent
      ) : query.error ? (
        <Panel>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-11 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
              <SearchX className="size-5" />
            </div>
            <p className="max-w-md text-sm text-destructive">{query.error}</p>
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              <RotateCw /> Try again
            </Button>
          </div>
        </Panel>
      ) : !query.data ? (
        <LoadingState />
      ) : query.data.rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={SearchX}
            title="Not enough keyword data for this query yet"
            description={`We could not find keyword opportunities for "${active.keyword}" in ${getLocationOption(active.loc)?.shortLabel ?? locationLabel(active.loc)}.`}
          />
        </Panel>
      ) : (
        <KeywordResults key={key ?? ""} projectId={projectId} canRun={info.canRun} result={query.data} state={state} setParams={setParams} />
      )}
    </div>
  );
}

/** Two-column skeleton with 10 table rows (open-seo KeywordResearchLoadingState). */
function LoadingState() {
  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      <div className="min-w-0 space-y-3 xl:basis-3/5">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <div className="space-y-2 rounded-2xl border bg-card p-4">
          <Skeleton className="h-8 w-48" />
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
      <div className="order-first space-y-3 xl:order-none xl:basis-2/5">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    </div>
  );
}
