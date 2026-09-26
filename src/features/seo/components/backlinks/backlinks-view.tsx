"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AlertCircle, ArrowLeft, Link2, Loader2, MoreHorizontal, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import type { SearchHistoryItem } from "@/server/seo/history";
import { backlinksFilterBudget, DEFAULT_BACKLINKS_SORT, DEFAULT_BACKLINKS_SPAM_THRESHOLD, type BacklinksTab, type SortOrder } from "@/server/seo/lib/backlinks";
import { BACKLINKS_PAGE_ESTIMATE_USD, estimateBacklinksOverview } from "@/server/seo/lib/costs";
import { fileSafe } from "@/server/seo/lib/csv";
import { isResearchScope, RESEARCH_SCOPE_LABELS, toScopeSearchParam, type ResearchScope } from "@/server/seo/lib/research-scope";
import { getBacklinksViewAction } from "../../actions/backlinks";
import { formatDateTime, unwrap } from "../../lib/client";
import { useQueryParams } from "../../hooks/use-query-params";
import { useSeoQuery } from "../../hooks/use-seo-query";
import type { ClientPageInfo } from "../../server/page-context";
import { CostPill } from "../shared/badges";
import { DataForSeoNotConfigured, ReadOnlyNote } from "../shared/empty-states";
import { ExportMenu } from "../shared/export-menu";
import { FilterPanel, FiltersToggle, type FilterValues } from "../shared/filter-panel";
import { RecentSearches } from "../shared/recent-searches";
import { TablePagination } from "../shared/table-pagination";
import { countActiveFilterConditions } from "../domain/filter-utils";
import { hasAnyValue, readStoredFilters, writeStoredFilters } from "../domain/storage";
import { TargetSearchCard } from "../domain/target-search-card";
import { useSearchHistory } from "../domain/use-search-history";
import { BacklinksOverviewPanels, BacklinksOverviewSkeleton } from "./backlinks-overview";
import {
  backlinkExport,
  BacklinksTable,
  referringDomainsExport,
  ReferringDomainsTable,
  TopPagesTable,
  topPagesExport,
} from "./backlinks-tables";
import {
  ALL_BACKLINK_FILTER_KEYS,
  countBacklinkConditions,
  filtersStorageKey,
  parseBacklinksParams,
  TAB_FILTER_KEYS,
  toDomainsFilters,
  toPagesFilters,
  toRowsFilters,
} from "./params";
import { useAhrefsDr } from "./use-ahrefs-dr";

type ViewData = Awaited<ReturnType<typeof getBacklinksViewAction>> extends infer R ? (R extends { ok: true; data: infer D } ? D : never) : never;

const noopSubscribe = () => () => {};
const nullAll = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, null]));
const restrict = (values: Record<string, string>, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, values[k] ?? ""]));

const TAB_DESCRIPTIONS: Record<BacklinksTab, string> = {
  backlinks: "See the individual links pointing to your target, including source page, anchor text, and link quality signals.",
  domains: "View the unique domains linking to your target, grouped at the site level instead of by individual link.",
  pages: "See which pages on the target site attract the most backlinks and referring domains.",
};

const EXPORT_SLUG: Record<BacklinksTab, string> = { backlinks: "backlinks", domains: "referring-domains", pages: "top-pages" };

