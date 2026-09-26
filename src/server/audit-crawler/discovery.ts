/**
 * robots.txt + sitemap discovery (port of open-seo `discovery.ts`) over the SSRF-safe client.
 */
import { CRAWLER_USER_AGENT } from "./registry";
import { isProbablySitemapXml, parseSitemapXml } from "./sitemap";
import { readTextCapped, safeFetchFollow } from "./safe-fetch";
import { isCrawlableUrl } from "./url-policy";
import { isSameOrigin, normalizeUrl } from "./url-utils";

const SITEMAP_FETCH_TIMEOUT_MS = 15_000;
/** RFC 9309: parsers must handle ≥ 500 KiB and may ignore the rest. */
export const MAX_ROBOTS_TXT_BYTES = 500 * 1024;
const MAX_SITEMAP_DEPTH = 3;
const MAX_SITEMAP_DOCS = 300;
const SITEMAP_CONCURRENCY = 5;
const SITEMAP_RETRIES = 1;
const MAX_SITEMAP_BYTES = 10 * 1024 * 1024;

export type RobotsFetch = {
  /** null = missing/unreachable (allow all). */
  text: string | null;
  status: number | null;
  contentType: string | null;
  finalUrl: string | null;
  error: string | null;
};

/** Fetches `{origin}/robots.txt` (null text = missing → allow all). */
export async function fetchRobotsTxt(origin: string, userAgent = CRAWLER_USER_AGENT): Promise<RobotsFetch> {
  try {
    const { response, finalUrl } = await safeFetchFollow(`${origin}/robots.txt`, {
      headers: { "User-Agent": userAgent, Accept: "text/plain,*/*" },
      timeoutMs: 10_000,
    });
    const contentType = response.headers.get("content-type");
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { text: null, status: response.status, contentType, finalUrl, error: null };
    }
    const { text } = await readTextCapped(response, MAX_ROBOTS_TXT_BYTES);
    // An HTML page served at /robots.txt (SPA fallback) is not a robots file.
    if (/^\s*<(!doctype|html)/i.test(text)) return { text: null, status: response.status, contentType, finalUrl, error: "robots.txt returned an HTML page" };
    return { text, status: response.status, contentType, finalUrl, error: null };
  } catch (err) {
    return { text: null, status: null, contentType: null, finalUrl: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function isTimeoutError(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export type SitemapDocResult = {
  url: string;
  status: number | null;
  ok: boolean;
  kind: "urlset" | "sitemapindex" | "unknown";
  urlCount: number;
  nestedCount: number;
  withLastmod: number;
  error: string | null;
};

export async function fetchSitemapDocument(
  sitemapUrl: string,
  userAgent = CRAWLER_USER_AGENT,
): Promise<{ nestedSitemaps: string[]; pageUrls: string[]; timedOut: boolean; doc: SitemapDocResult }> {
  const normalized = normalizeUrl(sitemapUrl);
  const empty = (error: string | null, status: number | null = null) => ({
    nestedSitemaps: [],
    pageUrls: [],
    timedOut: false,
    doc: { url: sitemapUrl, status, ok: false, kind: "unknown" as const, urlCount: 0, nestedCount: 0, withLastmod: 0, error },
  });
  if (!normalized || !isCrawlableUrl(normalized)) return empty("Invalid sitemap URL");
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= SITEMAP_RETRIES; attempt++) {
    try {
      const { response, finalUrl } = await safeFetchFollow(normalized, {
        headers: { "User-Agent": userAgent, Accept: "application/xml,text/xml,*/*" },
        timeoutMs: SITEMAP_FETCH_TIMEOUT_MS,
      });
      const final = normalizeUrl(finalUrl, normalized);
      if (!final || !isSameOrigin(final, normalized)) {
        await response.body?.cancel().catch(() => {});
        return empty("Sitemap redirects to another site", response.status);
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return empty(`HTTP ${response.status}`, response.status);
      }
      const { text: body, truncated } = await readTextCapped(response, MAX_SITEMAP_BYTES);
      if (truncated) return empty("Sitemap larger than 10 MiB (skipped)", response.status);
      if (!isProbablySitemapXml(response.headers.get("content-type"), body)) return empty("Not an XML sitemap", response.status);
      const parsed = parseSitemapXml(body);
      const nestedSitemaps = parsed.sitemaps.map((loc) => normalizeUrl(loc, final)).filter((loc): loc is string => loc !== null);
      const pageUrls = parsed.urls.map((loc) => normalizeUrl(loc, final)).filter((loc): loc is string => loc !== null);
      return {
        nestedSitemaps,
        pageUrls,
        timedOut: false,
        doc: {
          url: sitemapUrl,
          status: response.status,
          ok: true,
          kind: parsed.kind,
          urlCount: pageUrls.length,
          nestedCount: nestedSitemaps.length,
          withLastmod: parsed.withLastmod,
          error: parsed.kind === "unknown" ? "No <urlset> or <sitemapindex> root element" : null,
        },
      };
    } catch (error) {
      lastError = error;
      if (!isTimeoutError(error) || attempt === SITEMAP_RETRIES) break;
    }
  }
  const r = empty(lastError instanceof Error ? lastError.message : "Fetch failed");
  return { ...r, timedOut: isTimeoutError(lastError) };
}

/**
 * Discover page URLs from robots.txt Sitemap lines ∪ /sitemap.xml (same-origin only), following
 * sitemap indexes up to depth 3. Result capped at `maxPages` (seeds can never exceed the budget).
 */
export async function discoverSitemapUrls(
  origin: string,
  robotsSitemaps: string[],
  maxPages: number,
  userAgent = CRAWLER_USER_AGENT,
): Promise<{ urls: string[]; docs: SitemapDocResult[] }> {
  const sources = new Set(robotsSitemaps);
  sources.add(`${origin}/sitemap.xml`);
  const maxDiscoveredUrls = Math.min(Math.max(maxPages * 20, 500), 50_000);
  const allUrls = new Set<string>();
  const docs: SitemapDocResult[] = [];
  const queue = Array.from(sources)
    .map((url) => normalizeUrl(url, origin))
    .filter((url): url is string => url !== null && isSameOrigin(url, origin))
    .map((url) => ({ url, depth: MAX_SITEMAP_DEPTH }));
  const seen = new Set<string>();
  let fetched = 0;

  while (queue.length > 0 && allUrls.size < maxDiscoveredUrls && fetched < MAX_SITEMAP_DOCS) {
    const batch = queue.splice(0, SITEMAP_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ url, depth }) => {
        if (!isSameOrigin(url, origin) || depth <= 0 || seen.has(url)) return;
        seen.add(url);
        fetched += 1;
        const result = await fetchSitemapDocument(url, userAgent);
        docs.push(result.doc);
        for (const pageUrl of result.pageUrls) {
          if (!isSameOrigin(pageUrl, origin)) continue;
          if (allUrls.size >= maxDiscoveredUrls) break;
          allUrls.add(pageUrl);
        }
        if (depth <= 1) return;
        for (const nested of result.nestedSitemaps) {
          if (isSameOrigin(nested, origin) && !seen.has(nested)) queue.push({ url: nested, depth: depth - 1 });
        }
      }),
    );
  }
  return { urls: Array.from(allUrls).slice(0, maxPages), docs };
}
