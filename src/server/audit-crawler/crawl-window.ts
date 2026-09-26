/**
 * Rolling fetch-concurrency window (port of open-seo `crawl-window.ts`). Shrinks on trouble
 * (errors, blocks, very slow responses, 429s), grows only on a clean, mostly fast, full-size
 * batch, and is capped by an in-flight HTML byte budget. The max comes from Admin → Limits
 * (`auditConcurrency`) instead of open-seo's Worker-memory cap of 2.
 */
import type { CrawledPageResult } from "./types";

export interface CrawlWindowLimits {
  initial: number;
  min: number;
  max: number;
  budgetBytes: number;
}

export function crawlWindowLimits(maxConcurrency: number): CrawlWindowLimits {
  const max = Math.max(1, Math.floor(maxConcurrency));
  return { initial: Math.min(2, max), min: 1, max, budgetBytes: 32 * 1024 * 1024 };
}

const SLOW_RESPONSE_MS = 10_000;
const FAST_RESPONSE_MS = 1_500;
const MIN_ASSUMED_PAGE_BYTES = 64 * 1024;
const GROWTH_MIN_SAMPLE = 25;

export function clampCrawlWindow(size: number, limits: CrawlWindowLimits): number {
  return Math.min(Math.max(size, limits.min), limits.max);
}

export function adjustCrawlWindow(
  windowSize: number,
  recent: Array<Pick<CrawledPageResult, "fetchClass" | "rateLimited" | "responseTimeMs" | "htmlBytes">>,
  limits: CrawlWindowLimits,
): number {
  if (recent.length === 0) return windowSize;
  const troubled = recent.filter(
    (page) => page.fetchClass !== "ok" || page.rateLimited || (page.responseTimeMs ?? 0) >= SLOW_RESPONSE_MS,
  ).length;
  let next = windowSize;
  if (troubled * 3 >= recent.length) {
    next = Math.max(limits.min, Math.floor(windowSize / 2));
  } else {
    const fast = recent.filter((page) => page.fetchClass === "ok" && (page.responseTimeMs ?? Infinity) <= FAST_RESPONSE_MS).length;
    if (troubled === 0 && fast * 2 >= recent.length && recent.length >= GROWTH_MIN_SAMPLE) {
      next = Math.min(limits.max, windowSize + 5);
    }
  }
  const avgPageBytes = Math.max(recent.reduce((sum, page) => sum + page.htmlBytes, 0) / recent.length, MIN_ASSUMED_PAGE_BYTES);
  const byteBound = Math.max(limits.min, Math.floor(limits.budgetBytes / avgPageBytes));
  return Math.min(next, byteBound);
}
