import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { seoKeywordMetrics } from "@/server/db/schema";
import { assertCanRun, SeoError, type SeoContext } from "./context";
import { dfsLive, type SeoFeature } from "./dfs";
import { buildCacheKey, cacheGet, cacheSet, CACHE_TTL } from "./cache";
import {
  AUTO_KEYWORD_SOURCES,
  buildAdsIdeasRequest,
  buildAdsSearchVolumeRequest,
  buildKeywordOverviewRequest,
  buildResearchSourceRequest,
  countNonSeedKeywords,
  KEYWORD_METRICS_BATCH_SIZE,
  mapAdsKeywordItems,
  mapKeywordDataItems,
  mapRelatedKeywordItems,
  mergeLocalAndNationalRows,
  MIN_NON_SEED_FOR_AUTO,
  normalizeAdsKeyword,
  normalizeIntent,
  normalizeKeyword,
  normalizeKeywordOverview,
  nullMetricRow,
  type AdsKeywordItem,
  type KeywordMetricRow,
  type KeywordMode,
  type KeywordResearchRow,
  type KeywordSource,
  type LabsKeywordDataItem,
  type RelatedKeywordItem,
  type ResearchResult,
  type ResultLimit,
} from "./lib/keywords";
import { getKeywordDataProvider, isSupportedLanguageCode, resolveMarket } from "./lib/locations";
import { buildSerpAnalysisTask, mapOrganicSerpItems, SERP_ANALYSIS_DEPTH, SERP_LIVE_PATH, type SerpAnalysisResult, type SerpLiveItem } from "./lib/serp";
import { estimateLabsCall, estimateSerpAnalysis } from "./lib/costs";

/* ───────────────────────────── Keyword research ───────────────────────────── */

export const researchKeywordsInput = z.object({
  keywords: z.array(z.string().trim().min(1).max(200)).min(1).max(200),
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().min(2).max(8).optional(),
  resultLimit: z.union([z.literal(150), z.literal(300), z.literal(500)]).default(150),
  mode: z.enum(["auto", "related", "suggestions", "ideas"]).default("auto"),
  clickstream: z.boolean().default(false),
});
export type ResearchKeywordsInput = z.input<typeof researchKeywordsInput>;

/** v3 like open-seo: Google-Ads-only locations route to keywords_for_keywords. */
const CACHE_VERSION = 3;

export type ResearchKeywordsOutput = ResearchResult & {
  seed: string;
  locationCode: number;
  languageCode: string;
  provider: "labs" | "google_ads";
  cached: boolean;
  fetchedAt: string;
};

/**
 * Labs related → suggestions → ideas (auto: stop once ≥5 non-seed rows), Google Ads keywords_for_keywords for
 * Ads-only countries. 24h DB cache; every row is upserted into `seo_keyword_metrics`.
 */
