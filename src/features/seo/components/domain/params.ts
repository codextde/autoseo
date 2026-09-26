"use client";

import {
  countDomainFilterConditions,
  DOMAIN_PAGE_SIZES,
  DOMAIN_SORT_MODES,
  defaultOrderForSort,
  KEYWORDS_ONLY_SORTS,
  type DomainKeywordsFilters,
  type DomainPagesFilters,
  type DomainSortMode,
  type SortOrder,
} from "@/server/seo/lib/domain";
import { isLabsLocationCode } from "@/server/seo/lib/locations";
import {
  isResearchScope,
  isScopeAllowedForInput,
  MAX_DATAFORSEO_FILTER_CONDITIONS,
  parseResearchTarget,
  RESEARCH_SCOPE_FILTER_SLOTS,
  type ResearchScope,
  type ResearchTarget,
} from "@/server/seo/lib/research-scope";
import { numOrUndefined } from "./storage";

export const KEYWORD_FILTER_KEYS = ["include", "exclude", "minTraffic", "maxTraffic", "minVol", "maxVol", "minCpc", "maxCpc", "minKd", "maxKd", "minRank", "maxRank"] as const;
export const PAGE_FILTER_KEYS = ["pInclude", "pExclude", "pMinTraffic", "pMaxTraffic", "pMinVol", "pMaxVol"] as const;
export const ALL_FILTER_KEYS = [...KEYWORD_FILTER_KEYS, ...PAGE_FILTER_KEYS];

export type DomainTab = "keywords" | "pages";

export type DomainUrlState = {
  domain: string;
  target: ResearchTarget | null;
  targetError: string | null;
  scope: ResearchScope;
  scopeExplicit: boolean;
  sort: DomainSortMode;
  order: SortOrder;
  tab: DomainTab;
  loc: number;
  page: number;
  size: (typeof DOMAIN_PAGE_SIZES)[number];
  keywordFilters: Record<string, string>;
  pageFilters: Record<string, string>;
};

/** Parses `domainSearchSchema` from the URL (defaults stripped; legacy `subdomains` bool honoured). */
export function parseDomainParams(params: URLSearchParams, defaultLoc: number): DomainUrlState {
  const domain = (params.get("domain") ?? "").trim();
  const rawScope = params.get("scope");
  const legacy = params.get("subdomains");
  let explicit: ResearchScope | undefined = isResearchScope(rawScope) ? rawScope : legacy === "true" ? "subdomains" : legacy === "false" ? "domain" : undefined;
  let target: ResearchTarget | null = null;
  let targetError: string | null = null;
  if (domain) {
    const base = parseResearchTarget(domain);
    if (base.ok && explicit && !isScopeAllowedForInput(explicit, base.target.path)) explicit = undefined;
    const parsed = parseResearchTarget(domain, explicit);
    if (parsed.ok) target = parsed.target;
    else targetError = parsed.message;
  }
  const sortRaw = params.get("sort");
  const sort: DomainSortMode = (DOMAIN_SORT_MODES as readonly string[]).includes(sortRaw ?? "") ? (sortRaw as DomainSortMode) : "traffic";
  const orderRaw = params.get("order");
  const order: SortOrder = orderRaw === "asc" || orderRaw === "desc" ? orderRaw : defaultOrderForSort(sort);
  const tab: DomainTab = params.get("tab") === "pages" ? "pages" : "keywords";
  const locRaw = Number(params.get("loc"));
  const loc = Number.isInteger(locRaw) && isLabsLocationCode(locRaw) ? locRaw : defaultLoc;
  const sizeRaw = Number(params.get("size"));
  const size = (DOMAIN_PAGE_SIZES as readonly number[]).includes(sizeRaw) ? (sizeRaw as DomainUrlState["size"]) : 100;
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const pick = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ""]));
  return {
    domain,
    target,
    targetError,
    scope: target?.scope ?? explicit ?? "subdomains",
    scopeExplicit: explicit != null,
    sort,
    order,
    tab,
    loc,
    page,
    size,
    keywordFilters: pick(KEYWORD_FILTER_KEYS),
    pageFilters: pick(PAGE_FILTER_KEYS),
  };
}

export function toKeywordFilters(v: Record<string, string>): DomainKeywordsFilters {
  const f: DomainKeywordsFilters = {};
  if (v.include?.trim()) f.include = v.include.trim();
  if (v.exclude?.trim()) f.exclude = v.exclude.trim();
  for (const k of ["minTraffic", "maxTraffic", "minVol", "maxVol", "minCpc", "maxCpc", "minKd", "maxKd", "minRank", "maxRank"] as const) {
    const n = numOrUndefined(v[k]);
    if (n != null) f[k] = n;
  }
  return f;
}

export function toPageFilters(v: Record<string, string>): DomainPagesFilters {
  const f: DomainPagesFilters = {};
  if (v.pInclude?.trim()) f.include = v.pInclude.trim();
  if (v.pExclude?.trim()) f.exclude = v.pExclude.trim();
  const map = { pMinTraffic: "minTraffic", pMaxTraffic: "maxTraffic", pMinVol: "minVol", pMaxVol: "maxVol" } as const;
  for (const [k, target] of Object.entries(map) as [keyof typeof map, (typeof map)[keyof typeof map]][]) {
    const n = numOrUndefined(v[k]);
    if (n != null) f[target] = n;
  }
  return f;
}

export function keywordConditions(v: Record<string, string>) {
  return countDomainFilterConditions(toKeywordFilters(v));
}

export function pageConditions(v: Record<string, string>) {
  return countDomainFilterConditions(toPageFilters(v));
}

export function keywordBudget(scope: ResearchScope) {
  return MAX_DATAFORSEO_FILTER_CONDITIONS - RESEARCH_SCOPE_FILTER_SLOTS.keywords[scope];
}

export function pageBudget(scope: ResearchScope) {
  return MAX_DATAFORSEO_FILTER_CONDITIONS - RESEARCH_SCOPE_FILTER_SLOTS.pages[scope];
}

/** Pages tab supports traffic / keywords ("volume" in the shared sort param) only. */
export function pagesSortMode(sort: DomainSortMode): "traffic" | "keywords" {
  return sort === "volume" ? "keywords" : "traffic";
}

export function isKeywordsOnlySort(sort: DomainSortMode) {
  return KEYWORDS_ONLY_SORTS.includes(sort);
}

export function filterDefaultsKey(projectId: string, target: string, tab: DomainTab) {
  return `domain-overview-filter-defaults:${projectId}:${target}:${tab}`;
}
