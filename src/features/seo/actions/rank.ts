"use server";

import { z } from "zod";
import {
  addTrackingKeywords,
  archiveRankConfig,
  createRankConfig,
  enqueueTrackingKeywordMetricsRefresh,
  estimateRankTrackerCost,
  getLatestRankRun,
  getRankConfigTrend,
  getRankKeywordHistory,
  getRankPositionMatrix,
  getRankTrackingResults,
  getTrackerKeywordSuggestions,
  prewarmSerpLocations,
  removeTrackingKeywords,
  searchSerpLocations,
  triggerRankCheck,
  updateRankConfig,
} from "@/server/seo";
import type { ComparePeriod } from "@/server/seo/lib/rank-tracking";
import { seoAction } from "../server/action-helpers";

const device = z.enum(["desktop", "mobile"]);

export async function createRankConfigAction(projectId: string, input: Parameters<typeof createRankConfig>[1]) {
  return seoAction(projectId, "seo.run", (ctx) => createRankConfig(ctx, input));
}

export async function updateRankConfigAction(projectId: string, input: Parameters<typeof updateRankConfig>[1]) {
  return seoAction(projectId, "seo.run", (ctx) => updateRankConfig(ctx, input));
}

export async function archiveRankConfigAction(projectId: string, configId: string) {
  return seoAction(projectId, "seo.run", (ctx) => archiveRankConfig(ctx, configId));
}

export async function addTrackingKeywordsAction(projectId: string, input: Parameters<typeof addTrackingKeywords>[1]) {
  return seoAction(projectId, "seo.run", (ctx) => addTrackingKeywords(ctx, input));
}

export async function removeTrackingKeywordsAction(projectId: string, configId: string, keywordIds: string[]) {
  return seoAction(projectId, "seo.run", (ctx) => removeTrackingKeywords(ctx, { configId, keywordIds }));
}

export async function triggerRankCheckAction(projectId: string, configId: string, keywordIds?: string[]) {
  return seoAction(projectId, "seo.run", (ctx) => triggerRankCheck(ctx, { configId, keywordIds }));
}

export async function getLatestRankRunAction(projectId: string, configId: string) {
  return seoAction(projectId, undefined, (ctx) => getLatestRankRun(ctx, configId));
}

export async function getRankResultsAction(projectId: string, configId: string, comparePeriod: ComparePeriod) {
  return seoAction(projectId, undefined, (ctx) => getRankTrackingResults(ctx, configId, z.enum(["1d", "7d", "30d", "90d"]).parse(comparePeriod)));
}

export async function estimateRankTrackerCostAction(projectId: string, configId: string, additionalKeywordCount = 0) {
  return seoAction(projectId, undefined, (ctx) => estimateRankTrackerCost(ctx, configId, z.number().int().min(0).max(1000).parse(additionalKeywordCount)));
}

export async function refreshTrackingMetricsAction(projectId: string, configId: string) {
  return seoAction(projectId, "seo.run", (ctx) => enqueueTrackingKeywordMetricsRefresh(ctx, configId));
}

export async function getKeywordHistoryAction(projectId: string, configId: string, trackingKeywordId: string, sinceDays: number) {
  return seoAction(projectId, undefined, (ctx) => getRankKeywordHistory(ctx, { configId, trackingKeywordId, sinceDays }));
}

export async function getConfigTrendAction(projectId: string, configId: string, d: "desktop" | "mobile", sinceDays: number) {
  return seoAction(projectId, undefined, (ctx) => getRankConfigTrend(ctx, { configId, device: device.parse(d), sinceDays }));
}

export async function getPositionMatrixAction(projectId: string, configId: string, d: "desktop" | "mobile", runLimit = 12) {
  return seoAction(projectId, undefined, (ctx) => getRankPositionMatrix(ctx, { configId, device: device.parse(d), runLimit }));
}

export async function searchSerpLocationsAction(projectId: string, query: string, countryCode: string) {
  return seoAction(projectId, undefined, (ctx) => searchSerpLocations(ctx, { query, countryCode }));
}

export async function prewarmSerpLocationsAction(projectId: string, countryCode: string) {
  return seoAction(projectId, undefined, (ctx) => prewarmSerpLocations(ctx, countryCode));
}

/** Top-100 ranked keywords (Labs, billed on cache miss → needs seo.run). */
export async function getTrackerKeywordSuggestionsAction(projectId: string, configId: string) {
  return seoAction(projectId, "seo.run", (ctx) => getTrackerKeywordSuggestions(ctx, configId));
}
