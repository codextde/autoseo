import "server-only";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { seoSearchHistory } from "@/server/db/schema";
import type { SeoContext } from "./context";

export type SearchFeature = "keywords" | "domain" | "backlinks";
export type HistoryParams = Record<string, string | number | boolean | null>;
export type SearchHistoryItem = { id: string; label: string; params: HistoryParams; createdAt: Date };

/** Max 20 per feature (newest first), deduped on the feature's identity params. */
export const MAX_HISTORY = 20;

export async function addSearchHistory(ctx: SeoContext, feature: SearchFeature, label: string, params: HistoryParams) {
  if (!ctx.userId) return;
  const dedupeKey = JSON.stringify(Object.keys(params).sort().map((k) => [k, params[k] ?? null]));
  await db
    .insert(seoSearchHistory)
    .values({ projectId: ctx.projectId, userId: ctx.userId, feature, dedupeKey, label, params })
    .onConflictDoUpdate({
      target: [seoSearchHistory.projectId, seoSearchHistory.userId, seoSearchHistory.feature, seoSearchHistory.dedupeKey],
      set: { createdAt: new Date(), label },
    });
  // Trim to the newest MAX_HISTORY entries.
  const keep = await db
    .select({ id: seoSearchHistory.id })
    .from(seoSearchHistory)
    .where(and(eq(seoSearchHistory.projectId, ctx.projectId), eq(seoSearchHistory.userId, ctx.userId), eq(seoSearchHistory.feature, feature)))
    .orderBy(desc(seoSearchHistory.createdAt))
    .limit(MAX_HISTORY);
  if (keep.length >= MAX_HISTORY) {
    await db.delete(seoSearchHistory).where(
      and(
        eq(seoSearchHistory.projectId, ctx.projectId),
        eq(seoSearchHistory.userId, ctx.userId),
        eq(seoSearchHistory.feature, feature),
        notInArray(
          seoSearchHistory.id,
          keep.map((k) => k.id),
        ),
      ),
    );
  }
}

export async function listSearchHistory(ctx: SeoContext, feature: SearchFeature): Promise<SearchHistoryItem[]> {
  if (!ctx.userId) return [];
  return db
    .select({ id: seoSearchHistory.id, label: seoSearchHistory.label, params: seoSearchHistory.params, createdAt: seoSearchHistory.createdAt })
    .from(seoSearchHistory)
    .where(and(eq(seoSearchHistory.projectId, ctx.projectId), eq(seoSearchHistory.userId, ctx.userId), eq(seoSearchHistory.feature, feature)))
    .orderBy(desc(seoSearchHistory.createdAt))
    .limit(MAX_HISTORY);
}

export async function removeSearchHistory(ctx: SeoContext, ids: string[]) {
  if (!ctx.userId || ids.length === 0) return;
  await db
    .delete(seoSearchHistory)
    .where(and(eq(seoSearchHistory.projectId, ctx.projectId), eq(seoSearchHistory.userId, ctx.userId), inArray(seoSearchHistory.id, ids)));
}

export async function clearSearchHistory(ctx: SeoContext, feature: SearchFeature) {
  if (!ctx.userId) return;
  await db
    .delete(seoSearchHistory)
    .where(and(eq(seoSearchHistory.projectId, ctx.projectId), eq(seoSearchHistory.userId, ctx.userId), eq(seoSearchHistory.feature, feature)));
}