export async function researchKeywords(ctx: SeoContext, rawInput: ResearchKeywordsInput): Promise<ResearchKeywordsOutput> {
  const input = researchKeywordsInput.parse(rawInput);
  const unique = [...new Set(input.keywords.map(normalizeKeyword))].filter(Boolean);
  if (unique.length === 0) throw new SeoError("VALIDATION_ERROR", "Please enter at least one keyword.");
  const seed = unique[0]!;
  const market = resolveMarket(input, ctx.market);
  if (!isSupportedLanguageCode(market.languageCode)) throw new SeoError("VALIDATION_ERROR", `Unsupported language '${market.languageCode}'.`);
  const provider = getKeywordDataProvider(market.locationCode);
  // Labs modes & clickstream don't exist for Google-Ads countries — collapse so requests share a cache entry.
  const mode: KeywordMode = provider === "google_ads" ? "auto" : input.mode;
  const clickstream = provider === "google_ads" ? false : input.clickstream;
  const resultLimit = input.resultLimit as ResultLimit;

  const cacheKey = buildCacheKey("kw:research", {
    cacheVersion: CACHE_VERSION,
    projectId: ctx.projectId,
    keywords: unique,
    locationCode: market.locationCode,
    languageCode: market.languageCode,
    resultLimit,
    mode,
    depth: 3,
    clickstream,
  });
  const cached = await cacheGet<ResearchResult & { fetchedAt?: string }>(cacheKey);
  if (cached && cached.value.rows.length > 0) {
    return {
      ...cached.value,
      seed,
      ...market,
      provider,
      cached: true,
      fetchedAt: cached.value.fetchedAt ?? cached.createdAt.toISOString(),
    };
  }
  assertCanRun(ctx);

  const common = { locationCode: market.locationCode, languageCode: market.languageCode, limit: resultLimit, includeClickstreamData: clickstream };
  let result: ResearchResult;
  if (provider === "google_ads") {
    const req = buildAdsIdeasRequest({ keyword: seed, ...market });
    const task = await dfsLive<AdsKeywordItem>(ctx, req.path, req.task, { feature: "keyword_research", estimatedCostUsd: 0.075 });
    const rows = mapAdsKeywordItems(task.result).slice(0, resultLimit);
    result = {
      rows,
      source: "google_ads",
      usedFallback: false,
      diagnostics: {
        requestedMode: "auto",
        threshold: MIN_NON_SEED_FOR_AUTO,
        sourceAttempts: [{ source: "google_ads", rowCount: rows.length, nonSeedCount: countNonSeedKeywords(rows, seed) }],
      },
    };
  } else if (mode === "auto") {
    const attempts: ResearchResult["diagnostics"]["sourceAttempts"] = [];
    const accumulated: KeywordResearchRow[] = [];
    const seen = new Set<string>();
    let last: KeywordSource = "related";
    let done: ResearchResult | null = null;
    for (const source of AUTO_KEYWORD_SOURCES) {
      const rows = await fetchSourceRows(ctx, source, seed, common);
      for (const row of rows) {
        if (accumulated.length >= resultLimit) break;
        if (seen.has(row.keyword)) continue;
        seen.add(row.keyword);
        accumulated.push(row);
      }
      attempts.push({ source, rowCount: rows.length, nonSeedCount: countNonSeedKeywords(rows, seed) });
      last = source;
      if (countNonSeedKeywords(accumulated, seed) >= MIN_NON_SEED_FOR_AUTO) {
        done = {
          rows: accumulated,
          source,
          usedFallback: source !== AUTO_KEYWORD_SOURCES[0],
          diagnostics: { requestedMode: "auto", threshold: MIN_NON_SEED_FOR_AUTO, sourceAttempts: attempts },
        };
        break;
      }
    }
    result = done ?? {
      rows: accumulated,
      source: last,
      usedFallback: true,
      diagnostics: { requestedMode: "auto", threshold: MIN_NON_SEED_FOR_AUTO, sourceAttempts: attempts },
    };
  } else {
    const rows = await fetchSourceRows(ctx, mode, seed, common);
    result = {
      rows,
      source: mode,
      usedFallback: false,
      diagnostics: {
        requestedMode: mode,
        threshold: MIN_NON_SEED_FOR_AUTO,
        sourceAttempts: [{ source: mode, rowCount: rows.length, nonSeedCount: countNonSeedKeywords(rows, seed) }],
      },
    };
  }

  const fetchedAt = new Date().toISOString();
  await cacheSet(cacheKey, "kw:research", ctx.projectId, { ...result, fetchedAt }, CACHE_TTL.keywordResearch);
  void upsertKeywordMetrics(
    ctx.projectId,
    market.locationCode,
    market.languageCode,
    result.rows.map((r) => ({
      keyword: r.keyword,
      searchVolume: r.searchVolume,
      cpc: r.cpc,
      competition: r.competition,
      keywordDifficulty: r.keywordDifficulty,
      intent: r.intent,
      monthlySearches: r.trend,
    })),
  ).catch((err) => console.error("[seo] keyword metrics persist failed", err));
  return { ...result, seed, ...market, provider, cached: false, fetchedAt };
}

