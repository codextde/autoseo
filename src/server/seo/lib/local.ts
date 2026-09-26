/**
 * Local SEO (Google Business / Maps) payload builders, row projections and the geo rank-grid math.
 * Port of open-seo `mcp/tools/local-seo-{shared,tools}.ts` + `lib/dataforseo/business.ts`. Pure.
 */
import { SeoValidationError } from "./locations";

export const BUSINESS_LISTINGS_SEARCH_PATH = "/v3/business_data/business_listings/search/live";
export const BUSINESS_LISTINGS_CATEGORIES_PATH = "/v3/business_data/business_listings/categories";
export const MY_BUSINESS_INFO_PATH = "/v3/business_data/google/my_business_info/live";
export const QUESTIONS_ANSWERS_PATH = "/v3/business_data/google/questions_and_answers/live";
export const MAPS_SERP_PATH = "/v3/serp/google/maps/live/advanced";
export const LOCAL_FINDER_SERP_PATH = "/v3/serp/google/local_finder/live/advanced";

export type BusinessTaskEndpoint = "reviews" | "extended_reviews" | "my_business_updates";
export const businessTaskPostPath = (endpoint: BusinessTaskEndpoint) => `/v3/business_data/google/${endpoint}/task_post`;
export const businessTaskGetPath = (endpoint: BusinessTaskEndpoint, id: string) =>
  `/v3/business_data/google/${endpoint}/task_get/${encodeURIComponent(id)}`;

/** High priority: reviews usually settle in ~20s. */
export const TASK_PRIORITY_HIGH = 2;

const BUSINESS_DATA_MIN_RADIUS_M = 200;
const BUSINESS_DATA_MAX_RADIUS_M = 199_999;
const BUSINESS_DATA_DEFAULT_RADIUS_KM = 10;

export type Near = { latitude: number; longitude: number; radiusKm?: number };

export function formatCoordinate(value: number): string {
  return Number(value.toFixed(7)).toString();
}

/** business_data (Google) wants "lat,lng,radiusMeters" (200-199,999; default 10 km). */
export function formatBusinessDataCoordinate(near: Near): string {
  const radius = Math.min(
    BUSINESS_DATA_MAX_RADIUS_M,
    Math.max(BUSINESS_DATA_MIN_RADIUS_M, Math.round((near.radiusKm ?? BUSINESS_DATA_DEFAULT_RADIUS_KM) * 1000)),
  );
  return `${formatCoordinate(near.latitude)},${formatCoordinate(near.longitude)},${radius}`;
}

/** business_listings/search wants "lat,lng,radiusKm" in whole km (≥1). */
export function formatListingsCoordinate(near: Near): string {
  const km = Math.max(1, Math.round(near.radiusKm ?? BUSINESS_DATA_DEFAULT_RADIUS_KM));
  return `${formatCoordinate(near.latitude)},${formatCoordinate(near.longitude)},${km}`;
}

/** Maps SERP: "lat,lng" or "lat,lng,{zoom}z". */
export function formatLocalSerpCoordinate(near: { latitude: number; longitude: number; zoom?: number }): string {
  const c = `${formatCoordinate(near.latitude)},${formatCoordinate(near.longitude)}`;
  return near.zoom == null ? c : `${c},${near.zoom}z`;
}

export type BusinessIdentifier = { businessName?: string; cid?: string; placeId?: string };

/** Exactly one of businessName / cid / placeId. */
export function resolveBusinessIdentifier(args: BusinessIdentifier): { keyword?: string; cid?: string; placeId?: string } {
  const supplied = [args.businessName, args.cid, args.placeId].filter((v) => v != null && v !== "");
  if (supplied.length !== 1) throw new SeoValidationError("Provide exactly one business identifier: business name, CID, or place ID.");
  return { keyword: args.businessName || undefined, cid: args.cid || undefined, placeId: args.placeId || undefined };
}

