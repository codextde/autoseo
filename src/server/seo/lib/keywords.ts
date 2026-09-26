/**
 * Keyword research / keyword metrics: DataForSEO payload builders and response mappers.
 * Port of open-seo `features/keywords/services/research/*` + `lib/dataforseo/{labs,google-ads,keyword-metrics}.ts`. Pure.
 */

export type KeywordIntent = "informational" | "commercial" | "transactional" | "navigational" | "unknown";
export const KEYWORD_INTENTS: KeywordIntent[] = ["informational", "commercial", "transactional", "navigational", "unknown"];

export type MonthlySearch = { year: number; month: number; searchVolume: number };

export type KeywordResearchRow = {
  keyword: string;
  searchVolume: number | null;
  trend: MonthlySearch[];
  cpc: number | null;
  /** 0-1 paid competition. */
  competition: number | null;
  keywordDifficulty: number | null;
  intent: KeywordIntent;
};

export type KeywordMode = "auto" | "related" | "suggestions" | "ideas";
export type KeywordSource = "related" | "suggestions" | "ideas";
export type ResearchSource = KeywordSource | "google_ads";
export const AUTO_KEYWORD_SOURCES: KeywordSource[] = ["related", "suggestions", "ideas"];
export const MIN_NON_SEED_FOR_AUTO = 5;
export const RESULT_LIMITS = [150, 300, 500] as const;
export type ResultLimit = (typeof RESULT_LIMITS)[number];
export const MAX_KEYWORDS_PER_SUBMIT = 5;
/** DataForSEO batch metric endpoints accept up to ~700 keywords per request. */
export const KEYWORD_METRICS_BATCH_SIZE = 700;

export type ResearchResult = {
  rows: KeywordResearchRow[];
  source: ResearchSource;
  usedFallback: boolean;
  diagnostics: {
    requestedMode: KeywordMode;
    threshold: number;
    sourceAttempts: { source: ResearchSource; rowCount: number; nonSeedCount: number }[];
  };
};

/* ───────────────────────────── Raw DataForSEO item shapes ───────────────────────────── */

export type LabsMonthlySearch = { year?: number | null; month?: number | null; search_volume?: number | null };
export type LabsKeywordInfo = {
  search_volume?: number | null;
  cpc?: number | null;
  competition?: number | null;
  competition_level?: string | null;
  monthly_searches?: LabsMonthlySearch[] | null;
  keyword_difficulty?: number | null;
};
export type LabsKeywordDataItem = {
  keyword?: string | null;
  keyword_info?: LabsKeywordInfo | null;
  keyword_info_normalized_with_clickstream?: LabsKeywordInfo | null;
  keyword_properties?: { keyword_difficulty?: number | null } | null;
  search_intent_info?: { main_intent?: string | null } | null;
};
export type RelatedKeywordItem = { keyword_data?: LabsKeywordDataItem | null };
export type AdsKeywordItem = {
  keyword?: string | null;
  search_volume?: number | null;
  cpc?: number | null;
  /** "LOW" | "MEDIUM" | "HIGH" */
  competition?: string | null;
  /** 0-100 */
  competition_index?: number | null;
  monthly_searches?: LabsMonthlySearch[] | null;
};

/* ───────────────────────────── Helpers ───────────────────────────── */

export function normalizeKeyword(input: string): string {
  return input.trim().toLowerCase();
}

export function normalizeIntent(raw: string | null | undefined): KeywordIntent {
  if (!raw) return "unknown";
  const v = raw.toLowerCase();
  if (v.includes("inform")) return "informational";
  if (v.includes("commerc")) return "commercial";
  if (v.includes("transact")) return "transactional";
  if (v.includes("navig")) return "navigational";
  return "unknown";
}

/** Keyword input textarea: split on newline or comma, trim, drop empties. */
export function parseKeywordInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export function countNonSeedKeywords(rows: { keyword: string }[], seed: string): number {
  const s = seed.trim().toLowerCase();
  return rows.filter((r) => r.keyword !== s).length;
}

