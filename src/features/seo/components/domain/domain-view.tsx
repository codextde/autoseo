"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertCircle, ArrowLeft, Globe, Info, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard, formatNumber } from "@/components/app/metrics";
import { Skeleton } from "@/components/ui/skeleton";
import type { SearchHistoryItem } from "@/server/seo/history";
import { DOMAIN_SORT_LABELS, DOMAIN_SORT_MODES, defaultOrderForSort, type DomainSortMode, type SortOrder } from "@/server/seo/lib/domain";
import { DEFAULT_LOCATION_CODE, isLabsLocationCode, locationLabel } from "@/server/seo/lib/locations";
import { isResearchScope, RESEARCH_SCOPE_LABELS, toScopeSearchParam, type ResearchScope } from "@/server/seo/lib/research-scope";
import { estimateDomainOverview, estimateDomainPage } from "@/server/seo/lib/costs";
import { fileSafe } from "@/server/seo/lib/csv";
import { getDomainViewAction } from "../../actions/domain";
import { unwrap } from "../../lib/client";
import { useQueryParams } from "../../hooks/use-query-params";
import { useSeoQuery } from "../../hooks/use-seo-query";
import type { ClientPageInfo } from "../../server/page-context";
import { CostPill } from "../shared/badges";
import { DataForSeoNotConfigured, ReadOnlyNote } from "../shared/empty-states";
import { LocationSelect } from "../shared/location-select";
import { RecentSearches } from "../shared/recent-searches";
import { DomainKeywordsTab, DomainPagesTab } from "./domain-tables";
import {
  ALL_FILTER_KEYS,
  filterDefaultsKey,
  isKeywordsOnlySort,
  KEYWORD_FILTER_KEYS,
  keywordBudget,
  keywordConditions,
  PAGE_FILTER_KEYS,
  pageBudget,
  pageConditions,
  pagesSortMode,
  parseDomainParams,
  toKeywordFilters,
  toPageFilters,
  type DomainTab,
} from "./params";
import { hasAnyValue, readStoredFilters, writeStoredFilters } from "./storage";
import { TargetSearchCard } from "./target-search-card";
import { useSearchHistory } from "./use-search-history";

type DomainViewData = Awaited<ReturnType<typeof getDomainViewAction>> extends infer R ? (R extends { ok: true; data: infer D } ? D : never) : never;

const noopSubscribe = () => () => {};

const nullAll = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, null]));

function restrict(values: Record<string, string>, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, values[k] ?? ""]));
}