/** my_business_info / my_business_updates only accept `keyword` → documented `cid:` / `place_id:` prefixes. */
export function businessIdentifierKeyword(id: { keyword?: string; cid?: string; placeId?: string }): string {
  if (id.cid != null) return `cid:${id.cid}`;
  if (id.placeId != null) return `place_id:${id.placeId}`;
  return id.keyword ?? "";
}

export type BusinessLocation = { locationCoordinate?: string; locationCode?: number; languageCode: string };

/** Coordinate wins when present (the endpoints accept one or the other, never both). */
export function businessLocationParams(input: BusinessLocation) {
  return input.locationCoordinate ? { location_coordinate: input.locationCoordinate } : { location_code: input.locationCode };
}

export function readPath(source: unknown, path: string): unknown {
  let cur: unknown = source;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Allowlist projection for provider rows (drop image blobs, xpaths …). */
export function pickRowFields(row: unknown, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = readPath(row, f);
    if (v !== undefined) out[f] = v;
  }
  return out;
}

/* ───────────────────────────── Business listings search ───────────────────────────── */

export type BusinessSearchInput = {
  query?: string;
  near: Near;
  categories?: string[];
  minRating?: number;
  minReviews?: number;
  isClaimed?: boolean;
  sortBy?: "relevance" | "rating" | "reviews";
  limit?: number;
  offset?: number;
};

export function buildBusinessSearchTask(input: BusinessSearchInput): Record<string, unknown> {
  const filters: unknown[] = [];
  if (input.minRating != null) filters.push(["rating.value", ">=", input.minRating]);
  if (input.minReviews != null) {
    if (filters.length) filters.push("and");
    filters.push(["rating.votes_count", ">=", input.minReviews]);
  }
  const orderBy =
    input.sortBy === "rating" ? ["rating.value,desc"] : input.sortBy === "reviews" ? ["rating.votes_count,desc"] : undefined;
  return {
    categories: input.categories?.length ? input.categories : undefined,
    title: input.query || undefined,
    location_coordinate: formatListingsCoordinate(input.near),
    is_claimed: input.isClaimed,
    filters: filters.length ? filters : undefined,
    order_by: orderBy,
    limit: input.limit ?? 20,
    offset: input.offset ?? 0,
  };
}

export const BUSINESS_LISTING_FIELDS = [
  "title",
  "description",
  "category",
  "additional_categories",
  "address",
  "phone",
  "url",
  "domain",
  "rating",
  "is_claimed",
  "cid",
  "place_id",
  "latitude",
  "longitude",
  "total_photos",
  "check_url",
] as const;

/* ───────────────────────────── Local SERP (Maps / Local Finder) ───────────────────────────── */

export type LocalSerpInput = {
  keyword: string;
  latitude: number;
  longitude: number;
  zoom?: number;
  searchType: "maps" | "local_finder";
  device: "desktop" | "mobile";
  depth: number;
  languageCode: string;
};

export function buildLocalSerpRequest(input: LocalSerpInput): { path: string; task: Record<string, unknown> } {
  const os = input.device === "desktop" ? "windows" : "android";
  const base = {
    keyword: input.keyword,
    location_coordinate: formatLocalSerpCoordinate(input),
    language_code: input.languageCode,
    device: input.device,
    os,
    depth: input.depth,
  };
  return input.searchType === "maps"
    ? { path: MAPS_SERP_PATH, task: { ...base, search_places: false } }
    : { path: LOCAL_FINDER_SERP_PATH, task: base };
}

export const LOCAL_SERP_FIELDS = [
  "rank_group",
  "rank_absolute",
  "title",
  "domain",
  "url",
  "contact_url",
  "address",
  "address_info",
  "phone",
  "category",
  "additional_categories",
  "rating",
  "rating_distribution",
  "price_level",
  "is_claimed",
  "cid",
  "place_id",
  "latitude",
  "longitude",
  "total_photos",
  "work_hours",
  "local_justifications",
] as const;