function toMonthly(entries: LabsMonthlySearch[] | null | undefined): MonthlySearch[] {
  return (entries ?? []).map((e) => ({ year: e.year ?? 0, month: e.month ?? 0, searchVolume: e.search_volume ?? 0 }));
}

/* ───────────────────────────── Payload builders ───────────────────────────── */

export const LABS_RELATED_PATH = "/v3/dataforseo_labs/google/related_keywords/live";
export const LABS_SUGGESTIONS_PATH = "/v3/dataforseo_labs/google/keyword_suggestions/live";
export const LABS_IDEAS_PATH = "/v3/dataforseo_labs/google/keyword_ideas/live";
export const LABS_OVERVIEW_PATH = "/v3/dataforseo_labs/google/keyword_overview/live";
export const ADS_KEYWORDS_FOR_KEYWORDS_PATH = "/v3/keywords_data/google_ads/keywords_for_keywords/live";
export const ADS_SEARCH_VOLUME_PATH = "/v3/keywords_data/google_ads/search_volume/live";

type SourceInput = { keyword: string; locationCode: number; languageCode: string; limit: number; includeClickstreamData?: boolean };

export function buildResearchSourceRequest(source: KeywordSource, input: SourceInput): { path: string; task: Record<string, unknown> } {
  const clickstream = input.includeClickstreamData ?? false;
  if (source === "related") {
    return {
      path: LABS_RELATED_PATH,
      task: {
        keyword: input.keyword,
        location_code: input.locationCode,
        language_code: input.languageCode,
        limit: input.limit,
        depth: 3,
        include_clickstream_data: clickstream,
        include_serp_info: false,
      },
    };
  }
  if (source === "suggestions") {
    return {
      path: LABS_SUGGESTIONS_PATH,
      task: {
        keyword: input.keyword,
        location_code: input.locationCode,
        language_code: input.languageCode,
        limit: input.limit,
        include_clickstream_data: clickstream,
        include_serp_info: false,
        include_seed_keyword: true,
        ignore_synonyms: false,
        exact_match: false,
      },
    };
  }
  return {
    path: LABS_IDEAS_PATH,
    task: {
      keywords: [input.keyword],
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: input.limit,
      include_clickstream_data: clickstream,
      include_serp_info: false,
      ignore_synonyms: false,
      closely_variants: false,
    },
  };
}

/** Google Ads keywords_for_keywords (no limit param → caller truncates to resultLimit). */
export function buildAdsIdeasRequest(input: { keyword: string; locationCode: number; languageCode: string }) {
  return {
    path: ADS_KEYWORDS_FOR_KEYWORDS_PATH,
    task: { keywords: [input.keyword], location_code: input.locationCode, language_code: input.languageCode, sort_by: "search_volume" },
  };
}

export function buildKeywordOverviewRequest(input: {
  keywords: string[];
  locationCode: number;
  languageCode: string;
  includeClickstreamData?: boolean;
}) {
  return {
    path: LABS_OVERVIEW_PATH,
    task: {
      keywords: input.keywords,
      location_code: input.locationCode,
      language_code: input.languageCode,
      include_clickstream_data: input.includeClickstreamData ?? false,
    },
  };
}

export function buildAdsSearchVolumeRequest(input: { keywords: string[]; locationCode: number; languageCode: string; locationName?: string }) {
  return {
    path: ADS_SEARCH_VOLUME_PATH,
    task: {
      keywords: input.keywords,
      ...(input.locationName ? { location_name: input.locationName } : { location_code: input.locationCode }),
      language_code: input.languageCode,
    },
  };
}

/* ───────────────────────────── Response mappers ───────────────────────────── */

