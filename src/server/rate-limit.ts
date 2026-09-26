import "server-only";

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();

/**
 * Sliding-window in-memory rate limiter (single instance deployment).
 * Returns true when the call is allowed.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  if (buckets.size > 50_000) {
    for (const [k, b] of buckets) if (!b.hits.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  return true;
}