/* ───────────────────────────── Reviews / Q&A / posts ───────────────────────────── */

export const REVIEW_ROW_FIELDS = [
  "rank_absolute",
  "time_ago",
  "timestamp",
  "rating",
  "review_text",
  "original_review_text",
  "original_language",
  "profile_name",
  "local_guide",
  "reviews_count",
  "photos_count",
  "review_highlights",
  "source",
  "owner_answer",
  "owner_time_ago",
  "owner_timestamp",
  "review_id",
] as const;

export const BUSINESS_UPDATE_ROW_FIELDS = ["rank_absolute", "author", "post_date", "timestamp", "post_text", "snippet", "url", "links"] as const;

export type ReviewsSort = "newest" | "highest_rating" | "lowest_rating" | "relevant";

export function buildReviewsTaskPost(
  input: { keyword?: string; cid?: string; placeId?: string } & BusinessLocation & {
      depth: number;
      sortBy?: ReviewsSort;
      includeOtherSources: boolean;
    },
): { endpoint: BusinessTaskEndpoint; task: Record<string, unknown> } {
  const common = {
    keyword: input.keyword,
    cid: input.cid,
    place_id: input.placeId,
    ...businessLocationParams(input),
    language_code: input.languageCode,
    depth: input.depth,
    priority: TASK_PRIORITY_HIGH,
  };
  if (input.includeOtherSources) return { endpoint: "extended_reviews", task: common };
  return { endpoint: "reviews", task: { ...common, sort_by: input.sortBy ?? "newest" } };
}

export function buildUpdatesTaskPost(input: { keyword: string; depth: number } & BusinessLocation) {
  return {
    endpoint: "my_business_updates" as const,
    task: {
      keyword: input.keyword,
      ...businessLocationParams(input),
      language_code: input.languageCode,
      depth: input.depth,
      priority: TASK_PRIORITY_HIGH,
    },
  };
}

/** Q&A results: flatten answered `items` + `items_without_answers`. */
export function combinedQuestionItems(results: unknown): Record<string, unknown>[] {
  const list = Array.isArray(results) ? results : [];
  return list.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const rec = r as Record<string, unknown>;
    const items = Array.isArray(rec.items) ? (rec.items as Record<string, unknown>[]) : [];
    const without = Array.isArray(rec.items_without_answers) ? (rec.items_without_answers as Record<string, unknown>[]) : [];
    return [...items, ...without.map((q) => ({ ...q, items: [] }))];
  });
}

/* ───────────────────────────── Geo rank grid ───────────────────────────── */

const KM_PER_DEGREE_LATITUDE = 110.574;
const KM_PER_DEGREE_LONGITUDE = 111.32;
const MIN_LONGITUDE_COSINE = 0.01;
export const RANK_GRID_DEPTH = 20;
export const RANK_GRID_CONCURRENCY = 3;
const RANK_GRID_ZOOM_NUMERATOR_KM = 24045;

export type GridPoint = { row: number; col: number; latitude: number; longitude: number };
export type GridPointResult = GridPoint & {
  rank: number | null;
  resultsCount?: number;
  topResult?: { title: string | null; cid: string | null } | null;
  error?: boolean;
};

/** zoom = clamp(floor(log2(24045·max(|cos lat|, .01) / spacingKm)), 4, 18) */
export function rankGridZoom(spacingKm: number, latitude: number): number {
  const cos = Math.max(Math.abs(Math.cos((latitude * Math.PI) / 180)), MIN_LONGITUDE_COSINE);
  const zoom = Math.floor(Math.log2((RANK_GRID_ZOOM_NUMERATOR_KM * cos) / spacingKm));
  return Math.min(18, Math.max(4, zoom));
}