/** Labs keyword_data items (suggestions / ideas / unwrapped related). Dedupe by normalized keyword. */
export function mapKeywordDataItems(items: (LabsKeywordDataItem | null | undefined)[]): KeywordResearchRow[] {
  const rows: KeywordResearchRow[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item?.keyword) continue;
    const keyword = normalizeKeyword(item.keyword);
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    // The clickstream-normalized block only exists when opted in (doubles cost); prefer it when present.
    const info = item.keyword_info_normalized_with_clickstream?.search_volume
      ? item.keyword_info_normalized_with_clickstream
      : item.keyword_info;
    rows.push({
      keyword,
      searchVolume: info?.search_volume ?? null,
      trend: toMonthly(info?.monthly_searches),
      cpc: item.keyword_info?.cpc ?? null,
      competition: item.keyword_info?.competition ?? null,
      keywordDifficulty: item.keyword_properties?.keyword_difficulty ?? null,
      intent: normalizeIntent(item.search_intent_info?.main_intent),
    });
  }
  return rows;
}

/** related_keywords wraps the payload one level deeper. */
export function mapRelatedKeywordItems(items: (RelatedKeywordItem | null | undefined)[]): KeywordResearchRow[] {
  return mapKeywordDataItems(items.map((i) => i?.keyword_data ?? null));
}

/** Google Ads rows: volume/CPC/competition_index(/100); no KD or intent. */
export function mapAdsKeywordItems(items: (AdsKeywordItem | null | undefined)[]): KeywordResearchRow[] {
  const rows: KeywordResearchRow[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item?.keyword) continue;
    const keyword = normalizeKeyword(item.keyword);
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    rows.push({
      keyword,
      searchVolume: item.search_volume ?? null,
      trend: toMonthly(item.monthly_searches),
      cpc: item.cpc ?? null,
      competition: item.competition_index != null ? item.competition_index / 100 : null,
      keywordDifficulty: null,
      intent: "unknown",
    });
  }
  return rows;
}

/* Keyword metrics (saved keywords refresh, rank tracking refresh). */

export type KeywordMetricRow = {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  competitionLevel: string | null;
  keywordDifficulty: number | null;
  /** Raw main_intent — run through normalizeIntent for the enum. */
  intent: string | null;
  monthlySearches: MonthlySearch[];
};

export function normalizeKeywordOverview(item: LabsKeywordDataItem, keyword: string): KeywordMetricRow {
  const info = item.keyword_info;
  const cs = item.keyword_info_normalized_with_clickstream;
  const usesClickstream = cs?.search_volume != null;
  return {
    keyword,
    searchVolume: cs?.search_volume ?? info?.search_volume ?? null,
    cpc: info?.cpc ?? null,
    competition: info?.competition ?? null,
    competitionLevel: info?.competition_level ?? null,
    keywordDifficulty: item.keyword_properties?.keyword_difficulty ?? null,
    intent: item.search_intent_info?.main_intent ?? null,
    monthlySearches: toMonthly(usesClickstream ? cs?.monthly_searches : info?.monthly_searches),
  };
}

export function normalizeAdsKeyword(item: AdsKeywordItem, keyword: string): KeywordMetricRow {
  return {
    keyword,
    searchVolume: item.search_volume ?? null,
    cpc: item.cpc ?? null,
    competition: item.competition_index != null ? item.competition_index / 100 : null,
    competitionLevel: item.competition ?? null,
    keywordDifficulty: null,
    intent: null,
    monthlySearches: toMonthly(item.monthly_searches),
  };
}

export function nullMetricRow(keyword: string): KeywordMetricRow {
  return {
    keyword,
    searchVolume: null,
    cpc: null,
    competition: null,
    competitionLevel: null,
    keywordDifficulty: null,
    intent: null,
    monthlySearches: [],
  };
}