export function DomainView({ info, initialHistory }: { info: ClientPageInfo; initialHistory: SearchHistoryItem[] }) {
  const { params, set } = useQueryParams();
  const defaultLoc = isLabsLocationCode(info.market.locationCode) ? info.market.locationCode : DEFAULT_LOCATION_CODE;
  const s = useMemo(() => parseDomainParams(new URLSearchParams(params.toString()), defaultLoc), [params, defaultLoc]);
  const history = useSearchHistory(info.projectId, "domain", initialHistory);
  // True only on the client (localStorage defaults + fetching start after hydration).
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const targetKey = s.target?.display ?? null;

  /* Saved filter defaults (localStorage) are applied when the URL carries none for that tab. */
  const kwStorageKey = targetKey ? filterDefaultsKey(info.projectId, targetKey, "keywords") : null;
  const pgStorageKey = targetKey ? filterDefaultsKey(info.projectId, targetKey, "pages") : null;
  const kwInUrl = hasAnyValue(s.keywordFilters);
  const pgInUrl = hasAnyValue(s.pageFilters);
  const kwStored = useMemo(() => (mounted && kwStorageKey && !kwInUrl ? readStoredFilters(kwStorageKey) : null), [mounted, kwStorageKey, kwInUrl]);
  const pgStored = useMemo(() => (mounted && pgStorageKey && !pgInUrl ? readStoredFilters(pgStorageKey) : null), [mounted, pgStorageKey, pgInUrl]);
  const kwBudget = keywordBudget(s.scope);
  const pgBudget = pageBudget(s.scope);
  const kwStoredOk = kwStored ? keywordConditions(restrict(kwStored, KEYWORD_FILTER_KEYS)) <= kwBudget : false;
  const pgStoredOk = pgStored ? pageConditions(restrict(pgStored, PAGE_FILTER_KEYS)) <= pgBudget : false;
  const kwValues = kwStored && kwStoredOk ? restrict(kwStored, KEYWORD_FILTER_KEYS) : s.keywordFilters;
  const pgValues = pgStored && pgStoredOk ? restrict(pgStored, PAGE_FILTER_KEYS) : s.pageFilters;
  const overLimit = (n: number) => `Saved filters exceed this scope's ${n}-condition limit and were not applied. Open Filters to trim them.`;
  const kwWarning = kwStored && !kwStoredOk ? overLimit(kwBudget) : null;
  const pgWarning = pgStored && !pgStoredOk ? overLimit(pgBudget) : null;

  // Mirror restored defaults into the URL so the view stays bookmarkable.
  useEffect(() => {
    const patch: Record<string, string> = {};
    if (kwStored && kwStoredOk) Object.assign(patch, restrict(kwStored, KEYWORD_FILTER_KEYS));
    if (pgStored && pgStoredOk) Object.assign(patch, restrict(pgStored, PAGE_FILTER_KEYS));
    if (Object.keys(patch).length) set(patch);
  }, [kwStored, pgStored, kwStoredOk, pgStoredOk, set]);

  const pagesSort = pagesSortMode(s.sort);
  const pagesOrder: SortOrder = isKeywordsOnlySort(s.sort) ? "desc" : s.order;

  const viewInput =
    mounted && s.target && info.configured
      ? {
          tab: s.tab,
          keywords: {
            domain: s.target.display,
            scope: s.target.scope,
            locationCode: s.loc,
            page: s.tab === "keywords" ? s.page : 1,
            pageSize: s.size,
            sortMode: s.sort,
            sortOrder: s.order,
            filters: toKeywordFilters(kwValues),
          },
          pages: {
            domain: s.target.display,
            scope: s.target.scope,
            locationCode: s.loc,
            page: s.tab === "pages" ? s.page : 1,
            pageSize: s.size,
            sortMode: pagesSort,
            sortOrder: pagesOrder,
            filters: toPageFilters(pgValues),
          },
        }
      : null;
  const queryKey = viewInput ? `domain-view:${info.projectId}:${JSON.stringify(viewInput)}` : null;
  const q = useSeoQuery<DomainViewData>(queryKey, async () => unwrap(await getDomainViewAction(info.projectId, viewInput!)), { staleMs: 60_000 });

  // Keep the previous page visible while the next one loads (same target / market / tab).
  const holdKey = s.target ? `${s.target.display}|${s.target.scope}|${s.loc}|${s.tab}` : "";
  const [held, setHeld] = useState<{ key: string; data: DomainViewData } | null>(null);
  if (q.data && (held?.data !== q.data || held.key !== holdKey)) setHeld({ key: holdKey, data: q.data });
  const view = q.data ?? (q.loading && held?.key === holdKey ? held.data : undefined);

  const toastedFor = useRef<string | null>(null);
  useEffect(() => {
    if (q.data && !q.data.overview.hasData && toastedFor.current !== targetKey) {
      toastedFor.current = targetKey;
      toast.message("Not enough data for this domain");
    }
  }, [q.data, targetKey]);

  // Reload recent searches when returning to the empty state.
  const hasTarget = Boolean(s.domain);
  useEffect(() => {
    if (!hasTarget) void history.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTarget]);

  const setSort = (sort: DomainSortMode, order: SortOrder) =>
    set({ sort: sort === "traffic" ? null : sort, order: order === defaultOrderForSort(sort) ? null : order, page: null });

  const setTab = (tab: DomainTab) =>
    set({
      tab: tab === "pages" ? "pages" : null,
      page: null,
      ...(tab === "pages" && isKeywordsOnlySort(s.sort) ? { sort: null, order: null } : {}),
    });

  const applyFilters = (tab: DomainTab, values: Record<string, string>) => {
    const keys = tab === "keywords" ? KEYWORD_FILTER_KEYS : PAGE_FILTER_KEYS;
    const clean = restrict(values, keys);
    const storageKey = tab === "keywords" ? kwStorageKey : pgStorageKey;
    if (storageKey) writeStoredFilters(storageKey, clean);
    set({ ...Object.fromEntries(keys.map((k) => [k, clean[k] || null])), page: null });
  };

  const goRecent = () => set({ domain: null, scope: null, subdomains: null, page: null, ...nullAll(ALL_FILTER_KEYS) }, { push: true });

  const onSearch = ({ target, scope }: { target: { display: string }; scope: ResearchScope }) => {
    set(
      {
        domain: target.display,
        scope: toScopeSearchParam(target.display, scope) ?? null,
        subdomains: null,
        page: null,
        size: null,
        ...nullAll(ALL_FILTER_KEYS),
      },
      { push: true },
    );
  };

  const loadingFirst = q.loading && !view;
  const overview = view?.overview;
  const table = view?.table;
  const exportName = fileSafe((s.target?.display ?? "domain").replace(/\//g, "-"));
  const pagingBase = {
    page: s.page,
    size: s.size,
    loading: q.loading,
    onPageChange: (p: number) => set({ page: p > 1 ? p : null }),
    onPageSizeChange: (n: number) => set({ size: n === 100 ? null : n, page: null }),
  };

  return (
    <div className="space-y-4">
      {!info.canRun && info.configured && <ReadOnlyNote />}
      <TargetSearchCard
        value={s.domain}
        scope={s.scope}
        scopeExplicit={s.scopeExplicit}
        onSubmit={onSearch}
        loading={q.loading}
        disabled={!info.configured}
        aside={info.configured ? <CostPill usd={estimateDomainOverview(s.size)} /> : undefined}
      >
        <LocationSelect
          labsOnly
          value={s.loc}
          onChange={(loc) => set({ loc: loc === defaultLoc ? null : loc, page: null })}
          className="w-full sm:w-44"
        />
        <Select value={s.sort} onValueChange={(v) => setSort(v as DomainSortMode, defaultOrderForSort(v as DomainSortMode))}>
          <SelectTrigger className="h-9 w-full sm:w-32" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOMAIN_SORT_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {DOMAIN_SORT_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TargetSearchCard>

      {!hasTarget ? (
        <RecentSearches
          items={history.items.map((h) => {
            const p = h.params;
            const scope = typeof p.scope === "string" && isResearchScope(p.scope) ? RESEARCH_SCOPE_LABELS[p.scope] : null;
            const loc = typeof p.loc === "number" && p.loc !== defaultLoc ? locationLabel(p.loc) : null;
            return { id: h.id, label: h.label, sub: [scope, loc].filter(Boolean).join(" · "), createdAt: h.createdAt };
          })}
          onSelect={(item) => {
            const h = history.items.find((x) => x.id === item.id);
            if (!h) return;
            const p = h.params;
            const domain = String(p.domain ?? h.label);
            const scope = typeof p.scope === "string" && isResearchScope(p.scope) ? p.scope : undefined;
            const sort = typeof p.sort === "string" && (DOMAIN_SORT_MODES as readonly string[]).includes(p.sort) ? (p.sort as DomainSortMode) : "traffic";
            const loc = typeof p.loc === "number" && isLabsLocationCode(p.loc) && p.loc !== defaultLoc ? p.loc : null;
            set(
              {
                domain,
                scope: scope ? (toScopeSearchParam(domain, scope) ?? null) : null,
                sort: sort === "traffic" ? null : sort,
                order: null,
                tab: p.tab === "pages" ? "pages" : null,
                loc,
                page: null,
                size: null,
                ...nullAll(ALL_FILTER_KEYS),
              },
              { push: true },
            );
          }}
          onRemove={(item) => void history.remove(item.id)}
          onClear={() => void history.clear()}
          empty={
            <Panel>
              <EmptyState icon={Globe} title="Enter a domain to get started" description="See estimated organic traffic, ranking keywords and top pages for any domain, subdomain, subfolder or URL." />
            </Panel>
          }
        />
      ) : !info.configured ? (
        <DataForSeoNotConfigured isAdmin={info.isAdmin} feature="Domain Overview" />
      ) : s.targetError ? (
        <Panel>
          <EmptyState icon={AlertCircle} title="Invalid target" description={s.targetError} action={{ label: "Back to recent searches", onClick: goRecent }} />
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={goRecent} className="-ml-2">
              <ArrowLeft /> Recent searches
            </Button>
            <Badge variant="outline" className="font-mono">
              {s.target?.display}
            </Badge>
            <Badge variant="secondary">{RESEARCH_SCOPE_LABELS[s.scope]}</Badge>
            <Badge variant="outline" className="text-muted-foreground">
              {locationLabel(s.loc)}
            </Badge>
            {view && <span className="text-xs text-muted-foreground">{view.overview.cached ? "Cached result" : "Fresh result"}</span>}
          </div>

          {q.error && !view ? (
            <Panel>
              <EmptyState
                icon={AlertCircle}
                title="Lookup failed."
                description={q.error}
                action={
                  <Button variant="outline" onClick={() => q.refetch()}>
                    <RotateCcw /> Try again
                  </Button>
                }
              />
            </Panel>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {loadingFirst || !overview ? (
                  <>
                    <Skeleton className="h-[104px] rounded-2xl" />
                    <Skeleton className="h-[104px] rounded-2xl" />
                  </>
                ) : (
                  <>
                    <StatCard
                      label="Estimated Organic Traffic"
                      value={overview.hasData && overview.organicTraffic != null ? formatNumber(overview.organicTraffic, { maximumFractionDigits: 0 }) : "Not enough data"}
                      footer={s.scope !== "subdomains" ? "Whole domain incl. subdomains" : "Estimated monthly organic visits"}
                    />
                    <StatCard
                      label="Organic Keywords"
                      value={overview.hasData && overview.organicKeywords != null ? formatNumber(overview.organicKeywords, { maximumFractionDigits: 0 }) : "Not enough data"}
                      footer={s.scope !== "subdomains" ? "Whole domain incl. subdomains" : "Keywords ranking in Google's top 100"}
                    />
                  </>
                )}
              </div>
              {overview && !overview.hasData && (
                <div className="flex items-start gap-2 rounded-xl border border-info/25 bg-info/8 px-4 py-3 text-sm">
                  <Info className="mt-0.5 size-4 shrink-0 text-info" />
                  Not enough data for this scope yet. Try another domain or a broader scope.
                </div>
              )}

              <Panel contentClassName="p-3 sm:p-4">
                <Tabs value={s.tab} onValueChange={(v) => setTab(v as DomainTab)}>
                  <TabsList variant="line" className="mb-2">
                    <TabsTrigger value="keywords">Top Keywords</TabsTrigger>
                    <TabsTrigger value="pages">Top Pages</TabsTrigger>
                  </TabsList>
                </Tabs>
                {info.configured && <CostPill className="mb-3" usd={estimateDomainPage(s.size)} label="per uncached page" />}
                {q.error && view && <p className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{q.error}</p>}
                {loadingFirst || !table ? (
                  <div className="space-y-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="h-9 w-full" />
                    ))}
                  </div>
                ) : table.kind === "keywords" ? (
                  <DomainKeywordsTab
                    projectId={info.projectId}
                    rows={table.rows}
                    hostname={s.target?.hostname ?? ""}
                    exportName={exportName}
                    sort={s.sort}
                    order={s.order}
                    onSort={setSort}
                    paging={{ ...pagingBase, totalCount: table.totalCount, hasMore: table.hasMore }}
                    filters={{
                      values: kwValues,
                      onApply: (v) => applyFilters("keywords", v),
                      budget: kwBudget,
                      countConditions: keywordConditions,
                      warning: kwWarning,
                    }}
                    save={{
                      enabled: info.canRun && Boolean(overview?.hasData) && overview?.locationCode === s.loc,
                      locationCode: s.loc,
                      reason: !info.canRun ? "Requires the “Run paid SEO research” permission" : !overview?.hasData ? "Not enough data for this domain" : undefined,
                    }}
                  />
                ) : (
                  <DomainPagesTab
                    rows={table.rows}
                    hostname={s.target?.hostname ?? ""}
                    exportName={exportName}
                    sort={pagesSort}
                    order={pagesOrder}
                    onSort={setSort}
                    paging={{ ...pagingBase, totalCount: table.totalCount, hasMore: table.hasMore }}
                    filters={{
                      values: pgValues,
                      onApply: (v) => applyFilters("pages", v),
                      budget: pgBudget,
                      countConditions: pageConditions,
                      warning: pgWarning,
                    }}
                  />
                )}
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}
