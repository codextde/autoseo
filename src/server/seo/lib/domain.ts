/**
 * Domain Overview (Labs domain_rank_overview / ranked_keywords / relevant_pages): payloads, filters, mappers.
 * Port of open-seo `features/domain/services/*`. Pure.
 */
import {
  assertFilterConditionBudget,
  collectNumericRange,
  escapeLikeTerm,
  joinClauses,
  parseFilterTerms,
  type FilterClause,
  type ScopeFilter,
} from "./filters";
import { toRelativePath } from "./research-scope";

export const DOMAIN_RANK_OVERVIEW_PATH = "/v3/dataforseo_labs/google/domain_rank_overview/live";
export const RANKED_KEYWORDS_PATH = "/v3/dataforseo_labs/google/ranked_keywords/live";
export const RELEVANT_PAGES_PATH = "/v3/dataforseo_labs/google/relevant_pages/live";
export const SERP_COMPETITORS_PATH = "/v3/dataforseo_labs/google/serp_competitors/live";

export const DOMAIN_SORT_MODES = ["rank", "traffic", "volume", "score", "cpc"] as const;
export type DomainSortMode = (typeof DOMAIN_SORT_MODES)[number];
export type SortOrder = "asc" | "desc";
export const DOMAIN_PAGE_SIZES = [50, 100, 200] as const;
export const DOMAIN_SORT_LABELS: Record<DomainSortMode, string> = {
  rank: "By Rank",
  traffic: "By Traffic",
  volume: "By Volume",
  score: "By Score",
  cpc: "By CPC",
};
/** rank sorts ascending by default, everything else descending. */
export function defaultOrderForSort(sort: DomainSortMode): SortOrder {
  return sort === "rank" ? "asc" : "desc";
}
/** Sorts that only exist on the keywords tab. */
export const KEYWORDS_ONLY_SORTS: DomainSortMode[] = ["rank", "score", "cpc"];

export type DomainKeywordsFilters = {
  include?: string;
  exclude?: string;
  minTraffic?: number;
  maxTraffic?: number;
  minVol?: number;
  maxVol?: number;
  minCpc?: number;
  maxCpc?: number;
  minKd?: number;
  maxKd?: number;
  minRank?: number;
  maxRank?: number;
};

/** Pages tab reuses minTraffic/maxTraffic and minVol/maxVol (= keyword count). */
export type DomainPagesFilters = Pick<DomainKeywordsFilters, "include" | "exclude" | "minTraffic" | "maxTraffic" | "minVol" | "maxVol">;

export type DomainOverview = {
  domain: string;
  organicTraffic: number | null;
  organicKeywords: number | null;
  /** Legacy fields (always null — not displayed). */
  backlinks: null;
  referringDomains: null;
  hasData: boolean;
  fetchedAt: string;
};

export type DomainKeywordRow = {
  keyword: string;
  position: number | null;
  searchVolume: number | null;
  traffic: number | null;
  cpc: number | null;
  url: string | null;
  relativeUrl: string | null;
  keywordDifficulty: number | null;
};

export type DomainPageRow = { page: string; relativePath: string | null; organicTraffic: number | null; keywords: number | null };

export type PagedResult<T> = {
  domain: string;
  page: number;
  pageSize: number;
  totalCount: number | null;
  hasMore: boolean;
  rows: T[];
  fetchedAt: string;
};

type LabsMetrics = { organic?: { etv?: number | null; count?: number | null } | null } | null | undefined;

export function buildDomainRankOverviewTask(input: { target: string; locationCode: number; languageCode: string }) {
  return { target: input.target, location_code: input.locationCode, language_code: input.languageCode, limit: 1 };
}

export function mapDomainOverview(domain: string, items: ({ metrics?: LabsMetrics } | null | undefined)[], now = new Date()): DomainOverview {
  const m = items[0]?.metrics;
  const organicTraffic = m?.organic?.etv != null ? Math.round(m.organic.etv) : null;
  const organicKeywords = m?.organic?.count != null ? Math.round(m.organic.count) : null;
  return {
    domain,
    organicTraffic,
    organicKeywords,
    backlinks: null,
    referringDomains: null,
    hasData: organicKeywords != null && organicKeywords > 0,
    fetchedAt: now.toISOString(),
  };
}

const KEYWORD_SORT_FIELD: Record<DomainSortMode, string> = {
  rank: "ranked_serp_element.serp_item.rank_absolute",
  traffic: "ranked_serp_element.serp_item.etv",
  volume: "keyword_data.keyword_info.search_volume",
  score: "keyword_data.keyword_properties.keyword_difficulty",
  cpc: "keyword_data.keyword_info.cpc",
};

export function buildKeywordsOrderBy(sort: DomainSortMode, order: SortOrder): string[] {
  return [`${KEYWORD_SORT_FIELD[sort]},${order}`];
}