async function fetchSourceRows(
  ctx: SeoContext,
  source: KeywordSource,
  seed: string,
  common: { locationCode: number; languageCode: string; limit: number; includeClickstreamData: boolean },
): Promise<KeywordResearchRow[]> {
  const req = buildResearchSourceRequest(source, { keyword: seed, ...common });
  const estimatedCostUsd = estimateLabsCall(common.limit, common.includeClickstreamData);
  if (source === "related") {
    const task = await dfsLive<{ items?: RelatedKeywordItem[] | null }>(ctx, req.path, req.task, { feature: "keyword_research", estimatedCostUsd });
    return mapRelatedKeywordItems(task.result[0]?.items ?? []);
  }
  const task = await dfsLive<{ items?: LabsKeywordDataItem[] | null }>(ctx, req.path, req.task, { feature: "keyword_research", estimatedCostUsd });
  return mapKeywordDataItems(task.result[0]?.items ?? []);
}

/* ───────────────────────────── SERP analysis ───────────────────────────── */

export const serpAnalysisInput = z.object({
  keyword: z.string().trim().min(1).max(200),
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().min(2).max(8).optional(),
  depth: z.union([z.literal(20), z.literal(100)]).default(20),
});

/**
 * Organic SERP (desktop/windows). 12h cache keyed without depth: a deeper snapshot answers shallower requests;
 * an empty re-crawl never overwrites a non-empty snapshot.
 */
export async function getSerpAnalysis(ctx: SeoContext, raw: z.input<typeof serpAnalysisInput>): Promise<SerpAnalysisResult & { cached: boolean }> {
  const input = serpAnalysisInput.parse(raw);
  const market = resolveMarket(input, ctx.market);
  const keyword = normalizeKeyword(input.keyword);
  const depth = input.depth;
  const key = buildCacheKey("serp:analysis", { projectId: ctx.projectId, keyword, ...market });
  const cached = await cacheGet<SerpAnalysisResult>(key);
  const cachedDepth = cached?.value.depth ?? SERP_ANALYSIS_DEPTH;
  if (cached && cachedDepth >= depth) return { ...cached.value, depth: cachedDepth, cached: true };
  assertCanRun(ctx);

  const task = await dfsLive<{ items?: SerpLiveItem[] | null }>(
    ctx,
    SERP_LIVE_PATH,
    buildSerpAnalysisTask({ keyword, ...market, depth }),
    { feature: "keyword_research", treatNoResultsAsEmpty: true, estimatedCostUsd: estimateSerpAnalysis(depth) },
  );
  const items = mapOrganicSerpItems(task.result[0]?.items ?? []);
  const result: SerpAnalysisResult = { requestedKeyword: keyword, items, depth, fetchedAt: new Date().toISOString() };
  if (items.length === 0) result.reason = "no_organic_results";
  if (items.length === 0 && cached && cached.value.items.length > 0) return { ...result, cached: false };
  await cacheSet(key, "serp:analysis", ctx.projectId, result, CACHE_TTL.serpAnalysis);
  return { ...result, cached: false };
}

/* ───────────────────────────── Keyword metrics (batches of 700) ───────────────────────────── */

/**
 * Labs `keyword_overview` for Labs countries, Google Ads `search_volume` for Ads-only countries; local (city)
 * requests merge local Ads volume/CPC with national Labs KD/intent. Batches ≤700 keywords.
 */
