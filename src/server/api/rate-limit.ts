import "server-only";
import { clientIpSync } from "@/server/http/request";

type Window = { hits: number[] };
const windows = new Map<string, Window>();
const MAX_KEYS = 20_000;

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix seconds when the oldest hit leaves the window. */
  reset: number;
  retryAfter: number;
};

/**
 * Sliding-window limiter with header info (single-instance deployment; state lives in memory).
 * Used per API key / OAuth token (`security.apiRateLimitPerMinute`) and per IP for auth endpoints.
 */
export function checkRateLimit(key: string, limit: number, windowMs = 60_000): RateLimitResult {
  const now = Date.now();
  const w = windows.get(key) ?? { hits: [] };
  w.hits = w.hits.filter((t) => now - t < windowMs);
  const oldest = w.hits[0] ?? now;
  const reset = Math.ceil((oldest + windowMs) / 1000);
  if (w.hits.length >= limit) {
    windows.set(key, w);
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, limit, remaining: 0, reset, retryAfter };
  }
  w.hits.push(now);
  windows.delete(key);
  windows.set(key, w); // re-insert → Map order = least recently used first
  if (windows.size > MAX_KEYS) {
    // Bounded memory even under spoofed-IP floods: drop the least recently used windows.
    let excess = windows.size - MAX_KEYS + 1000;
    for (const k of windows.keys()) {
      if (excess-- <= 0) break;
      windows.delete(k);
    }
  }
  return { allowed: true, limit, remaining: Math.max(0, limit - w.hits.length), reset, retryAfter: 0 };
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(r.reset),
  };
  if (!r.allowed) h["Retry-After"] = String(r.retryAfter);
  return h;
}

/**
 * Best-effort client IP from proxy headers (same precedence as session metadata). Headers can be
 * spoofed when the app is reachable without a proxy, so IP limits are defence in depth only —
 * credential limits and global caps do not depend on them.
 */
export function clientIp(headers: Headers): string {
  return clientIpSync(headers) ?? "unknown";
}
