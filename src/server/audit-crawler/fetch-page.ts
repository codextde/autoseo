/**
 * Fetch + analyze one URL (port of open-seo `crawlPage`). Manual redirects (each hop is its own
 * page row; chains/loops detected later), 15 s timeout, HTML capped at 1 MiB, bot-challenge
 * classification, 429 retry through the shared throttle.
 */
import type { CrawlThrottle } from "./crawl-throttle";
import { deterministicAuditRowId, sha256Hex } from "./ids";
import { analyzeHtml } from "./page-analyzer";
import { CRAWLER_USER_AGENT, type PageFetchClass } from "./registry";
import { readTextCapped, safeFetch, type SafeResponse } from "./safe-fetch";
import { CrawlTargetBlockedError } from "./url-policy";
import { normalizeUrl } from "./url-utils";
import type { CrawledPageResult } from "./types";

export const MAX_HTML_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

/** Markers of a bot-mitigation challenge page. */
export const CHALLENGE_BODY_MARKERS = [
  "just a moment...",
  "challenge-platform",
  "cf-browser-verification",
  "attention required! | cloudflare",
  "verifying you are human",
];

export function classifyFetch(statusCode: number, headers: Headers | SafeResponse["headers"], bodySnippet: string): PageFetchClass {
  if (statusCode === 0) return "error";
  // A final 429 means rate limiting (checked before cf-mitigated: CF rate-limit rules set it too).
  if (statusCode === 429) return "rate_limited";
  if (headers.get("cf-mitigated")) return "blocked";
  if (statusCode === 401 || statusCode === 403) return "blocked";
  if (statusCode === 503) {
    const snippet = bodySnippet.toLowerCase();
    if (CHALLENGE_BODY_MARKERS.some((marker) => snippet.includes(marker))) return "blocked";
  }
  return "ok";
}

/** Parses `Link: <url>; rel="canonical"` response headers. */
export function parseLinkHeaderCanonical(linkHeader: string | null, pageUrl: string): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;([^]*)/);
    if (!match) continue;
    if (/rel\s*=\s*"?canonical"?/i.test(match[2]!)) return normalizeUrl(match[1]!.trim(), pageUrl);
  }
  return null;
}