export async function fetchKeywordMetricsForList(
  ctx: SeoContext,
  params: {
    keywords: string[];
    locationCode: number;
    languageCode: string;
    feature: SeoFeature;
    includeClickstreamData?: boolean;
    locationName?: string;
  },
): Promise<KeywordMetricRow[]> {
  assertCanRun(ctx);
  const useAds = getKeywordDataProvider(params.locationCode) === "google_ads";
  const rows: KeywordMetricRow[] = [];
  for (let i = 0; i < params.keywords.length; i += KEYWORD_METRICS_BATCH_SIZE) {
    const batch = params.keywords.slice(i, i + KEYWORD_METRICS_BATCH_SIZE);
    const ads = () => {
      const req = buildAdsSearchVolumeRequest({ keywords: batch, locationCode: params.locationCode, languageCode: params.languageCode, locationName: params.locationName });
      return dfsLive<AdsKeywordItem>(ctx, req.path, req.task, { feature: params.feature, estimatedCostUsd: 0.075 }).then((t) => t.result);
    };
    const labs = () => {
      const req = buildKeywordOverviewRequest({
        keywords: batch,
        locationCode: params.locationCode,
        languageCode: params.languageCode,
        includeClickstreamData: params.includeClickstreamData ?? false,
      });
      return dfsLive<{ items?: LabsKeywordDataItem[] | null }>(ctx, req.path, req.task, {
        feature: params.feature,
        estimatedCostUsd: estimateLabsCall(batch.length, params.includeClickstreamData),
      }).then((t) => t.result[0]?.items ?? []);
    };
    if (useAds) {
      const items = await ads();
      const covered = new Set<string>();
      for (const item of items) {
        if (!item?.keyword) continue;
        covered.add(item.keyword.toLowerCase());
        rows.push(normalizeAdsKeyword(item, item.keyword));
      }
      if (params.locationName) rows.push(...batch.filter((k) => !covered.has(k.toLowerCase())).map(nullMetricRow));
    } else if (params.locationName) {
      const [adsItems, labsItems] = await Promise.all([ads(), labs()]);
      rows.push(...mergeLocalAndNationalRows(batch, adsItems.filter(Boolean), labsItems.filter(Boolean) as LabsKeywordDataItem[]));
    } else {
      for (const item of await labs()) {
        if (!item?.keyword) continue;
        rows.push(normalizeKeywordOverview(item, item.keyword));
      }
    }
  }
  return rows;
}

export type KeywordMetricUpsert = {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  keywordDifficulty: number | null;
  intent: string | null;
  monthlySearches: { year: number; month: number; searchVolume: number }[];
};

/** Upsert into seo_keyword_metrics (project/keyword/location/language unique), chunks of 100. */
export async function upsertKeywordMetrics(projectId: string, locationCode: number, languageCode: string, rows: KeywordMetricUpsert[]) {
  const seen = new Set<string>();
  const values = rows
    .map((r) => ({ ...r, keyword: normalizeKeyword(r.keyword) }))
    .filter((r) => r.keyword && !seen.has(r.keyword) && seen.add(r.keyword))
    .map((r) => ({
      projectId,
      keyword: r.keyword,
      locationCode,
      languageCode,
      searchVolume: r.searchVolume != null ? Math.round(r.searchVolume) : null,
      cpc: r.cpc,
      competition: r.competition,
      keywordDifficulty: r.keywordDifficulty != null ? Math.round(r.keywordDifficulty) : null,
      intent: r.intent ? normalizeIntent(r.intent) : null,
      monthlySearches: r.monthlySearches,
      fetchedAt: new Date(),
    }));
  for (let i = 0; i < values.length; i += 100) {
    const chunk = values.slice(i, i + 100);
    await db
      .insert(seoKeywordMetrics)
      .values(chunk)
      .onConflictDoUpdate({
        target: [seoKeywordMetrics.projectId, seoKeywordMetrics.keyword, seoKeywordMetrics.locationCode, seoKeywordMetrics.languageCode],
        set: {
          searchVolume: sql`excluded.search_volume`,
          cpc: sql`excluded.cpc`,
          competition: sql`excluded.competition`,
          keywordDifficulty: sql`excluded.keyword_difficulty`,
          intent: sql`excluded.intent`,
          monthlySearches: sql`excluded.monthly_searches`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }
}
