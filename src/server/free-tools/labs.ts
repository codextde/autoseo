/**
 * DataForSEO response parsers shared by the free research tools (port of open-seo `labs.ts`). Pure.
 */
import { z } from "zod";
import type { KeywordIdea, OrganicMetrics, RankedKeywordRow, RelevantPageRow } from "@/features/free-tools/lib/types";

const num = z.number().nullable().optional();
const str = z.string().nullable().optional();

/** `result[0].items` + `total_count` of the endpoints that return a single result block. */
export const itemsResultSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  total_count: num,
});

const organicMetricsSchema = z.object({
  metrics: z
    .object({
      organic: z.object({ etv: num, count: num, estimated_paid_traffic_cost: num }).nullable().optional(),
    })
    .nullable()
    .optional(),
});

/** `domain_rank_overview` returns one item; `relevant_pages` items share the shape. */
export function readOrganicMetrics(input: unknown): OrganicMetrics {
  const parsed = organicMetricsSchema.safeParse(input ?? {});
  const organic = parsed.success ? parsed.data.metrics?.organic : null;
  return {
    organicTraffic: organic?.etv != null ? Math.round(organic.etv) : null,
    organicKeywords: organic?.count != null ? Math.round(organic.count) : null,
    trafficValue: organic?.estimated_paid_traffic_cost != null ? Math.round(organic.estimated_paid_traffic_cost) : null,
  };
}

const keywordDataSchema = z
  .object({
    keyword: str,
    keyword_info: z.object({ search_volume: num }).nullable().optional(),
    keyword_properties: z.object({ keyword_difficulty: num }).nullable().optional(),
  })
  .nullable()
  .optional();

const serpElementSchema = z.object({ rank_group: num, rank_absolute: num, url: str, etv: num }).nullable().optional();

const rankedKeywordSchema = z.object({
  keyword_data: keywordDataSchema,
  ranked_serp_element: z.object({ serp_item: serpElementSchema }).nullable().optional(),
});

export function readRankedKeyword(input: unknown): RankedKeywordRow {
  const item = rankedKeywordSchema.parse(input ?? {});
  const serpItem = item.ranked_serp_element?.serp_item;
  return {
    keyword: item.keyword_data?.keyword ?? null,
    searchVolume: item.keyword_data?.keyword_info?.search_volume ?? null,
    difficulty: item.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
    position: serpItem?.rank_group ?? serpItem?.rank_absolute ?? null,
    url: serpItem?.url ?? null,
  };
}

export function readRelevantPage(input: unknown): RelevantPageRow {
  const metrics = readOrganicMetrics(input);
  const page = z.object({ page_address: str }).parse(input ?? {});
  return { url: page.page_address ?? null, traffic: metrics.organicTraffic, keywords: metrics.organicKeywords };
}

const intersectionItemSchema = z.object({ keyword_data: keywordDataSchema, first_domain_serp_element: serpElementSchema });

/** `domain_intersection` (intersections:false) row → gap row with the competitor's position + traffic. */
export function readGapRow(input: unknown): RankedKeywordRow & { traffic: number | null } {
  const item = intersectionItemSchema.parse(input ?? {});
  const el = item.first_domain_serp_element;
  return {
    keyword: item.keyword_data?.keyword ?? null,
    searchVolume: item.keyword_data?.keyword_info?.search_volume ?? null,
    difficulty: item.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
    position: el?.rank_group ?? el?.rank_absolute ?? null,
    url: el?.url ?? null,
    traffic: el?.etv != null ? Math.round(el.etv) : null,
  };
}

const keywordIdeaSchema = z.object({
  keyword: z.string(),
  keyword_info: z.object({ search_volume: num }).nullable().optional(),
  keyword_properties: z.object({ keyword_difficulty: num }).nullable().optional(),
});

export function readKeywordIdea(input: unknown): KeywordIdea {
  const item = keywordIdeaSchema.parse(input);
  return {
    keyword: item.keyword,
    searchVolume: item.keyword_info?.search_volume ?? null,
    difficulty: item.keyword_properties?.keyword_difficulty ?? null,
  };
}

/** Order ranked keywords by the traffic the ranking page earns. */
export const RANKED_KEYWORDS_ORDER = ["ranked_serp_element.serp_item.etv,desc"];
export const RELEVANT_PAGES_ORDER = ["metrics.organic.etv,desc"];
