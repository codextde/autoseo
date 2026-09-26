import "server-only";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { freeToolCache } from "@/server/db/schema";

/** Cached result envelope (open-seo `CachedEnvelope`): hits are served without spending budget. */
export type CachedEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

function rowKey(tool: string, key: string) {
  return `${tool}|${key}`;
}

export async function readCached<T>(tool: string, key: string): Promise<CachedEnvelope<T> | null> {
  const [row] = await db
    .select({ ok: freeToolCache.ok, data: freeToolCache.data, error: freeToolCache.error })
    .from(freeToolCache)
    .where(and(eq(freeToolCache.key, rowKey(tool, key)), gt(freeToolCache.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  return row.ok ? { ok: true, data: row.data as T } : { ok: false, error: row.error ?? "Lookup failed. Please try again." };
}

export async function writeCached(tool: string, key: string, envelope: CachedEnvelope<unknown>, ttlSeconds: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const values = envelope.ok
    ? { ok: true, data: envelope.data as object, error: null }
    : { ok: false, data: null, error: envelope.error };
  try {
    await db
      .insert(freeToolCache)
      .values({ key: rowKey(tool, key), tool, ...values, expiresAt })
      .onConflictDoUpdate({ target: freeToolCache.key, set: { ...values, expiresAt, createdAt: new Date() } });
  } catch (err) {
    console.error("[free-tools] cache write failed", tool, err);
  }
}

export async function deleteCached(tool: string, key: string): Promise<void> {
  await db.delete(freeToolCache).where(eq(freeToolCache.key, rowKey(tool, key)));
}

/** Drops expired entries (run opportunistically once per UTC day by the budget ledger). */
export async function purgeExpiredToolCache(): Promise<number> {
  const rows = await db.delete(freeToolCache).where(lt(freeToolCache.expiresAt, sql`now()`)).returning({ key: freeToolCache.key });
  return rows.length;
}