/** Scope clauses, include (each ANDed), exclude, ranges, search OR-group (2 slots) — all AND-joined. */
export function buildKeywordFilters(filters: DomainKeywordsFilters, searchTerm?: string, scope?: ScopeFilter): unknown[] {
  const conditions: FilterClause[] = [];
  for (const t of parseFilterTerms(filters.include)) conditions.push(["keyword_data.keyword", "ilike", `%${escapeLikeTerm(t)}%`]);
  for (const t of parseFilterTerms(filters.exclude)) conditions.push(["keyword_data.keyword", "not_ilike", `%${escapeLikeTerm(t)}%`]);
  collectNumericRange(conditions, "keyword_data.keyword_info.search_volume", filters.minVol, filters.maxVol);
  collectNumericRange(conditions, "ranked_serp_element.serp_item.etv", filters.minTraffic, filters.maxTraffic);
  collectNumericRange(conditions, "keyword_data.keyword_info.cpc", filters.minCpc, filters.maxCpc);
  collectNumericRange(conditions, "keyword_data.keyword_properties.keyword_difficulty", filters.minKd, filters.maxKd);
  collectNumericRange(conditions, "ranked_serp_element.serp_item.rank_absolute", filters.minRank, filters.maxRank);
  const search = searchTerm?.trim();
  const searchGroup: FilterClause | null = search
    ? [["keyword_data.keyword", "ilike", `%${escapeLikeTerm(search)}%`], "or", ["ranked_serp_element.serp_item.url", "ilike", `%${escapeLikeTerm(search)}%`]]
    : null;
  assertFilterConditionBudget((scope?.conditionCount ?? 0) + conditions.length + (searchGroup ? 2 : 0));
  return joinClauses([...(scope?.clauses ?? []), ...conditions, ...(searchGroup ? [searchGroup] : [])], "and");
}

export function buildPagesOrderBy(sort: "traffic" | "keywords", order: SortOrder): string[] {
  return [`${sort === "traffic" ? "metrics.organic.etv" : "metrics.organic.count"},${order}`];
}

export function buildPageFilters(filters: DomainPagesFilters, searchTerm: string | undefined, scope: ScopeFilter): unknown[] {
  const conditions: FilterClause[] = [];
  for (const t of parseFilterTerms(filters.include)) conditions.push(["page_address", "ilike", `%${escapeLikeTerm(t)}%`]);
  for (const t of parseFilterTerms(filters.exclude)) conditions.push(["page_address", "not_ilike", `%${escapeLikeTerm(t)}%`]);
  collectNumericRange(conditions, "metrics.organic.etv", filters.minTraffic, filters.maxTraffic);
  collectNumericRange(conditions, "metrics.organic.count", filters.minVol, filters.maxVol);
  const search = searchTerm?.trim();
  if (search) conditions.push(["page_address", "ilike", `%${escapeLikeTerm(search)}%`]);
  assertFilterConditionBudget(scope.conditionCount + conditions.length);
  return joinClauses([...scope.clauses, ...conditions], "and");
}

/** Client-side condition count (each term 1, each range bound 1). */
export function countDomainFilterConditions(filters: DomainKeywordsFilters): number {
  let n = parseFilterTerms(filters.include).length + parseFilterTerms(filters.exclude).length;
  for (const [k, v] of Object.entries(filters)) {
    if (k === "include" || k === "exclude") continue;
    if (typeof v === "number" && Number.isFinite(v)) n++;
  }
  return n;
}

export type RankedKeywordItem = {
  keyword?: string | null;
  keyword_data?: {
    keyword?: string | null;
    keyword_info?: { search_volume?: number | null; cpc?: number | null; keyword_difficulty?: number | null } | null;
    keyword_properties?: { keyword_difficulty?: number | null } | null;
  } | null;
  ranked_serp_element?: {
    serp_item?: { url?: string | null; relative_url?: string | null; rank_absolute?: number | null; etv?: number | null; domain?: string | null } | null;
    url?: string | null;
    relative_url?: string | null;
    rank_absolute?: number | null;
    etv?: number | null;
  } | null;
};

export function mapRankedKeywordItem(item: RankedKeywordItem | null | undefined): DomainKeywordRow | null {
  if (!item) return null;
  const kd = item.keyword_data;
  const rse = item.ranked_serp_element;
  const serp = rse?.serp_item;
  const keyword = kd?.keyword ?? item.keyword;
  if (!keyword) return null;
  const url = serp?.url ?? rse?.url ?? null;
  const relativeUrl = serp?.relative_url ?? rse?.relative_url ?? (url ? toRelativePath(url) : null);
  const position = serp?.rank_absolute ?? rse?.rank_absolute ?? null;
  const traffic = serp?.etv ?? rse?.etv ?? null;
  const difficulty = kd?.keyword_properties?.keyword_difficulty ?? kd?.keyword_info?.keyword_difficulty ?? null;
  return {
    keyword,
    position: position != null ? Math.round(position) : null,
    searchVolume: kd?.keyword_info?.search_volume != null ? Math.round(kd.keyword_info.search_volume) : null,
    traffic,
    cpc: kd?.keyword_info?.cpc ?? null,
    url,
    relativeUrl,
    keywordDifficulty: difficulty != null ? Math.round(difficulty) : null,
  };
}

export function mapRelevantPageItem(item: { page_address?: string | null; metrics?: LabsMetrics } | null | undefined): DomainPageRow | null {
  const url = item?.page_address ?? null;
  if (!url) return null;
  const organic = item?.metrics?.organic ?? null;
  return {
    page: url,
    relativePath: toRelativePath(url),
    organicTraffic: organic?.etv != null ? Math.round(organic.etv) : null,
    keywords: organic?.count != null ? Math.round(organic.count) : null,
  };
}

export function computeHasMore(offset: number, fetched: number, totalCount: number | null | undefined, pageSize: number): boolean {
  return totalCount != null ? offset + fetched < totalCount : fetched === pageSize;
}

/** Relative paths resolve against https://{baseDomain}; only absolute http(s) links are allowed. */
export function resolveUrlHref(value: string | null | undefined, baseDomain: string): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `https://${baseDomain}${value}`;
  return null;
}