async function fetchWithThrottle(url: string, throttle: CrawlThrottle) {
  for (let attempt = 1; ; attempt++) {
    if (!(await throttle.ready())) return null;
    const startedAt = performance.now();
    const response = await safeFetch(url, {
      headers: {
        "User-Agent": CRAWLER_USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "en,*;q=0.5",
      },
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    const result = { response, responseTimeMs: Math.round(performance.now() - startedAt), rateLimited: attempt > 1 };
    if (response.status !== 429) {
      await throttle.recovered();
      return result;
    }
    const retry = await throttle.backoff(attempt, response.headers.get("retry-after"));
    if (!retry) return result;
    await response.body?.cancel().catch(() => {});
  }
}

function emptyPageResult(input: {
  id: string;
  url: string;
  statusCode: number;
  fetchClass: PageFetchClass;
  redirectUrl: string | null;
  contentType: string | null;
  responseTimeMs: number;
  xRobotsTag: string | null;
  headerCanonicalUrl: string | null;
  crawlDepth: number | null;
  inSitemap: boolean;
  htmlBytes?: number;
  rateLimited?: boolean;
}): CrawledPageResult {
  return {
    id: input.id,
    url: input.url,
    statusCode: input.statusCode,
    fetchClass: input.fetchClass,
    redirectUrl: input.redirectUrl,
    contentType: input.contentType,
    title: "",
    metaDescription: "",
    canonicalUrl: null,
    robotsMeta: null,
    xRobotsTag: input.xRobotsTag,
    headerCanonicalUrl: input.headerCanonicalUrl,
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    h1s: [],
    h1Count: 0,
    h2Count: 0,
    h3Count: 0,
    h4Count: 0,
    h5Count: 0,
    h6Count: 0,
    headingOrder: [],
    wordCount: 0,
    contentHash: null,
    isHtml: false,
    htmlBytes: input.htmlBytes ?? 0,
    rateLimited: input.rateLimited ?? false,
    imagesTotal: 0,
    imagesMissingAlt: 0,
    images: [],
    links: [],
    hasStructuredData: false,
    structuredDataTypes: [],
    hreflangTags: [],
    lang: null,
    isIndexable: false,
    responseTimeMs: input.responseTimeMs,
    crawlDepth: input.crawlDepth,
    inSitemap: input.inSitemap,
  };
}

/** Builds the page result from an already-fetched HTML body (shared with tests / fixtures). */
export function buildPageResultFromHtml(input: {
  id: string;
  url: string;
  statusCode: number;
  body: string;
  contentType: string | null;
  responseTimeMs: number;
  xRobotsTag: string | null;
  headerCanonicalUrl: string | null;
  crawlDepth: number | null;
  inSitemap: boolean;
  rateLimited?: boolean;
}): CrawledPageResult {
  const analysis = analyzeHtml(input.body, input.url, input.statusCode, input.responseTimeMs);
  const robotsDirectives = [analysis.robotsMeta, input.xRobotsTag].filter(Boolean).join(",").toLowerCase();
  const headingCount = (level: number) => analysis.headingOrder.filter((h) => h === level).length;
  return {
    id: input.id,
    url: input.url,
    statusCode: input.statusCode,
    fetchClass: "ok",
    redirectUrl: null,
    contentType: input.contentType,
    title: analysis.title,
    metaDescription: analysis.metaDescription,
    canonicalUrl: analysis.canonical ? (normalizeUrl(analysis.canonical, input.url) ?? analysis.canonical) : null,
    robotsMeta: analysis.robotsMeta,
    xRobotsTag: input.xRobotsTag,
    headerCanonicalUrl: input.headerCanonicalUrl,
    ogTitle: analysis.ogTitle,
    ogDescription: analysis.ogDescription,
    ogImage: analysis.ogImage,
    h1s: analysis.h1s.filter((h) => h.length > 0).slice(0, 10).map((h) => h.slice(0, 300)),
    h1Count: analysis.h1s.filter((h) => h.length > 0).length,
    h2Count: headingCount(2),
    h3Count: headingCount(3),
    h4Count: headingCount(4),
    h5Count: headingCount(5),
    h6Count: headingCount(6),
    headingOrder: analysis.headingOrder.slice(0, 500),
    wordCount: analysis.wordCount,
    contentHash: analysis.bodyText ? sha256Hex(analysis.bodyText) : null,
    isHtml: true,
    htmlBytes: Buffer.byteLength(input.body),
    rateLimited: input.rateLimited ?? false,
    imagesTotal: analysis.images.length,
    // Only an absent alt attribute counts: alt="" is correct for decorative images.
    imagesMissingAlt: analysis.images.filter((img) => img.alt === null).length,
    images: analysis.images.slice(0, 200).map((img) => ({ src: img.src?.slice(0, 500) ?? null, alt: img.alt?.slice(0, 300) ?? null })),
    links: analysis.links,
    hasStructuredData: analysis.hasStructuredData,
    structuredDataTypes: analysis.structuredDataTypes,
    hreflangTags: analysis.hreflangTags.slice(0, 100),
    lang: analysis.lang,
    isIndexable: !robotsDirectives.includes("noindex"),
    responseTimeMs: input.responseTimeMs,
    crawlDepth: input.crawlDepth,
    inSitemap: input.inSitemap,
  };
}

/** Null leaves this URL deferred when the shared cooldown/deadline stops its fetch. */
export async function crawlPage(
  auditId: string,
  url: string,
  crawlDepth: number | null,
  inSitemap: boolean,
  throttle: CrawlThrottle,
): Promise<CrawledPageResult | null> {
  const id = deterministicAuditRowId(auditId, url);
  const startTime = performance.now();
  try {
    const fetched = await fetchWithThrottle(url, throttle);
    if (!fetched) return null;
    const { response, responseTimeMs, rateLimited } = fetched;
    const statusCode = response.status;
    const xRobotsTag = response.headers.get("x-robots-tag");
    const headerCanonicalUrl = parseLinkHeaderCanonical(response.headers.get("link"), url);
    const contentType = response.headers.get("content-type");

    if (statusCode >= 300 && statusCode < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      return emptyPageResult({
        id,
        url,
        statusCode,
        fetchClass: "ok",
        redirectUrl: location ? normalizeUrl(location, url) : null,
        contentType,
        responseTimeMs,
        xRobotsTag,
        headerCanonicalUrl,
        crawlDepth,
        inSitemap,
        rateLimited,
      });
    }

    const isHtml = (contentType ?? "").toLowerCase().includes("text/html") || (contentType ?? "").toLowerCase().includes("application/xhtml");
    let body = "";
    if (isHtml || statusCode === 503) body = (await readTextCapped(response, MAX_HTML_BYTES)).text;
    else await response.body?.cancel().catch(() => {});
    const fetchClass = classifyFetch(statusCode, response.headers, body.slice(0, 4_000));

    if (!isHtml || fetchClass !== "ok" || statusCode >= 400) {
      return emptyPageResult({
        id,
        url,
        statusCode,
        fetchClass,
        redirectUrl: null,
        contentType,
        responseTimeMs,
        xRobotsTag,
        headerCanonicalUrl,
        crawlDepth,
        inSitemap,
        htmlBytes: Buffer.byteLength(body),
        rateLimited,
      });
    }
    return buildPageResultFromHtml({
      id,
      url,
      statusCode,
      body,
      contentType,
      responseTimeMs,
      xRobotsTag,
      headerCanonicalUrl,
      crawlDepth,
      inSitemap,
      rateLimited,
    });
  } catch (error) {
    if (throttle.checkpointFailed) throw error;
    const blocked = error instanceof CrawlTargetBlockedError;
    if (!blocked) console.warn(`[audit] failed to crawl ${url}:`, error instanceof Error ? error.message : error);
    return emptyPageResult({
      id,
      url,
      statusCode: 0,
      fetchClass: "error",
      redirectUrl: null,
      contentType: null,
      responseTimeMs: Math.round(performance.now() - startTime),
      xRobotsTag: null,
      headerCanonicalUrl: null,
      crawlDepth,
      inSitemap,
    });
  }
}
