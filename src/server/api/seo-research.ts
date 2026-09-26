import "server-only";
import { z } from "zod";
import {
  findSerpCompetitors,
  fetchKeywordMetricsForList,
  getBacklinksOverview,
  getBacklinksRows,
  getBacklinksTopPages,
  getDomainKeywordSuggestions,
  getDomainKeywordsPage,
  getDomainOverview,
  getDomainPagesPage,
  getReferringDomains,
  getSerpAnalysis,
  listSavedKeywords,
  listTagSummaries,
  removeSavedKeywords,
  researchKeywords,
  saveKeywords,
  saveKeywordsInput,
  searchSerpLocations,
  updateSavedKeywordTags,
  upsertKeywordMetrics,
  type SeoContext,
} from "@/server/seo";
import { normalizeIntent } from "@/server/seo/lib/keywords";
import { getKeywordDataProvider, isSupportedLanguageCode, locationLabel, resolveMarket } from "@/server/seo/lib/locations";
import { RESEARCH_SCOPES } from "@/server/seo/lib/research-scope";
import { BACKLINKS_ROWS_SORT_FIELDS, REFERRING_DOMAINS_SORT_FIELDS, TOP_PAGES_SORT_FIELDS } from "@/server/seo/lib/backlinks";
import { SAVED_SORT_FIELDS, updateSavedKeywordTagsInput } from "@/server/seo/saved-keywords";
import { env } from "@/server/env";
import { ApiError, zodIssues } from "./errors";
import { toApiError } from "./error-map";
import { getApiProject, type ApiPrincipal } from "./auth";
import { apiSeoContext } from "./module-context";

/**
 * Keyword research, saved keywords, SERP, domain and backlink lookups for REST v1 + MCP (open-seo
 * tool semantics). Thin adapters over `src/server/seo` services: paid calls go through the SEO
 * module (cache first, `seo.run` required on a cache miss, usage recorded by the DataForSEO client).
 */

const market = {
  locationCode: z.number().int().positive().optional().describe("DataForSEO location code (e.g. 2276 = Germany, 2840 = US). Default: project market."),
  languageCode: z.string().min(2).max(8).optional().describe("Language code, e.g. de, en. Default: the market's language."),
};
const scopeField = z
  .enum(RESEARCH_SCOPES)
  .optional()
  .describe("domain = hostname only, subdomains = hostname + subdomains (default for bare domains), subfolder = a path prefix (default for URLs with a path), exact_url = one page.");

const keywordRow = (r: { keyword: string; searchVolume: number | null; keywordDifficulty: number | null; cpc: number | null; competition: number | null; intent: string | null }) => ({
  keyword: r.keyword,
  searchVolume: r.searchVolume,
  keywordDifficulty: r.keywordDifficulty,
  cpc: r.cpc,
  competition: r.competition,
  intent: r.intent,
});

function errorMessage(err: unknown): string {
  const api = toApiError(err);
  if (api) return api.message;
  const issues = zodIssues(err);
  if (issues) return issues.map((i) => `${i.path}: ${i.message}`).join("; ");
  return err instanceof Error ? err.message : "Request failed.";
}

