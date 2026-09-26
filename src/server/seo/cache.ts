import "server-only";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { seoCache } from "@/server/db/schema";
import { sha256 } from "@/server/crypto";

/** TTLs (seconds) — same as open-seo's R2 cache. */
export const CACHE_TTL = {
  keywordResearch: 24 * 60 * 60,
  serpAnalysis: 12 * 60 * 60,
  domain: 12 * 60 * 60,
  backlinks: 6 * 60 * 60,
  ahrefsDr: 24 * 60 * 60,
  serpLocations: 30 * 24 * 60 * 60,
  businessCategories: 7 * 24 * 60 * 60,
} as const;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** `{prefix}:{sha256(JSON of params with sorted keys)}` */
export function buildCacheKey(prefix: string, params: Record<string, unknown>): string {
  return `${prefix}:${sha256(stableStringify(params))}`;
}

export async function cacheGet<T>(key: string): Promise<{ value: T; createdAt: Date } | null> {
  const [row] = await db
    .select({ value: seoCache.value, createdAt: seoCache.createdAt })
    .from(seoCache)
    .where(and(eq(seoCache.key, key), gt(seoCache.expiresAt, new Date())))
    .limit(1);
  return row ? { value: row.value as T, createdAt: row.createdAt } : null;
}

/** Like cacheGet but also returns expired (not yet purged) entries, flagged `stale`. Read-only. */
export async function cachePeek<T>(key: string): Promise<{ value: T; createdAt: Date; stale: boolean } | null> {
  const [row] = await db
    .select({ value: seoCache.value, createdAt: seoCache.createdAt, expiresAt: seoCache.expiresAt })
    .from(seoCache)
    .where(eq(seoCache.key, key))
    .limit(1);
  return row ? { value: row.value as T, createdAt: row.createdAt, stale: row.expiresAt <= new Date() } : null;
}

export async function cacheSet(key: string, namespace: string, projectId: string | null, value: unknown, ttlSeconds: number) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  try {
    await db
      .insert(seoCache)
      .values({ key, namespace, projectId, value: value as object, expiresAt })
      .onConflictDoUpdate({ target: seoCache.key, set: { value: value as object, expiresAt, createdAt: new Date() } });
  } catch (err) {
    console.error("[seo] cache write failed", namespace, err);
  }
}

/** Drops expired entries (daily job). */
export async function purgeExpiredCache(): Promise<number> {
  const rows = await db.delete(seoCache).where(lt(seoCache.expiresAt, sql`now()`)).returning({ key: seoCache.key });
  return rows.length;
}
