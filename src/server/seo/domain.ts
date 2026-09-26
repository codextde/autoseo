import "server-only";
import { z } from "zod";
import { assertCanRun, SeoError, type SeoContext } from "./context";
import { dfsLive, firstItems } from "./dfs";
import { buildCacheKey, cacheGet, cacheSet, CACHE_TTL } from "./cache";
import {
  buildDomainRankOverviewTask,
  buildKeywordFilters,
  buildKeywordsOrderBy,
  buildPageFilters,
  buildPagesOrderBy,
  computeHasMore,
  DOMAIN_RANK_OVERVIEW_PATH,
  DOMAIN_SORT_MODES,
  mapDomainOverview,
  mapRankedKeywordItem,
  mapRelevantPageItem,
  RANKED_KEYWORDS_PATH,
  RELEVANT_PAGES_PATH,
  SERP_COMPETITORS_PATH,
  type DomainKeywordRow,
  type DomainOverview,
  type DomainPageRow,
  type PagedResult,
  type RankedKeywordItem,
} from "./lib/domain";
import { buildRankedKeywordsScopeFilter, buildRelevantPagesScopeFilter, joinClauses } from "./lib/filters";
import { assertLabsLocationCode, assertLanguageForLocation, resolveLabsMarket, type Market } from "./lib/locations";
import { parseResearchTarget, RESEARCH_SCOPES, type ResearchScope, type ResearchTarget } from "./lib/research-scope";
import { estimateLabsCall } from "./lib/costs";

const marketInput = {
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().min(2).max(8).optional(),
};

export const domainTargetInput = z.object({
  domain: z.string().trim().min(1).max(500),
  scope: z.enum(RESEARCH_SCOPES).optional(),
  ...marketInput,
});

function parseTargetOrThrow(domain: string, scope?: ResearchScope): ResearchTarget {
  const parsed = parseResearchTarget(domain, scope);
  if (!parsed.ok) throw new SeoError("VALIDATION_ERROR", parsed.message);
  return parsed.target;
}

function resolveDomainMarket(ctx: SeoContext, input: { locationCode?: number; languageCode?: string }): Market {
  const market = resolveLabsMarket(input, ctx.market);
  try {
    assertLabsLocationCode(market.locationCode);
    assertLanguageForLocation(market.locationCode, market.languageCode);
  } catch (err) {
    throw new SeoError("VALIDATION_ERROR", (err as Error).message);
  }
  return market;
}

export type DomainOverviewResult = DomainOverview & { scope: ResearchScope; displayTarget: string; locationCode: number; languageCode: string; cached: boolean };

/**
 * domain_rank_overview (always hostname + subdomains → one cache entry per hostname shared by all scopes).
 * Cached 12h only when hasData.
 */
export async function getDomainOverview(ctx: SeoContext, raw: z.input<typeof domainTargetInput>): Promise<DomainOverviewResult> {
  const input = domainTargetInput.parse(raw);
  const target = parseTargetOrThrow(input.domain, input.scope);
  const market = resolveDomainMarket(ctx, input);
  const key = buildCacheKey("domain:overview", { projectId: ctx.projectId, domain: target.hostname, ...market });
  const cached = await cacheGet<DomainOverview>(key);
  if (cached?.value.hasData) return { ...cached.value, scope: target.scope, displayTarget: target.display, ...market, cached: true };
  assertCanRun(ctx);
  const task = await dfsLive<{ items?: { metrics?: { organic?: { etv?: number | null; count?: number | null } | null } }[] | null }>(
    ctx,
    DOMAIN_RANK_OVERVIEW_PATH,
    buildDomainRankOverviewTask({ target: target.hostname, ...market }),
    { feature: "domain_overview", estimatedCostUsd: estimateLabsCall(1) },
  );
  const overview = mapDomainOverview(target.hostname, task.result[0]?.items ?? []);
  if (overview.hasData) await cacheSet(key, "domain:overview", ctx.projectId, overview, CACHE_TTL.domain);
  return { ...overview, scope: target.scope, displayTarget: target.display, ...market, cached: false };
}

const numeric = z.number().finite().optional();
export const domainKeywordsFiltersSchema = z.object({
  include: z.string().max(500).optional(),
  exclude: z.string().max(500).optional(),
  minTraffic: numeric,
  maxTraffic: numeric,
  minVol: numeric,
  maxVol: numeric,
  minCpc: numeric,
  maxCpc: numeric,
  minKd: numeric,
  maxKd: numeric,
  minRank: numeric,
  maxRank: numeric,
});