/** Batch helper: per-item results; if every item failed, rethrow the first error (proper status / tool error). */
async function perItem<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<({ ok: true } & R | { ok: false; error: string })[]> {
  const settled = await Promise.allSettled(items.map(fn));
  if (settled.length && settled.every((s) => s.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason;
  return settled.map((s) => (s.status === "fulfilled" ? { ok: true as const, ...s.value } : { ok: false as const, error: errorMessage(s.reason) }));
}

export const projectLink = (projectId: string, path: string, params: Record<string, string | number | undefined> = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
  return `${env.appUrl}/p/${projectId}${path}${qs ? `?${qs}` : ""}`;
};

/* ───────────────────────────── Keyword research ───────────────────────────── */

export const researchKeywordsBody = z.object({
  seeds: z
    .array(
      z.union([
        z.string().trim().min(1).max(200),
        z.object({ seed: z.string().trim().min(1).max(200), ...market }),
      ]),
    )
    .min(1)
    .max(5)
    .describe("1–5 seed keywords (researched separately). Strings, or { seed, locationCode?, languageCode? } for a per-seed market."),
  ...market,
  resultLimit: z.union([z.literal(150), z.literal(300), z.literal(500)]).default(150).describe("Max keywords per seed: 150, 300 or 500."),
  mode: z
    .enum(["auto", "related", "suggestions", "ideas"])
    .default("auto")
    .describe("auto tries related → suggestions → ideas until enough results (Google-Ads-only countries always use keyword ideas)."),
  includeClickstreamData: z.boolean().default(false).describe("Clickstream-normalized volumes (doubles the cost; Labs countries only)."),
});

export async function researchKeywordsForApi(ctx: SeoContext, body: z.input<typeof researchKeywordsBody>) {
  const b = researchKeywordsBody.parse(body);
  const seeds = b.seeds.map((s) => (typeof s === "string" ? { seed: s, locationCode: b.locationCode, languageCode: b.languageCode } : s));
  const results = await perItem(seeds, async (s) => {
    const r = await researchKeywords(ctx, {
      keywords: [s.seed],
      locationCode: s.locationCode ?? b.locationCode,
      languageCode: s.languageCode ?? b.languageCode,
      resultLimit: b.resultLimit,
      mode: b.mode,
      clickstream: b.includeClickstreamData,
    });
    return {
      seed: r.seed,
      rowCount: r.rows.length,
      source: r.source,
      usedFallback: r.usedFallback,
      cached: r.cached,
      fetchedAt: r.fetchedAt,
      locationCode: r.locationCode,
      location: locationLabel(r.locationCode),
      languageCode: r.languageCode,
      rows: r.rows.map(keywordRow),
    };
  });
  return {
    results: results.map((r, i) => (r.ok ? r : { seed: seeds[i]!.seed, ...r })),
    url: projectLink(ctx.projectId, "/seo/keywords", { q: seeds[0]!.seed }),
  };
}

export const keywordMetricsBody = z.object({
  keywords: z.array(z.string().trim().min(1).max(200)).min(1).max(700).describe("1–700 keywords."),
  ...market,
  includeMonthlyTrends: z.boolean().default(true).describe("Include the 12-month search volume trend."),
  includeClickstreamData: z.boolean().default(false).describe("Clickstream-normalized volumes (doubles the cost; Labs countries only)."),
  sortBy: z.enum(["search_volume", "keyword_difficulty", "cpc", "competition"]).default("search_volume"),
});

export async function keywordMetricsForApi(ctx: SeoContext, body: z.input<typeof keywordMetricsBody>) {
  const b = keywordMetricsBody.parse(body);
  const m = resolveMarket(b, ctx.market);
  if (!isSupportedLanguageCode(m.languageCode)) throw new ApiError("validation_error", `Unsupported language '${m.languageCode}'.`);
  const keywords = [...new Set(b.keywords.map((k) => k.toLowerCase()))];
  const rows = await fetchKeywordMetricsForList(ctx, {
    keywords,
    locationCode: m.locationCode,
    languageCode: m.languageCode,
    feature: "keyword_research",
    includeClickstreamData: b.includeClickstreamData,
  });
  await upsertKeywordMetrics(
    ctx.projectId,
    m.locationCode,
    m.languageCode,
    rows.map((r) => ({ ...r, keyword: r.keyword.toLowerCase() })),
  );
  const key = { search_volume: "searchVolume", keyword_difficulty: "keywordDifficulty", cpc: "cpc", competition: "competition" } as const;
  const sortKey = key[b.sortBy];
  const out = rows
    .map((r) => ({
      keyword: r.keyword,
      searchVolume: r.searchVolume,
      keywordDifficulty: r.keywordDifficulty,
      cpc: r.cpc,
      competition: r.competition,
      competitionLevel: r.competitionLevel,
      intent: r.intent ? normalizeIntent(r.intent) : null,
      ...(b.includeMonthlyTrends ? { monthlySearches: r.monthlySearches } : {}),
    }))
    .sort((a, c) => (c[sortKey] ?? -1) - (a[sortKey] ?? -1));
  return {
    locationCode: m.locationCode,
    location: locationLabel(m.locationCode),
    languageCode: m.languageCode,
    provider: getKeywordDataProvider(m.locationCode),
    requested: keywords.length,
    keywords: out,
  };
}

/* ───────────────────────────── Saved keywords ───────────────────────────── */

export const listSavedKeywordsBody = z.object({
  search: z.string().max(200).optional().describe("Substring of the keyword."),
  tags: z.array(z.string().min(1).max(64)).max(20).optional().describe("Tag names (keywords with ANY of the tags)."),
  minVolume: z.number().int().nonnegative().optional(),
  maxVolume: z.number().int().nonnegative().optional(),
  minDifficulty: z.number().int().min(0).max(100).optional(),
  maxDifficulty: z.number().int().min(0).max(100).optional(),
  sort: z.enum(SAVED_SORT_FIELDS).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().positive().max(10_000).default(1),
  limit: z.union([z.literal(50), z.literal(100), z.literal(250)]).default(100).describe("Page size: 50, 100 or 250."),
});

/** Query-string variant for REST GET. */
export const listSavedKeywordsQuery = z.object({
  search: z.string().max(200).optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
  minVolume: z.coerce.number().int().nonnegative().optional(),
  maxVolume: z.coerce.number().int().nonnegative().optional(),
  minDifficulty: z.coerce.number().int().min(0).max(100).optional(),
  maxDifficulty: z.coerce.number().int().min(0).max(100).optional(),
  sort: z.enum(SAVED_SORT_FIELDS).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().positive().max(10_000).default(1),
  limit: z.coerce
    .number()
    .refine((v) => v === 50 || v === 100 || v === 250, "limit must be 50, 100 or 250")
    .default(100),
});

export async function listSavedKeywordsForApi(ctx: SeoContext, q: z.input<typeof listSavedKeywordsBody>) {
  const f = listSavedKeywordsBody.parse(q);
  const res = await listSavedKeywords(ctx, {
    search: f.search,
    tagNames: f.tags,
    minVolume: f.minVolume,
    maxVolume: f.maxVolume,
    minDifficulty: f.minDifficulty,
    maxDifficulty: f.maxDifficulty,
    sort: f.sort,
    order: f.order,
    page: f.page,
    pageSize: f.limit,
  });
  return {
    rows: res.rows.map((r) => ({
      id: r.id,
      keyword: r.keyword,
      locationCode: r.locationCode,
      languageCode: r.languageCode,
      searchVolume: r.searchVolume,
      keywordDifficulty: r.keywordDifficulty,
      cpc: r.cpc,
      competition: r.competition,
      intent: r.intent,
      tags: r.tags.map((t) => t.name),
      createdAt: r.createdAt.toISOString(),
      metricsFetchedAt: r.fetchedAt?.toISOString() ?? null,
    })),
    totalCount: res.totalCount,
    tags: res.tags.map((t) => ({ id: t.id, name: t.name, keywordCount: t.keywordCount })),
    pagination: { page: f.page, limit: f.limit, total: res.totalCount, totalPages: Math.max(1, Math.ceil(res.totalCount / f.limit)) },
    url: projectLink(ctx.projectId, "/seo/saved-keywords"),
  };
}

export async function listSavedKeywordTagsForApi(ctx: SeoContext) {
  return (await listTagSummaries(ctx.projectId)).map((t) => ({ id: t.id, name: t.name, color: t.color, keywordCount: t.keywordCount }));
}

export const saveKeywordsBody = saveKeywordsInput;

export async function saveKeywordsForApi(ctx: SeoContext, body: z.input<typeof saveKeywordsBody>) {
  const b = saveKeywordsBody.parse(body);
  const m = resolveMarket(b, ctx.market);
  const res = await saveKeywords(ctx, b);
  return {
    savedCount: res.savedCount,
    savedKeywordIds: res.savedKeywordIds,
    requested: b.keywords.length,
    tags: b.tags ?? [],
    tagMode: b.tagMode,
    locationCode: m.locationCode,
    languageCode: m.languageCode,
    url: projectLink(ctx.projectId, "/seo/saved-keywords"),
  };
}

export const removeSavedKeywordsBody = z.object({
  savedKeywordIds: z.array(z.string().min(1).max(64)).min(1).max(2000).describe("Saved keyword row ids (from list_saved_keywords)."),
});

export async function removeSavedKeywordsForApi(ctx: SeoContext, body: z.input<typeof removeSavedKeywordsBody>) {
  const b = removeSavedKeywordsBody.parse(body);
  const res = await removeSavedKeywords(ctx, { savedKeywordIds: b.savedKeywordIds });
  return { requested: b.savedKeywordIds.length, deletedCount: res.deletedCount };
}

export const tagSavedKeywordsBody = updateSavedKeywordTagsInput;

export async function tagSavedKeywordsForApi(ctx: SeoContext, body: z.input<typeof tagSavedKeywordsBody>) {
  const res = await updateSavedKeywordTags(ctx, body);
  return {
    taggedCount: res.taggedCount,
    addedTags: res.addedTags.map((t) => ({ id: t.id, name: t.name })),
    removedTagIds: res.removedTagIds,
    removedAssignments: res.removedAssignments,
  };
}

/* ───────────────────────────── SERP ───────────────────────────── */

export const serpResultsBody = z.object({
  queries: z
    .array(
      z.union([
        z.string().trim().min(1).max(200),
        z.object({ keyword: z.string().trim().min(1).max(200), ...market }),
      ]),
    )
    .min(1)
    .max(10)
    .describe("1–10 keywords (strings, or { keyword, locationCode?, languageCode? })."),
  ...market,
  depth: z.union([z.literal(20), z.literal(100)]).default(20).describe("Organic results to fetch: 20 (default) or 100."),
});

export async function serpResultsForApi(ctx: SeoContext, body: z.input<typeof serpResultsBody>) {
  const b = serpResultsBody.parse(body);
  const queries = b.queries.map((q) => (typeof q === "string" ? { keyword: q } : q));
  const results = await perItem(queries, async (q) => {
    const r = await getSerpAnalysis(ctx, {
      keyword: q.keyword,
      locationCode: "locationCode" in q && q.locationCode ? q.locationCode : b.locationCode,
      languageCode: "languageCode" in q && q.languageCode ? q.languageCode : b.languageCode,
      depth: b.depth,
    });
    return {
      keyword: r.requestedKeyword,
      depth: r.depth,
      cached: r.cached,
      fetchedAt: r.fetchedAt,
      ...(r.reason ? { reason: r.reason } : {}),
      items: r.items.map((i) => ({
        rank: i.rank,
        title: i.title,
        url: i.url,
        domain: i.domain,
        description: i.description,
        etv: i.etv,
        referringDomains: i.referringDomains,
        backlinks: i.backlinks,
      })),
    };
  });
  return { results: results.map((r, i) => (r.ok ? r : { keyword: queries[i]!.keyword, ...r })) };
}

export const serpLocationsQuery = z.object({
  query: z.string().trim().min(1).max(100).describe("Place name, e.g. Berlin or Catonsville."),
  countryCode: z
    .string()
    .regex(/^[A-Za-z]{2}$/, "2-letter ISO country code")
    .describe("2-letter ISO country code, e.g. DE, US."),
});

export async function serpLocationsForApi(ctx: Pick<SeoContext, "projectId">, q: z.input<typeof serpLocationsQuery>) {
  const b = serpLocationsQuery.parse(q);
  const list = await searchSerpLocations(ctx, { query: b.query, countryCode: b.countryCode === "UK" ? "gb" : b.countryCode });
  return { locations: list.map((l) => ({ locationName: l.locationName, locationCode: l.locationCode, locationType: l.locationType })) };
}

/* ───────────────────────────── Domain ───────────────────────────── */

const domainField = z.string().trim().min(1).max(500).optional().describe("Domain or URL to analyse. Default: the project domain.");

export const domainOverviewBody = z.object({ domain: domainField, scope: scopeField, ...market });

export async function domainOverviewForApi(ctx: SeoContext, body: z.input<typeof domainOverviewBody>) {
  const b = domainOverviewBody.parse(body);
  const domain = b.domain ?? ctx.project.domain;
  const o = await getDomainOverview(ctx, { domain, scope: b.scope, locationCode: b.locationCode, languageCode: b.languageCode });
  return {
    domain: o.domain,
    displayTarget: o.displayTarget,
    scope: o.scope,
    organicTraffic: o.organicTraffic,
    organicKeywords: o.organicKeywords,
    hasData: o.hasData,
    locationCode: o.locationCode,
    location: locationLabel(o.locationCode),
    languageCode: o.languageCode,
    cached: o.cached,
    fetchedAt: o.fetchedAt,
    note: "Organic traffic (ETV) and ranking keywords always cover the hostname incl. subdomains.",
    url: projectLink(ctx.projectId, "/seo/domain", { domain: o.displayTarget }),
  };
}

export async function domainKeywordSuggestionsForApi(ctx: SeoContext, body: z.input<typeof domainOverviewBody>) {
  const b = domainOverviewBody.parse(body);
  const domain = b.domain ?? ctx.project.domain;
  const rows = await getDomainKeywordSuggestions(ctx, { domain, scope: b.scope, locationCode: b.locationCode, languageCode: b.languageCode });
  return { domain, scope: b.scope ?? null, keywords: rows, url: projectLink(ctx.projectId, "/seo/domain", { domain }) };
}

const numeric = z.number().finite().optional();

export const rankedKeywordsBody = z.object({
  domain: domainField,
  scope: scopeField,
  ...market,
  sortBy: z.enum(["rank", "traffic", "volume", "cpc", "score"]).default("traffic").describe("rank = position, traffic = estimated traffic (ETV), volume = search volume, cpc, score."),
  sortOrder: z.enum(["asc", "desc"]).optional().describe("Default asc for rank, desc otherwise."),
  page: z.number().int().positive().max(1000).default(1),
  pageSize: z.union([z.literal(50), z.literal(100), z.literal(200)]).default(100),
  minSearchVolume: numeric,
  maxSearchVolume: numeric,
  minRank: numeric,
  maxRank: z.number().int().min(1).max(100).optional().describe("Only keywords ranking at or above this position."),
  minTraffic: numeric,
  maxTraffic: numeric,
  minCpc: numeric,
  maxCpc: numeric,
  minKeywordDifficulty: numeric,
  maxKeywordDifficulty: numeric,
  include: z.array(z.string().min(1).max(80)).max(10).optional().describe("Keyword must contain any of these terms."),
  excludeTerms: z.array(z.string().min(1).max(80)).max(10).optional().describe("Exclude keywords containing these terms (e.g. brand terms)."),
  search: z.string().max(200).optional().describe("Substring of keyword or ranking URL."),
});

export async function rankedKeywordsForApi(ctx: SeoContext, body: z.input<typeof rankedKeywordsBody>) {
  const b = rankedKeywordsBody.parse(body);
  const domain = b.domain ?? ctx.project.domain;
  const res = await getDomainKeywordsPage(ctx, {
    domain,
    scope: b.scope,
    locationCode: b.locationCode,
    languageCode: b.languageCode,
    page: b.page,
    pageSize: b.pageSize,
    sortMode: b.sortBy,
    sortOrder: b.sortOrder ?? (b.sortBy === "rank" ? "asc" : "desc"),
    search: b.search,
    filters: {
      include: b.include?.join(","),
      exclude: b.excludeTerms?.join(","),
      minVol: b.minSearchVolume,
      maxVol: b.maxSearchVolume,
      minRank: b.minRank,
      maxRank: b.maxRank,
      minTraffic: b.minTraffic,
      maxTraffic: b.maxTraffic,
      minCpc: b.minCpc,
      maxCpc: b.maxCpc,
      minKd: b.minKeywordDifficulty,
      maxKd: b.maxKeywordDifficulty,
    },
  });
  return {
    domain: res.domain,
    page: res.page,
    pageSize: res.pageSize,
    totalCount: res.totalCount,
    hasMore: res.hasMore,
    cached: res.cached,
    fetchedAt: res.fetchedAt,
    keywords: res.rows,
    url: projectLink(ctx.projectId, "/seo/domain", { domain }),
  };
}

export const domainTopPagesBody = z.object({
  domain: domainField,
  scope: scopeField,
  ...market,
  sortBy: z.enum(["traffic", "keywords"]).default("traffic"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().positive().max(1000).default(1),
  pageSize: z.union([z.literal(50), z.literal(100), z.literal(200)]).default(100),
  minTraffic: numeric,
  maxTraffic: numeric,
  minKeywords: numeric,
  maxKeywords: numeric,
  include: z.array(z.string().min(1).max(80)).max(10).optional().describe("URL must contain any of these terms."),
  excludeTerms: z.array(z.string().min(1).max(80)).max(10).optional().describe("Exclude URLs containing these terms."),
  search: z.string().max(200).optional(),
});

export async function domainTopPagesForApi(ctx: SeoContext, body: z.input<typeof domainTopPagesBody>) {
  const b = domainTopPagesBody.parse(body);
  const domain = b.domain ?? ctx.project.domain;
  const res = await getDomainPagesPage(ctx, {
    domain,
    scope: b.scope,
    locationCode: b.locationCode,
    languageCode: b.languageCode,
    page: b.page,
    pageSize: b.pageSize,
    sortMode: b.sortBy,
    sortOrder: b.sortOrder,
    search: b.search,
    filters: {
      include: b.include?.join(","),
      exclude: b.excludeTerms?.join(","),
      minTraffic: b.minTraffic,
      maxTraffic: b.maxTraffic,
      minVol: b.minKeywords,
      maxVol: b.maxKeywords,
    },
  });
  return {
    domain: res.domain,
    page: res.page,
    pageSize: res.pageSize,
    totalCount: res.totalCount,
    hasMore: res.hasMore,
    cached: res.cached,
    fetchedAt: res.fetchedAt,
    pages: res.rows,
    url: projectLink(ctx.projectId, "/seo/domain", { domain }),
  };
}

export const serpCompetitorsBody = z.object({
  keywords: z.array(z.string().trim().min(1).max(120)).min(1).max(100).describe("1–100 keywords that define the market."),
  ...market,
  resultTypes: z
    .array(z.enum(["organic", "paid", "featured_snippet", "local_pack", "ai_overview_reference"]))
    .min(1)
    .max(5)
    .default(["organic", "local_pack"]),
  includeSubdomains: z.boolean().optional(),
  excludeDomains: z.array(z.string().min(1).max(253)).max(50).optional().describe("Domains to drop from the result (e.g. your own, marketplaces)."),
  sortBy: z.enum(["visibility", "traffic_estimate", "avg_position", "keyword_count"]).default("visibility"),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(1000).default(0),
});

export async function serpCompetitorsForApi(ctx: SeoContext, body: z.input<typeof serpCompetitorsBody>) {
  const b = serpCompetitorsBody.parse(body);
  const rows = await findSerpCompetitors(ctx, {
    keywords: b.keywords,
    locationCode: b.locationCode,
    languageCode: b.languageCode,
    itemTypes: b.resultTypes,
    includeSubdomains: b.includeSubdomains,
    limit: b.limit,
    offset: b.offset,
  });
  const exclude = new Set((b.excludeDomains ?? []).map((d) => d.toLowerCase().replace(/^www\./, "")));
  const value = (r: (typeof rows)[number]) =>
    b.sortBy === "traffic_estimate" ? r.etv : b.sortBy === "avg_position" ? r.avgPosition : b.sortBy === "keyword_count" ? r.keywordsCount : r.visibility;
  const competitors = rows
    .filter((r) => !exclude.has(r.domain.toLowerCase().replace(/^www\./, "")))
    .sort((a, c) => {
      const va = value(a);
      const vc = value(c);
      if (va == null) return 1;
      if (vc == null) return -1;
      return b.sortBy === "avg_position" ? va - vc : vc - va;
    });
  return { keywords: b.keywords.length, competitors };
}

/* ───────────────────────────── Backlinks ───────────────────────────── */

const targetField = z.string().trim().min(1).max(500).optional().describe("Domain or page URL. Default: the project domain.");
const backlinksScope = z
  .enum(["domain", "subdomains", "subfolder", "exact_url"])
  .optional()
  .describe("domain (hostname only), subdomains (incl. subdomains), subfolder (path prefix) or exact_url (one page).");
const spamFields = {
  hideSpam: z.boolean().default(true).describe("Hide spammy links (spam score above spamThreshold)."),
  spamThreshold: z.number().min(0).max(100).optional().describe("Spam score cut-off (default 40)."),
};

export const backlinksOverviewBody = z.object({
  target: targetField,
  scope: backlinksScope,
  includeReferringDomains: z.boolean().default(true).describe("Also fetch the top 100 referring domains (one extra paid page; not for subfolder scope)."),
  ...spamFields,
});

export async function backlinksOverviewForApi(ctx: SeoContext, body: z.input<typeof backlinksOverviewBody>) {
  const b = backlinksOverviewBody.parse(body);
  const target = b.target ?? ctx.project.domain;
  const overview = await getBacklinksOverview(ctx, { target, scope: b.scope });
  let referringDomains: Awaited<ReturnType<typeof getReferringDomains>> | null = null;
  if (b.includeReferringDomains && overview.scope !== "subfolder") {
    referringDomains = await getReferringDomains(ctx, {
      target,
      scope: b.scope,
      page: 1,
      pageSize: 100,
      sortField: "backlinks",
      sortOrder: "desc",
      hideSpam: b.hideSpam,
      spamThreshold: b.spamThreshold,
    });
  }
  const scopeNote =
    overview.scope === "domain"
      ? "Summary excludes subdomains; trend data includes subdomains (provider limitation)."
      : overview.scope === "subfolder"
        ? "Subfolder scope: totals only — no rank, trends or referring-domain breakdown."
        : undefined;
  return {
    target: overview.target,
    displayTarget: overview.displayTarget,
    scope: overview.scope,
    ...(scopeNote ? { scopeNote } : {}),
    summary: overview.summary,
    trends: overview.trends,
    newLostTrends: overview.newLostTrends,
    cached: overview.cached,
    fetchedAt: overview.fetchedAt,
    referringDomains: referringDomains ? { rows: referringDomains.rows, totalCount: referringDomains.totalCount, hasMore: referringDomains.hasMore } : null,
    url: projectLink(ctx.projectId, "/seo/backlinks", { target: overview.displayTarget }),
  };
}

const pageFields = {
  page: z.number().int().positive().max(1000).default(1),
  pageSize: z.union([z.literal(50), z.literal(100), z.literal(200)]).default(100),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
};
const optNum = z.number().finite().optional();

export const backlinksProfileBody = z.object({
  target: targetField,
  scope: backlinksScope,
  ...pageFields,
  sortField: z.enum(Object.keys(BACKLINKS_ROWS_SORT_FIELDS) as [keyof typeof BACKLINKS_ROWS_SORT_FIELDS, ...(keyof typeof BACKLINKS_ROWS_SORT_FIELDS)[]]).default("firstSeen"),
  mode: z.enum(["one_per_domain", "as_is"]).default("one_per_domain").describe("one_per_domain = best link per referring domain; as_is = every link."),
  filters: z
    .object({
      include: z.string().max(500).optional().describe("Comma-separated terms the source URL must contain."),
      exclude: z.string().max(500).optional().describe("Comma-separated terms to exclude."),
      minDomainRank: optNum,
      maxDomainRank: optNum,
      minLinkAuthority: optNum,
      maxLinkAuthority: optNum,
      minSpamScore: optNum,
      maxSpamScore: optNum,
      linkType: z.enum(["dofollow", "nofollow"]).optional(),
      hideLost: z.boolean().optional(),
      hideBroken: z.boolean().optional(),
      domainFrom: z.string().max(253).optional().describe("Only links from this referring domain."),
    })
    .default({}),
  ...spamFields,
});

export async function backlinksProfileForApi(ctx: SeoContext, body: z.input<typeof backlinksProfileBody>) {
  const b = backlinksProfileBody.parse(body);
  const target = b.target ?? ctx.project.domain;
  const res = await getBacklinksRows(ctx, { ...b, target });
  return {
    target,
    scope: b.scope ?? null,
    backlinks: { rows: res.rows, totalCount: res.totalCount, hasMore: res.hasMore, page: res.page, pageSize: res.pageSize, fetchedAt: res.fetchedAt },
    cached: res.cached,
    url: projectLink(ctx.projectId, "/seo/backlinks", { target }),
  };
}

export const referringDomainsBody = z.object({
  target: targetField,
  scope: backlinksScope,
  ...pageFields,
  sortField: z
    .enum(Object.keys(REFERRING_DOMAINS_SORT_FIELDS) as [keyof typeof REFERRING_DOMAINS_SORT_FIELDS, ...(keyof typeof REFERRING_DOMAINS_SORT_FIELDS)[]])
    .default("backlinks"),
  filters: z
    .object({
      include: z.string().max(500).optional(),
      exclude: z.string().max(500).optional(),
      minBacklinks: optNum,
      maxBacklinks: optNum,
      minRank: optNum,
      maxRank: optNum,
      minSpamScore: optNum,
      maxSpamScore: optNum,
    })
    .default({}),
  ...spamFields,
});

export async function referringDomainsForApi(ctx: SeoContext, body: z.input<typeof referringDomainsBody>) {
  const b = referringDomainsBody.parse(body);
  const target = b.target ?? ctx.project.domain;
  const res = await getReferringDomains(ctx, { ...b, target });
  return {
    target,
    referringDomains: { rows: res.rows, totalCount: res.totalCount, hasMore: res.hasMore, page: res.page, pageSize: res.pageSize, fetchedAt: res.fetchedAt },
    cached: res.cached,
    url: projectLink(ctx.projectId, "/seo/backlinks", { target }),
  };
}

export const backlinksTopPagesBody = z.object({
  target: targetField,
  scope: backlinksScope,
  ...pageFields,
  sortField: z.enum(Object.keys(TOP_PAGES_SORT_FIELDS) as [keyof typeof TOP_PAGES_SORT_FIELDS, ...(keyof typeof TOP_PAGES_SORT_FIELDS)[]]).default("backlinks"),
  filters: z
    .object({
      include: z.string().max(500).optional(),
      exclude: z.string().max(500).optional(),
      minBacklinks: optNum,
      maxBacklinks: optNum,
      minReferringDomains: optNum,
      maxReferringDomains: optNum,
      minRank: optNum,
      maxRank: optNum,
    })
    .default({}),
});

export async function backlinksTopPagesForApi(ctx: SeoContext, body: z.input<typeof backlinksTopPagesBody>) {
  const b = backlinksTopPagesBody.parse(body);
  const target = b.target ?? ctx.project.domain;
  const res = await getBacklinksTopPages(ctx, { ...b, target });
  return {
    target,
    pages: { rows: res.rows, totalCount: res.totalCount, hasMore: res.hasMore, page: res.page, pageSize: res.pageSize, fetchedAt: res.fetchedAt },
    cached: res.cached,
    url: projectLink(ctx.projectId, "/seo/backlinks", { target }),
  };
}

/* ───────────────────────────── REST helpers ───────────────────────────── */

/** Authorizes the project for the credential and builds the SEO context (REST routes). */
export async function restSeoContext(principal: ApiPrincipal, projectId: string): Promise<SeoContext> {
  return apiSeoContext(principal, await getApiProject(principal, projectId));
}
