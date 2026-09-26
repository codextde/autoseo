/**
 * Pre-run cost estimates (raw DataForSEO USD, self-hosted → no markup). Actual costs are always recorded from
 * the DataForSEO response via `recordUsage`; these numbers only inform the user before a paid call.
 *
 * Sources (docs/research/open-seo-inventory.md §18 "Cost reference", §3/§4 MCP credit quotes; credits = USD × 1.28 × 1000):
 * - Labs: $0.01 per task + $0.0001 per returned row; clickstream doubles the price.
 * - Google Ads keyword data: flat $0.075 per request.
 * - SERP: live $0.002 first page (10 results) + $0.0015 per additional page.
 * - Domain overview / keyword suggestions: ~100–300 credits → ≈ $0.08–$0.23.
 * - Backlinks overview: ~50 credits (domain) / ~25 (page) → ≈ $0.04 / $0.02; backlinks list pages ~30 credits → ≈ $0.023.
 */
import { costPerSerpAtDepth } from "./rank-tracking";

const LABS_TASK_USD = 0.01;
const LABS_ROW_USD = 0.0001;
const ADS_REQUEST_USD = 0.075;

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

export function estimateLabsCall(rows: number, clickstream = false): number {
  return r5((LABS_TASK_USD + rows * LABS_ROW_USD) * (clickstream ? 2 : 1));
}

/** Auto mode may call up to 3 Labs sources; the estimate covers the typical 1-call case and the worst case. */
export function estimateKeywordResearch(input: { resultLimit: number; clickstream: boolean; provider: "labs" | "google_ads"; mode: string }) {
  if (input.provider === "google_ads") return { minUsd: ADS_REQUEST_USD, maxUsd: ADS_REQUEST_USD };
  const one = estimateLabsCall(input.resultLimit, input.clickstream);
  return { minUsd: one, maxUsd: input.mode === "auto" ? r5(one * 3) : one };
}

export function estimateKeywordMetrics(keywordCount: number, provider: "labs" | "google_ads", local = false): number {
  const batches = Math.max(1, Math.ceil(keywordCount / 700));
  if (provider === "google_ads") return r5(batches * ADS_REQUEST_USD);
  const labs = batches * LABS_TASK_USD + keywordCount * LABS_ROW_USD;
  return r5(local ? labs + batches * ADS_REQUEST_USD : labs);
}

export function estimateSerpAnalysis(depth: number): number {
  return r5(costPerSerpAtDepth(depth, "live"));
}

export function estimateDomainOverview(pageSize: number): number {
  // domain_rank_overview (1 row) + first ranked_keywords page.
  return r5(estimateLabsCall(1) + estimateLabsCall(pageSize));
}

export function estimateDomainPage(pageSize: number): number {
  return estimateLabsCall(pageSize);
}

export function estimateBacklinksOverview(scope: string): number {
  return scope === "exact_url" ? 0.02 : 0.04;
}

export const BACKLINKS_PAGE_ESTIMATE_USD = 0.023;

export function formatUsd(v: number | null | undefined, digits?: number): string {
  if (v == null || Number.isNaN(v)) return "—";
  const d = digits ?? (v < 0.01 ? 4 : v < 1 ? 3 : 2);
  return `$${v.toFixed(d)}`;
}