/** Local (city) metrics: local volume/CPC from Google Ads + national KD/intent from Labs. Never national volume. */
export function mergeLocalAndNationalRows(keywords: string[], adsItems: AdsKeywordItem[], labsItems: LabsKeywordDataItem[]): KeywordMetricRow[] {
  const labsByKeyword = new Map(labsItems.filter((i) => i.keyword).map((i) => [i.keyword!.toLowerCase(), i]));
  const rows: KeywordMetricRow[] = [];
  const covered = new Set<string>();
  for (const item of adsItems) {
    if (!item.keyword) continue;
    covered.add(item.keyword.toLowerCase());
    const row = normalizeAdsKeyword(item, item.keyword);
    const labs = labsByKeyword.get(item.keyword.toLowerCase());
    row.keywordDifficulty = labs?.keyword_properties?.keyword_difficulty ?? null;
    row.intent = labs?.search_intent_info?.main_intent ?? null;
    rows.push(row);
  }
  for (const keyword of keywords) {
    if (covered.has(keyword.toLowerCase())) continue;
    const labs = labsByKeyword.get(keyword.toLowerCase());
    if (!labs) continue;
    rows.push({
      ...nullMetricRow(keyword),
      keywordDifficulty: labs.keyword_properties?.keyword_difficulty ?? null,
      intent: labs.search_intent_info?.main_intent ?? null,
    });
  }
  return rows;
}

/* ───────────────────────────── Client-side filtering (keyword research table) ───────────────────────────── */

export type KeywordFilterValues = {
  include: string;
  exclude: string;
  minVol: string;
  maxVol: string;
  minCpc: string;
  maxCpc: string;
  minKd: string;
  maxKd: string;
  /** Comma list in canonical intent order. */
  intents: string;
};

export const EMPTY_KEYWORD_FILTERS: KeywordFilterValues = {
  include: "",
  exclude: "",
  minVol: "",
  maxVol: "",
  minCpc: "",
  maxCpc: "",
  minKd: "",
  maxKd: "",
  intents: "",
};

export type KeywordSortField = "keyword" | "searchVolume" | "cpc" | "competition" | "keywordDifficulty";

export function activeKeywordFilterCount(f: KeywordFilterValues): number {
  return Object.values(f).filter((v) => v.trim() !== "").length;
}

function splitTerms(v: string) {
  return v
    .toLowerCase()
    .split(/[,+]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** open-seo applyKeywordFiltersAndSort: include = ALL terms must match; exclude = ANY drops; nulls count as 0. */
export function applyKeywordFiltersAndSort(
  rows: KeywordResearchRow[],
  f: KeywordFilterValues,
  sort: KeywordSortField,
  order: "asc" | "desc",
): KeywordResearchRow[] {
  const include = splitTerms(f.include);
  const exclude = splitTerms(f.exclude);
  const intents = new Set(f.intents.split(",").filter(Boolean));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const minVol = num(f.minVol);
  const maxVol = num(f.maxVol);
  const minCpc = num(f.minCpc);
  const maxCpc = num(f.maxCpc);
  const minKd = num(f.minKd);
  const maxKd = num(f.maxKd);
  const filtered = rows.filter((r) => {
    const kw = r.keyword.toLowerCase();
    if (include.length && !include.every((t) => kw.includes(t))) return false;
    if (exclude.some((t) => kw.includes(t))) return false;
    if (intents.size && !intents.has(r.intent)) return false;
    const vol = r.searchVolume ?? 0;
    const cpc = r.cpc ?? 0;
    const kd = r.keywordDifficulty ?? 0;
    if (minVol != null && Number.isFinite(minVol) && vol < minVol) return false;
    if (maxVol != null && Number.isFinite(maxVol) && vol > maxVol) return false;
    if (minCpc != null && Number.isFinite(minCpc) && cpc < minCpc) return false;
    if (maxCpc != null && Number.isFinite(maxCpc) && cpc > maxCpc) return false;
    if (minKd != null && Number.isFinite(minKd) && kd < minKd) return false;
    if (maxKd != null && Number.isFinite(maxKd) && kd > maxKd) return false;
    return true;
  });
  const dir = order === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    if (sort === "keyword") return a.keyword.localeCompare(b.keyword) * dir;
    const va = a[sort] ?? -1;
    const vb = b[sort] ?? -1;
    return (va - vb) * dir;
  });
}

/** Difficulty tier (1-6) used for badge colours; null → 0 ("n/a"). */
export function scoreTier(kd: number | null | undefined): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  if (kd == null) return 0;
  if (kd <= 20) return 1;
  if (kd <= 35) return 2;
  if (kd <= 50) return 3;
  if (kd <= 65) return 4;
  if (kd <= 80) return 5;
  return 6;
}
