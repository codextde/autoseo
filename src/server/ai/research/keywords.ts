import "server-only";
import { dfsPost, isDataForSeoConfigured } from "@/server/dataforseo/client";
import { getCountry } from "@/lib/countries";
import type { SearchIntent } from "@/features/ai-research/types";

export type KeywordMetric = {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  difficulty: number | null;
  intent: SearchIntent | null;
  /** Oldest first, "YYYY-MM". */
  monthly: { month: string; volume: number }[];
};

type DfsCtx = { projectId: string; workspaceId?: string | null; userId?: string | null; feature: string };

export function normalizeKeyword(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeIntent(raw: unknown): SearchIntent | null {
  if (typeof raw !== "string") return null;
  const r = raw.toLowerCase();
  if (r.includes("inform")) return "informational";
  if (r.includes("commerc")) return "commercial";
  if (r.includes("transact")) return "transactional";
  if (r.includes("navig")) return "navigational";
  return null;
}

function market(country: string, language: string) {
  const c = getCountry(country);
  const languageCode = c?.languages.includes(language) ? language : (c?.language ?? language);
  return { locationCode: c?.locationCode ?? 2840, languageCode, adsOnly: c?.googleAdsOnly ?? false };
}

type LabsKeywordItem = {
  keyword?: string;
  keyword_info?: {
    search_volume?: number | null;
    cpc?: number | null;
    monthly_searches?: { year: number; month: number; search_volume: number | null }[] | null;
  } | null;
  keyword_properties?: { keyword_difficulty?: number | null } | null;
  search_intent_info?: { main_intent?: string | null } | null;
};

function monthly(list: { year: number; month: number; search_volume: number | null }[] | null | undefined) {
  return (list ?? [])
    .filter((m) => m && m.year && m.month)
    .map((m) => ({ month: `${m.year}-${String(m.month).padStart(2, "0")}`, volume: m.search_volume ?? 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function fromLabs(item: LabsKeywordItem): KeywordMetric | null {
  if (!item.keyword) return null;
  return {
    keyword: normalizeKeyword(item.keyword),
    volume: item.keyword_info?.search_volume ?? null,
    cpc: item.keyword_info?.cpc ?? null,
    difficulty: item.keyword_properties?.keyword_difficulty ?? null,
    intent: normalizeIntent(item.search_intent_info?.main_intent),
    monthly: monthly(item.keyword_info?.monthly_searches),
  };
}

type AdsItem = {
  keyword?: string;
  search_volume?: number | null;
  cpc?: number | null;
  monthly_searches?: { year: number; month: number; search_volume: number | null }[] | null;
};

function fromAds(item: AdsItem): KeywordMetric | null {
  if (!item.keyword) return null;
  return {
    keyword: normalizeKeyword(item.keyword),
    volume: item.search_volume ?? null,
    cpc: item.cpc ?? null,
    difficulty: null,
    intent: null,
    monthly: monthly(item.monthly_searches),
  };
}

/** Monthly search volumes for exact keywords (Labs keyword_overview; Google Ads for Ads-only markets). */
export async function fetchKeywordVolumes(keywords: string[], country: string, language: string, ctx: DfsCtx): Promise<Map<string, KeywordMetric>> {
  const out = new Map<string, KeywordMetric>();
  const unique = [...new Set(keywords.map(normalizeKeyword).filter((k) => k && k.length <= 80 && k.split(" ").length <= 10))];
  if (!unique.length || !(await isDataForSeoConfigured())) return out;
  const m = market(country, language);
  const batchSize = m.adsOnly ? 1000 : 700;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    if (m.adsOnly) {
      const task = await dfsPost<AdsItem>(
        "/v3/keywords_data/google_ads/search_volume/live",
        [{ keywords: batch, location_code: m.locationCode, language_code: m.languageCode }],
        ctx,
        { estimatedCostUsd: 0.09 },
      );
      for (const item of task.result ?? []) {
        const k = fromAds(item);
        if (k) out.set(k.keyword, k);
      }
    } else {
      const task = await dfsPost<{ items?: LabsKeywordItem[] | null }>(
        "/v3/dataforseo_labs/google/keyword_overview/live",
        [{ keywords: batch, location_code: m.locationCode, language_code: m.languageCode, include_clickstream_data: false }],
        ctx,
        { estimatedCostUsd: 0.012 + batch.length * 0.00012 },
      );
      for (const item of task.result?.[0]?.items ?? []) {
        const k = fromLabs(item);
        if (k) out.set(k.keyword, k);
      }
    }
  }
  return out;
}

/** Keyword ideas around seed terms (Labs keyword_ideas; Google Ads keywords_for_keywords for Ads-only markets). */
export async function fetchKeywordIdeas(seeds: string[], country: string, language: string, limit: number, ctx: DfsCtx): Promise<KeywordMetric[]> {
  const unique = [...new Set(seeds.map(normalizeKeyword).filter(Boolean))].slice(0, 20);
  if (!unique.length) return [];
  const m = market(country, language);
  const rows: KeywordMetric[] = [];
  if (m.adsOnly) {
    const task = await dfsPost<AdsItem>(
      "/v3/keywords_data/google_ads/keywords_for_keywords/live",
      [{ keywords: unique, location_code: m.locationCode, language_code: m.languageCode, sort_by: "search_volume" }],
      ctx,
      { estimatedCostUsd: 0.09 },
    );
    for (const item of task.result ?? []) {
      const k = fromAds(item);
      if (k) rows.push(k);
    }
    return rows.slice(0, limit);
  }
  const task = await dfsPost<{ items?: LabsKeywordItem[] | null }>(
    "/v3/dataforseo_labs/google/keyword_ideas/live",
    [
      {
        keywords: unique,
        location_code: m.locationCode,
        language_code: m.languageCode,
        limit: Math.min(1000, limit),
        include_serp_info: false,
        include_clickstream_data: false,
        closely_variants: false,
        ignore_synonyms: false,
        order_by: ["keyword_info.search_volume,desc"],
      },
    ],
    ctx,
    { estimatedCostUsd: 0.012 + limit * 0.00012 },
  );
  for (const item of task.result?.[0]?.items ?? []) {
    const k = fromLabs(item);
    if (k) rows.push(k);
  }
  return rows;
}

/** Keyword suggestions containing a seed (e.g. brand + modifier queries). */
export async function fetchKeywordSuggestions(seed: string, country: string, language: string, limit: number, ctx: DfsCtx): Promise<KeywordMetric[]> {
  const m = market(country, language);
  if (m.adsOnly) return [];
  const task = await dfsPost<{ items?: LabsKeywordItem[] | null }>(
    "/v3/dataforseo_labs/google/keyword_suggestions/live",
    [
      {
        keyword: normalizeKeyword(seed),
        location_code: m.locationCode,
        language_code: m.languageCode,
        limit: Math.min(1000, limit),
        include_seed_keyword: true,
        include_serp_info: false,
        include_clickstream_data: false,
        order_by: ["keyword_info.search_volume,desc"],
      },
    ],
    ctx,
    { estimatedCostUsd: 0.012 + limit * 0.00012 },
  );
  const rows: KeywordMetric[] = [];
  for (const item of task.result?.[0]?.items ?? []) {
    const k = fromLabs(item);
    if (k) rows.push(k);
  }
  return rows;
}

/** 0..1 bar score from absolute volumes (log scale relative to the max in the set). */
export function volumeScores(volumes: (number | null)[]): (number | null)[] {
  const max = Math.max(0, ...volumes.map((v) => v ?? 0));
  if (max <= 0) return volumes.map((v) => (v == null ? null : 0));
  const lmax = Math.log10(max + 1);
  return volumes.map((v) => (v == null ? null : Math.max(0.05, Math.log10(v + 1) / lmax)));
}
