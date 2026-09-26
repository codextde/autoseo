"use server";

import {
  addSearchHistory,
  getSerpAnalysis,
  researchKeywords,
  saveKeywords,
  type ResearchKeywordsInput,
} from "@/server/seo";
import { locationLabel } from "@/server/seo/lib/locations";
import { seoAction } from "../server/action-helpers";

/** Keyword research (cached 24h; a cache miss requires `seo.run`, enforced by the service). Adds to recent searches. */
export async function researchKeywordsAction(projectId: string, input: ResearchKeywordsInput) {
  return seoAction(projectId, undefined, async (ctx) => {
    const result = await researchKeywords(ctx, input);
    if (result.rows.length > 0) {
      await addSearchHistory(ctx, "keywords", result.seed, {
        q: result.seed,
        loc: result.locationCode,
        locationName: locationLabel(result.locationCode),
      }).catch(() => undefined);
    }
    return result;
  });
}

export async function getSerpAnalysisAction(projectId: string, input: { keyword: string; locationCode?: number; languageCode?: string; depth?: 20 | 100 }) {
  return seoAction(projectId, undefined, (ctx) => getSerpAnalysis(ctx, input));
}

/** Save keywords (+ provided metrics) to the project — no DataForSEO call; input validated by the service. */
export async function saveKeywordsAction(projectId: string, input: Parameters<typeof saveKeywords>[1]) {
  return seoAction(projectId, "seo.run", (ctx) => saveKeywords(ctx, input));
}