export function BacklinksView({ info, initialHistory }: { info: ClientPageInfo; initialHistory: SearchHistoryItem[] }) {
  const { params, set } = useQueryParams();
  const s = useMemo(() => parseBacklinksParams(new URLSearchParams(params.toString())), [params]);
  const history = useSearchHistory(info.projectId, "backlinks", initialHistory);
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const dr = useAhrefsDr(info.projectId);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const tabKeys = TAB_FILTER_KEYS[s.tab];
  const spamSlot = s.hideSpam && s.tab !== "pages" && s.scope !== "subfolder" ? 1 : 0;
  const budget = backlinksFilterBudget(s.scope, s.tab);
  const countWithSpam = (v: FilterValues) => countBacklinkConditions(restrict(v, tabKeys)) + spamSlot;

  /* Per-tab filters persisted in localStorage; restored when the URL has none (over-budget values discarded). */
  const inUrl = hasAnyValue(s.filters);
  const stored = useMemo(() => (mounted && !inUrl ? readStoredFilters(filtersStorageKey(s.tab)) : null), [mounted, inUrl, s.tab]);
  const storedOk = stored ? countBacklinkConditions(restrict(stored, tabKeys)) + spamSlot <= budget : false;
  const filterValues = stored && storedOk ? restrict(stored, tabKeys) : s.filters;
  useEffect(() => {
    if (stored && storedOk) set(restrict(stored, tabKeys));
  }, [stored, storedOk, tabKeys, set]);

  const mode = s.allLinks ? ("as_is" as const) : ("one_per_domain" as const);
  const base = { target: s.target, scope: s.scope, page: s.page, pageSize: s.size, sortOrder: s.order };
  const viewInput =
    mounted && s.target && !s.targetError && info.configured
      ? s.tab === "backlinks"
        ? {
            tab: "backlinks" as const,
            query: { ...base, sortField: s.sort as "rank", mode, filters: toRowsFilters(filterValues), hideSpam: s.hideSpam, spamThreshold: DEFAULT_BACKLINKS_SPAM_THRESHOLD },
          }
        : s.tab === "domains"
          ? {
              tab: "domains" as const,
              query: { ...base, sortField: s.sort as "backlinks", filters: toDomainsFilters(filterValues), hideSpam: s.hideSpam, spamThreshold: DEFAULT_BACKLINKS_SPAM_THRESHOLD },
            }
          : { tab: "pages" as const, query: { ...base, sortField: s.sort as "backlinks", filters: toPagesFilters(filterValues) } }
      : null;
  const key = viewInput ? `backlinks-view:${info.projectId}:${JSON.stringify(viewInput)}` : null;
  const q = useSeoQuery<ViewData>(key, async () => unwrap(await getBacklinksViewAction(info.projectId, viewInput!)));

  // Keep the previous page visible while the next one loads (same target / scope / tab).
  const holdKey = `${s.target}|${s.scope}|${s.tab}|${mode}`;
  const [held, setHeld] = useState<{ key: string; data: ViewData } | null>(null);
  if (q.data && (held?.data !== q.data || held.key !== holdKey)) setHeld({ key: holdKey, data: q.data });
  const view = q.data ?? (q.loading && held?.key === holdKey ? held.data : undefined);
  const table = view?.table ?? null;

  // After opting in, newly loaded rows are enriched with Ahrefs DR automatically.
  const drDomains = useMemo(() => {
    if (!table) return [];
    if (table.kind === "backlinks") return table.rows.map((r) => r.domainFrom);
    if (table.kind === "domains") return table.rows.map((r) => r.domain);
    return [];
  }, [table]);
  const { enabled: drEnabled, enrich } = dr;
  useEffect(() => {
    if (drEnabled && drDomains.length) enrich(drDomains);
  }, [drEnabled, drDomains, enrich]);

  const hasTarget = Boolean(s.target);
  useEffect(() => {
    if (!hasTarget) void history.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTarget]);

  const setTab = (tab: BacklinksTab) => set({ tab: tab === "backlinks" ? null : tab, page: null, sort: null, order: null, ...nullAll(ALL_BACKLINK_FILTER_KEYS) });
  const setSort = (sort: string, order: SortOrder) => {
    const def = DEFAULT_BACKLINKS_SORT[s.tab];
    const isDefault = sort === def.sort && order === def.order;
    set({ sort: isDefault ? null : sort, order: isDefault ? null : order, page: null });
  };
  const applyFilters = (values: FilterValues) => {
    const clean = restrict(values, tabKeys);
    writeStoredFilters(filtersStorageKey(s.tab), clean);
    set({ ...Object.fromEntries(tabKeys.map((k) => [k, clean[k] || null])), page: null });
  };
  const goRecent = () => set({ target: null, scope: null, page: null, ...nullAll(ALL_BACKLINK_FILTER_KEYS) }, { push: true });

  const onSearch = ({ raw, scope }: { raw: string; scope: ResearchScope }) => {
    const nextTab = scope === "subfolder" && s.tab === "domains" ? null : s.tab === "backlinks" ? null : s.tab;
    set({ target: raw, scope: toScopeSearchParam(raw, scope) ?? null, tab: nextTab, page: null }, { push: true });
  };

  const exportData = () => {
    const filename = `backlinks-${EXPORT_SLUG[s.tab]}-${fileSafe(view?.overview.target ?? s.target)}`;
    if (!table) return { headers: [], rows: [], filename };
    const d = table.kind === "backlinks" ? backlinkExport(table.rows, dr) : table.kind === "domains" ? referringDomainsExport(table.rows, dr) : topPagesExport(table.rows);
    return { ...d, filename };
  };

  const activeFilters = countActiveFilterConditions(filterValues);
  const sortProps = { sort: s.sort, order: s.order, onSort: setSort };
  const showDomainsTab = s.scope !== "subfolder";
  const overview = view?.overview;

  return (
    <div className="space-y-4">
      {!info.canRun && info.configured && <ReadOnlyNote />}
      <TargetSearchCard
        value={s.target}
        scope={s.scope}
        scopeExplicit={s.scopeExplicit}
        onSubmit={onSearch}
        loading={q.loading}
        disabled={!info.configured}
        emptyMessage="Enter a domain or URL to analyze."
        aside={info.configured ? <CostPill usd={estimateBacklinksOverview(s.scope) + BACKLINKS_PAGE_ESTIMATE_USD} /> : undefined}
      />

      {!hasTarget ? (
        <RecentSearches
          items={history.items.map((h) => {
            const scope = typeof h.params.scope === "string" ? (h.params.scope === "page" ? "exact_url" : h.params.scope) : null;
            return { id: h.id, label: h.label, sub: scope && isResearchScope(scope) ? RESEARCH_SCOPE_LABELS[scope] : undefined, createdAt: h.createdAt };
          })}
          onSelect={(item) => {
            const h = history.items.find((x) => x.id === item.id);
            if (!h) return;
            const target = String(h.params.target ?? h.label);
            const rawScope = typeof h.params.scope === "string" ? (h.params.scope === "page" ? "exact_url" : h.params.scope) : null;
            const scope = rawScope && isResearchScope(rawScope) ? rawScope : null;
            set({ target, scope: scope ? (toScopeSearchParam(target, scope) ?? null) : null, tab: null, page: null, sort: null, order: null }, { push: true });
          }}
          onRemove={(item) => void history.remove(item.id)}
          onClear={() => void history.clear()}
          empty={
            <Panel>
              <EmptyState icon={Link2} title="Enter a domain or URL to get started" description="See who links to any site, subfolder or page — referring domains, anchors, link quality and a year of link growth." />
            </Panel>
          }
        />
      ) : !info.configured ? (
        <DataForSeoNotConfigured isAdmin={info.isAdmin} feature="Backlinks" />
      ) : s.targetError ? (
        <Panel>
          <EmptyState icon={AlertCircle} title="Enter a valid domain or page URL." description={s.targetError} action={{ label: "Back to recent searches", onClick: goRecent }} />
        </Panel>
      ) : q.error && !view ? (
        <Panel>
          <EmptyState
            icon={AlertCircle}
            title="Could not load backlinks"
            description={q.error}
            action={
              <div className="flex gap-2">
                <Button variant="outline" onClick={goRecent}>
                  <ArrowLeft /> Recent searches
                </Button>
                <Button onClick={() => q.refetch()}>
                  <RotateCcw /> Retry
                </Button>
              </div>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button variant="ghost" size="sm" onClick={goRecent} className="-ml-2">
              <ArrowLeft /> Recent searches
            </Button>
            <Badge variant="secondary">{RESEARCH_SCOPE_LABELS[s.scope]}</Badge>
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground">Target:</span> <span className="font-medium">{overview?.displayTarget ?? s.target}</span>
            </span>
            {overview && (
              <span className="text-xs text-muted-foreground">
                Updated {formatDateTime(overview.fetchedAt)}
                {s.scope === "domain" ? " - Trends include subdomains" : ""}
              </span>
            )}
          </div>

          {overview ? <BacklinksOverviewPanels overview={overview} scope={s.scope} /> : <BacklinksOverviewSkeleton />}

          <Panel contentClassName="p-3 sm:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-1">
                <Tabs value={s.tab} onValueChange={(v) => setTab(v as BacklinksTab)}>
                  <TabsList variant="line">
                    <TabsTrigger value="backlinks">Backlinks</TabsTrigger>
                    {showDomainsTab && <TabsTrigger value="domains">Referring Domains</TabsTrigger>}
                    <TabsTrigger value="pages">Top Pages</TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="max-w-2xl text-xs text-muted-foreground">{TAB_DESCRIPTIONS[s.tab]}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(q.loading || dr.loading) && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                <ExportMenu getData={exportData} disabled={!table || table.rows.length === 0} />
                {s.tab !== "pages" && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon-sm" className="size-8" aria-label="More actions">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuItem onSelect={() => dr.enable(drDomains)} className="flex-col items-start gap-0">
                        <span className="font-medium">Ahrefs DR {dr.enabled ? "(on)" : ""}</span>
                        <span className="text-xs text-muted-foreground">Look up Ahrefs Domain Rating for each domain in the table</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <FiltersToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} active={activeFilters} />
                {s.tab === "backlinks" && (
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={s.allLinks ? "all" : "one"}
                    onValueChange={(v) => v && set({ view: v === "all" ? "all" : null, page: null })}
                  >
                    <ToggleGroupItem value="one" className="h-8 px-2.5 text-xs">
                      One per domain
                    </ToggleGroupItem>
                    <ToggleGroupItem value="all" className="h-8 px-2.5 text-xs">
                      All links
                    </ToggleGroupItem>
                  </ToggleGroup>
                )}
                {s.tab !== "pages" && (
                  <div className="flex h-8 items-center gap-2 rounded-lg border px-2.5">
                    <Switch id="hide-spam" checked={s.hideSpam} onCheckedChange={(v) => set({ spam: v ? "1" : null, page: null })} />
                    <Label htmlFor="hide-spam" className="text-xs font-normal">
                      Hide spam (&gt;{DEFAULT_BACKLINKS_SPAM_THRESHOLD})
                    </Label>
                  </div>
                )}
              </div>
            </div>

            <FilterPanel
              open={filtersOpen}
              mode="apply"
              values={filterValues}
              onApply={applyFilters}
              budget={budget}
              countConditions={countWithSpam}
              {...filterFields(s.tab)}
              extras={
                s.tab === "backlinks"
                  ? (draft, setField) => (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Link Type</span>
                          <ToggleGroup
                            type="single"
                            variant="outline"
                            size="sm"
                            value={draft.linkType || "all"}
                            onValueChange={(v) => v && setField("linkType", v === "all" ? "" : v)}
                          >
                            <ToggleGroupItem value="all" className="h-7 px-2 text-xs">
                              All
                            </ToggleGroupItem>
                            <ToggleGroupItem value="dofollow" className="h-7 px-2 text-xs">
                              Dofollow
                            </ToggleGroupItem>
                            <ToggleGroupItem value="nofollow" className="h-7 px-2 text-xs">
                              Nofollow
                            </ToggleGroupItem>
                          </ToggleGroup>
                        </div>
                        <label className="flex items-center gap-2 text-xs">
                          <Checkbox checked={draft.hideLost === "1"} onCheckedChange={(v) => setField("hideLost", v ? "1" : "")} />
                          Hide lost
                        </label>
                        <label className="flex items-center gap-2 text-xs">
                          <Checkbox checked={draft.hideBroken === "1"} onCheckedChange={(v) => setField("hideBroken", v ? "1" : "")} />
                          Hide broken
                        </label>
                      </>
                    )
                  : undefined
              }
            />

            <div className="mt-3">
              {info.configured && <CostPill className="mb-2" usd={BACKLINKS_PAGE_ESTIMATE_USD} label="per uncached page" />}
              {view?.tableError ? (
                <EmptyState compact icon={AlertCircle} title="This breakdown isn't available" description={view.tableError} />
              ) : !table ? (
                <div className="space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : table.kind === "backlinks" ? (
                <BacklinksTable
                  rows={table.rows}
                  dr={dr}
                  expandable={!s.allLinks}
                  resetKey={`${s.target}|${s.scope}|${mode}`}
                  expansion={{ projectId: info.projectId, target: s.target, scope: s.scope, hideSpam: s.hideSpam }}
                  {...sortProps}
                />
              ) : table.kind === "domains" ? (
                <ReferringDomainsTable rows={table.rows} dr={dr} {...sortProps} />
              ) : (
                <TopPagesTable rows={table.rows} {...sortProps} />
              )}
              {table && !view?.tableError && (
                <TablePagination
                  page={s.page}
                  pageSize={s.size}
                  pageSizes={[50, 100, 200]}
                  total={table.totalCount}
                  rowCount={table.rows.length}
                  hasMore={table.hasMore}
                  loading={q.loading}
                  onPageChange={(p) => set({ page: p > 1 ? p : null })}
                  onPageSizeChange={(n) => set({ size: n === 100 ? null : n, page: null })}
                />
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function filterFields(tab: BacklinksTab) {
  if (tab === "backlinks") {
    return {
      textFields: [
        { key: "include", label: "Source URL Contains", placeholder: "example.com, blog" },
        { key: "exclude", label: "Source URL Excludes", placeholder: "spam, forum" },
      ],
      rangeFields: [
        { label: "Domain Authority", minKey: "minDomainRank", maxKey: "maxDomainRank", min: 0, max: 100 },
        { label: "Link Authority", minKey: "minLinkAuthority", maxKey: "maxLinkAuthority", min: 0, max: 100 },
        { label: "Spam Score", minKey: "minSpamScore", maxKey: "maxSpamScore", step: 0.1, min: 0, max: 100 },
      ],
    };
  }
  if (tab === "domains") {
    return {
      textFields: [
        { key: "include", label: "Domain Contains", placeholder: "example.com, blog" },
        { key: "exclude", label: "Domain Excludes", placeholder: "spam, forum" },
      ],
      rangeFields: [
        { label: "Backlinks", minKey: "minBacklinks", maxKey: "maxBacklinks", min: 0 },
        { label: "Rank", minKey: "minRank", maxKey: "maxRank", min: 0, max: 100 },
        { label: "Spam Score", minKey: "minSpamScore", maxKey: "maxSpamScore", step: 0.1, min: 0, max: 100 },
      ],
    };
  }
  return {
    textFields: [
      { key: "include", label: "Page URL Contains", placeholder: "/blog, /products" },
      { key: "exclude", label: "Page URL Excludes", placeholder: "/tag, /author" },
    ],
    rangeFields: [
      { label: "Backlinks", minKey: "minBacklinks", maxKey: "maxBacklinks", min: 0 },
      { label: "Referring Domains", minKey: "minReferringDomains", maxKey: "maxReferringDomains", min: 0 },
      { label: "Rank", minKey: "minRank", maxKey: "maxRank", min: 0, max: 100 },
    ],
  };
}
