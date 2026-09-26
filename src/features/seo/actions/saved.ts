"use server";

import {
  deleteSavedKeywordTag,
  enqueueSavedKeywordMetricsRefresh,
  exportSavedKeywords,
  listSavedKeywords,
  removeSavedKeywords,
  updateSavedKeywordTag,
  updateSavedKeywordTags,
} from "@/server/seo";
import type { ListSavedKeywordsInput } from "@/server/seo/saved-keywords";
import { seoAction } from "../server/action-helpers";

export async function listSavedKeywordsAction(projectId: string, input: ListSavedKeywordsInput) {
  return seoAction(projectId, undefined, (ctx) => listSavedKeywords(ctx, input));
}

export async function exportSavedKeywordsAction(projectId: string, input: Omit<ListSavedKeywordsInput, "page" | "pageSize">) {
  return seoAction(projectId, undefined, (ctx) => exportSavedKeywords(ctx, input));
}

export async function updateSavedKeywordTagsAction(projectId: string, input: { savedKeywordIds: string[]; addTags?: string[]; removeTagIds?: string[] }) {
  return seoAction(projectId, "seo.run", (ctx) => updateSavedKeywordTags(ctx, input));
}

export async function updateSavedKeywordTagAction(projectId: string, input: { tagId: string; name?: string; color?: string | null }) {
  return seoAction(projectId, "seo.run", (ctx) => updateSavedKeywordTag(ctx, input as Parameters<typeof updateSavedKeywordTag>[1]));
}

export async function deleteSavedKeywordTagAction(projectId: string, tagId: string) {
  return seoAction(projectId, "seo.run", (ctx) => deleteSavedKeywordTag(ctx, { tagId }));
}

export async function removeSavedKeywordsAction(projectId: string, savedKeywordIds: string[]) {
  return seoAction(projectId, "seo.run", (ctx) => removeSavedKeywords(ctx, { savedKeywordIds }));
}

/** Billed refresh → background job (poll with getJobStatusAction). */
export async function refreshSavedKeywordMetricsAction(projectId: string) {
  return seoAction(projectId, "seo.run", (ctx) => enqueueSavedKeywordMetricsRefresh(ctx));
}