export const domainKeywordsPageInput = domainTargetInput.extend({
  page: z.number().int().positive().default(1),
  pageSize: z.union([z.literal(50), z.literal(100), z.literal(200)]).default(100),
  sortMode: z.enum(DOMAIN_SORT_MODES).default("traffic"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  filters: domainKeywordsFiltersSchema.default({}),
  search: z.string().max(200).optional(),
});

export async function getDomainKeywordsPage(
  ctx: SeoContext,
  raw: z.input<typeof domainKeywordsPageInput>,
): Promise<PagedResult<DomainKeywordRow> & { cached: boolean }> {
  const input = domainKeywordsPageInput.parse(raw);
  const target = parseTargetOrThrow(input.domain, input.scope);
  const market = resolveDomainMarket(ctx, input);
  const scope = buildRankedKeywordsScopeFilter(target);
  let filters: unknown[];
  try {
    filters = buildKeywordFilters(input.filters, input.search, scope);
  } catch (err) {
    throw new SeoError("VALIDATION_ERROR", (err as Error).message);
  }
  const offset = (input.page - 1) * input.pageSize;
  const key = buildCacheKey("domain:keywords-page", {
    projectId: ctx.projectId,
    domain: target.hostname,
    scope: target.scope,
    path: target.path,
    ...market,
    page: input.page,
    pageSize: input.pageSize,
    sortMode: input.sortMode,
    sortOrder: input.sortOrder,
    filters: input.filters,
    search: input.search,
  });
  const cached = await cacheGet<PagedResult<DomainKeywordRow>>(key);
  if (cached) return { ...cached.value, cached: true };
  assertCanRun(ctx);
  const task = await dfsLive<{ items?: RankedKeywordItem[] | null; total_count?: number | null }>(
    ctx,
    RANKED_KEYWORDS_PATH,
    {
      target: target.hostname,
      location_code: market.locationCode,
      language_code: market.languageCode,
      limit: input.pageSize,
      offset,
      order_by: buildKeywordsOrderBy(input.sortMode, input.sortOrder),
      filters: filters.length ? filters : undefined,
    },
    { feature: "domain_overview", estimatedCostUsd: estimateLabsCall(input.pageSize) },
  );
  const { items, totalCount } = firstItems(task);
  const result: PagedResult<DomainKeywordRow> = {
    domain: target.hostname,
    page: input.page,
    pageSize: input.pageSize,
    totalCount,
    hasMore: computeHasMore(offset, items.length, totalCount, input.pageSize),
    rows: items.map(mapRankedKeywordItem).filter((r): r is DomainKeywordRow => r != null),
    fetchedAt: new Date().toISOString(),
  };
  await cacheSet(key, "domain:keywords-page", ctx.projectId, result, CACHE_TTL.domain);
  return { ...result, cached: false };
}

export const domainPagesPageInput = domainTargetInput.extend({
  page: z.number().int().positive().default(1),
  pageSize: z.union([z.literal(50), z.literal(100), z.literal(200)]).default(100),
  sortMode: z.enum(["traffic", "keywords"]).default("traffic"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  filters: domainKeywordsFiltersSchema.pick({ include: true, exclude: true, minTraffic: true, maxTraffic: true, minVol: true, maxVol: true }).default({}),
  search: z.string().max(200).optional(),
});

export async function getDomainPagesPage(
  ctx: SeoContext,
  raw: z.input<typeof domainPagesPageInput>,
): Promise<PagedResult<DomainPageRow> & { cached: boolean }> {
  const input = domainPagesPageInput.parse(raw);
  const target = parseTargetOrThrow(input.domain, input.scope);
  const market = resolveDomainMarket(ctx, input);
  const scope = buildRelevantPagesScopeFilter(target);
  let filters: unknown[];
  try {
    filters = buildPageFilters(input.filters, input.search, scope);
  } catch (err) {
    throw new SeoError("VALIDATION_ERROR", (err as Error).message);
  }
  const offset = (input.page - 1) * input.pageSize;
  const key = buildCacheKey("domain:pages-page", {
    projectId: ctx.projectId,
    domain: target.hostname,
    scope: target.scope,
    path: target.path,
    ...market,
    page: input.page,
    pageSize: input.pageSize,
    sortMode: input.sortMode,
    sortOrder: input.sortOrder,
    filters: input.filters,
    search: input.search,
  });
  const cached = await cacheGet<PagedResult<DomainPageRow>>(key);
  if (cached) return { ...cached.value, cached: true };
  assertCanRun(ctx);
  const task = await dfsLive<{ items?: { page_address?: string | null; metrics?: { organic?: { etv?: number | null; count?: number | null } | null } }[] | null; total_count?: number | null }>(
    ctx,
    RELEVANT_PAGES_PATH,
    {
      target: target.hostname,
      location_code: market.locationCode,
      language_code: market.languageCode,
      limit: input.pageSize,
      offset,
      order_by: buildPagesOrderBy(input.sortMode, input.sortOrder),
      filters: filters.length ? filters : undefined,
    },
    { feature: "domain_overview", estimatedCostUsd: estimateLabsCall(input.pageSize) },
  );
  const { items, totalCount } = firstItems(task);
  const result: PagedResult<DomainPageRow> = {
    domain: target.hostname,
    page: input.page,
    pageSize: input.pageSize,
    totalCount,
    hasMore: computeHasMore(offset, items.length, totalCount, input.pageSize),
    rows: items.map(mapRelevantPageItem).filter((r): r is DomainPageRow => r != null),
    fetchedAt: new Date().toISOString(),
  };
  await cacheSet(key, "domain:pages-page", ctx.projectId, result, CACHE_TTL.domain);
  return { ...result, cached: false };
}

export type DomainKeywordSuggestion = Pick<DomainKeywordRow, "keyword" | "position" | "searchVolume" | "traffic" | "cpc" | "keywordDifficulty">;

/** Top 100 ranked keywords by traffic (rank-tracking keyword suggestions, MCP). Cached 12h when non-empty. */
export async function getDomainKeywordSuggestions(ctx: SeoContext, raw: z.input<typeof domainTargetInput>): Promise<DomainKeywordSuggestion[]> {
  const input = domainTargetInput.parse(raw);
  const target = parseTargetOrThrow(input.domain, input.scope);
  const market = resolveDomainMarket(ctx, input);
  const scope = buildRankedKeywordsScopeFilter(target);
  const key = buildCacheKey("domain:keyword-suggestions", {
    projectId: ctx.projectId,
    domain: target.hostname,
    scope: target.scope,
    path: target.path,
    ...market,
  });
  const cached = await cacheGet<DomainKeywordSuggestion[]>(key);
  if (cached && cached.value.length > 0) return cached.value;
  assertCanRun(ctx);
  const task = await dfsLive<{ items?: RankedKeywordItem[] | null; total_count?: number | null }>(
    ctx,
    RANKED_KEYWORDS_PATH,
    {
      target: target.hostname,
      location_code: market.locationCode,
      language_code: market.languageCode,
      limit: 100,
      order_by: ["ranked_serp_element.serp_item.etv,desc"],
      filters: scope.clauses.length ? joinClauses(scope.clauses, "and") : undefined,
    },
    { feature: "domain_overview", estimatedCostUsd: estimateLabsCall(100) },
  );
  const rows = firstItems(task)
    .items.map(mapRankedKeywordItem)
    .filter((r): r is DomainKeywordRow => r != null)
    .map(({ keyword, position, searchVolume, traffic, cpc, keywordDifficulty }) => ({ keyword, position, searchVolume, traffic, cpc, keywordDifficulty }));
  if (rows.length) await cacheSet(key, "domain:keyword-suggestions", ctx.projectId, rows, CACHE_TTL.domain);
  return rows;
}

export const serpCompetitorsInput = z.object({
  keywords: z.array(z.string().min(1).max(200)).min(1).max(200),
  ...marketInput,
  itemTypes: z.array(z.enum(["organic", "paid", "featured_snippet", "local_pack", "ai_overview_reference"])).default(["organic", "local_pack"]),
  includeSubdomains: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).default(50),
  offset: z.number().int().min(0).default(0),
});

export type SerpCompetitor = {
  domain: string;
  avgPosition: number | null;
  medianPosition: number | null;
  visibility: number | null;
  etv: number | null;
  keywordsCount: number | null;
};

/** MCP-only competitor discovery (Labs serp_competitors). Not cached. */
export async function findSerpCompetitors(ctx: SeoContext, raw: z.input<typeof serpCompetitorsInput>): Promise<SerpCompetitor[]> {
  const input = serpCompetitorsInput.parse(raw);
  const market = resolveDomainMarket(ctx, input);
  assertCanRun(ctx);
  const task = await dfsLive<{
    items?: { domain?: string | null; avg_position?: number | null; median_position?: number | null; visibility?: number | null; etv?: number | null; keywords_count?: number | null }[] | null;
  }>(
    ctx,
    SERP_COMPETITORS_PATH,
    {
      keywords: input.keywords,
      location_code: market.locationCode,
      language_code: market.languageCode,
      item_types: input.itemTypes,
      include_subdomains: input.includeSubdomains,
      limit: input.limit,
      offset: input.offset,
    },
    { feature: "keyword_research", estimatedCostUsd: estimateLabsCall(input.limit) },
  );
  return (task.result[0]?.items ?? [])
    .filter((i) => i?.domain)
    .map((i) => ({
      domain: i.domain!,
      avgPosition: i.avg_position ?? null,
      medianPosition: i.median_position ?? null,
      visibility: i.visibility ?? null,
      etv: i.etv ?? null,
      keywordsCount: i.keywords_count ?? null,
    }));
}