/** Row 0 = northernmost. latStep = km/110.574, lngStep = km/(111.32·max(|cos lat|, .01)). */
export function buildRankGridPoints(center: { latitude: number; longitude: number }, gridSize: number, spacingKm: number): GridPoint[] {
  const middle = (gridSize - 1) / 2;
  const latStep = spacingKm / KM_PER_DEGREE_LATITUDE;
  const lngStep =
    spacingKm / (KM_PER_DEGREE_LONGITUDE * Math.max(Math.abs(Math.cos((center.latitude * Math.PI) / 180)), MIN_LONGITUDE_COSINE));
  const points: GridPoint[] = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      points.push({
        row,
        col,
        latitude: Number((center.latitude + (middle - row) * latStep).toFixed(7)),
        longitude: Number((center.longitude + (col - middle) * lngStep).toFixed(7)),
      });
    }
  }
  return points;
}

/** Match by cid → place_id → title contains name (case-insensitive). */
export function matchGridItem(items: unknown[], target: { cid?: string; placeId?: string; name?: string }): unknown {
  const name = target.name?.toLowerCase();
  return items.find((item) => {
    if (target.cid != null && target.cid !== "" && readPath(item, "cid") === target.cid) return true;
    if (target.placeId != null && target.placeId !== "" && readPath(item, "place_id") === target.placeId) return true;
    if (!name) return false;
    const title = readPath(item, "title");
    return typeof title === "string" && title.toLowerCase().includes(name);
  });
}

export function summarizeGrid(grid: GridPointResult[]) {
  const found = grid.filter((p) => p.rank != null);
  const ranks = found.map((p) => p.rank ?? 0);
  return {
    pointsSearched: grid.length,
    pointsFound: found.length,
    averageRank: ranks.length ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 100) / 100 : null,
    top3Count: ranks.filter((r) => r <= 3).length,
    top10Count: ranks.filter((r) => r <= 10).length,
  };
}

/* ───────────────────────────── Cost hints (shown before paid calls) ───────────────────────────── */

/** Approximate raw DataForSEO prices used for pre-run estimates in the UI. */
export const LOCAL_COST_HINTS = {
  /** Maps / Local Finder SERP, per 10-result page (live). */
  mapsPerPage: 0.002,
  businessListings: 0.01,
  businessInfo: 0.0054,
  questions: 0.0054,
  /** reviews per 10 reviews (high priority task). */
  reviewsPer10: 0.0015,
  /** extended reviews per 20 reviews. */
  extendedReviewsPer20: 0.003,
  updatesPer10: 0.0015,
};

export function estimateRankGridCost(gridSize: number): number {
  const pages = RANK_GRID_DEPTH / 10;
  return Math.round(gridSize * gridSize * LOCAL_COST_HINTS.mapsPerPage * pages * 1e5) / 1e5;
}

export type LocalCostTool = "business_search" | "local_serp" | "rank_grid" | "business_profile" | "reviews" | "questions" | "posts";

/** Approximate raw cost shown before running a Local SEO tool (actual cost is recorded from DataForSEO). */
export function estimateLocalRunCost(tool: LocalCostTool, input: { depth?: unknown; gridSize?: unknown; includeOtherSources?: unknown }): number {
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  switch (tool) {
    case "business_search":
      return LOCAL_COST_HINTS.businessListings;
    case "local_serp":
      return Math.max(1, Math.ceil(n(input.depth, 20) / 10)) * LOCAL_COST_HINTS.mapsPerPage;
    case "rank_grid":
      return estimateRankGridCost(n(input.gridSize, 3));
    case "business_profile":
      return LOCAL_COST_HINTS.businessInfo;
    case "questions":
      return LOCAL_COST_HINTS.questions;
    case "reviews": {
      const depth = n(input.depth, 20);
      return input.includeOtherSources === true
        ? Math.ceil(depth / 20) * LOCAL_COST_HINTS.extendedReviewsPer20
        : Math.ceil(depth / 10) * LOCAL_COST_HINTS.reviewsPer10;
    }
    case "posts":
      return Math.ceil(n(input.depth, 10) / 10) * LOCAL_COST_HINTS.updatesPer10;
  }
}
