import "server-only";
/**
 * AI crawler access check (finseo "Crawlability"): robots.txt per AI bot, llms.txt, meta robots /
 * X-Robots-Tag, HTTP responses per bot user agent vs a browser, raw-HTML rendering, sitemap,
 * structured data, canonical, page weight / TTFB. All fetches go through the SSRF-safe client.
 */
import { discoverSitemapUrls, fetchRobotsTxt } from "../audit-crawler/discovery";
import { CHALLENGE_BODY_MARKERS, parseLinkHeaderCanonical } from "../audit-crawler/fetch-page";
import { analyzeHtml } from "../audit-crawler/page-analyzer";
import { classifyAccess, formatRule, isAllowed, parseRobotsTxt } from "../audit-crawler/robots";
import { readTextCapped, resolveStartUrl, safeFetchFollow } from "../audit-crawler/safe-fetch";
import { isCrawlableUrl, normalizeStartUrlInput } from "../audit-crawler/url-policy";
import { isSameOrigin, normalizeUrl } from "../audit-crawler/url-utils";
import { BOT_PROFILES, BROWSER_USER_AGENT } from "./bots";
import { extractHtmlSignals, parseDirectives } from "./html-signals";
import { validateLlmsTxt } from "./llms-txt";
import type { BotHttpResult, BotResult, CrawlabilityResult, HttpVerdict, LlmsFileCheck, PageCheck } from "./types";

const MAX_PAGES = 5;
const MATRIX_PAGES = 3;
const MAX_HTML = 2 * 1024 * 1024;
const MATRIX_CONCURRENCY = 4;

const BROWSER_HEADERS = {
  "User-Agent": BROWSER_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
};

export type ProgressFn = (step: string, done: number, total: number) => Promise<void> | void;

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift()!;
        await fn(item);
        await new Promise((r) => setTimeout(r, 120));
      }
    }),
  );
}

async function checkLlmsFile(url: string, full: boolean): Promise<LlmsFileCheck> {
  try {
    const { response } = await safeFetchFollow(url, { headers: { ...BROWSER_HEADERS, Accept: "text/plain,text/markdown,*/*" }, timeoutMs: 15_000 });
    const contentType = response.headers.get("content-type");
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { url, present: false, status: response.status, contentType, bytes: 0, validation: null, preview: null };
    }
    const { text, bytes } = await readTextCapped(response, full ? 4 * 1024 * 1024 : 1024 * 1024);
    const validation = validateLlmsTxt(text, { contentType, full });
    const isHtml = validation.errors.some((e) => e.includes("HTML page"));
    return {
      url,
      present: !isHtml,
      status: response.status,
      contentType,
      bytes,
      validation,
      preview: isHtml ? null : text.slice(0, full ? 3000 : 6000),
    };
  } catch (err) {
    return { url, present: false, status: null, contentType: null, bytes: 0, validation: null, preview: err instanceof Error ? null : null };
  }
}

async function checkPage(url: string): Promise<{ check: PageCheck; html: string | null }> {
  try {
    const { response, finalUrl, hops, ttfbMs } = await safeFetchFollow(url, { headers: BROWSER_HEADERS, timeoutMs: 20_000 });
    const contentType = response.headers.get("content-type");
    const xRobotsTag = response.headers.get("x-robots-tag");
    const headerCanonical = parseLinkHeaderCanonical(response.headers.get("link"), finalUrl);
    const isHtml = (contentType ?? "").includes("html");
    const { text, bytes } = isHtml ? await readTextCapped(response, MAX_HTML) : { text: "", bytes: 0 };
    if (!isHtml) await response.body?.cancel().catch(() => {});
    const signals = isHtml && text ? extractHtmlSignals(text, finalUrl) : null;
    const directives = parseDirectives(signals?.metaRobots ?? [], xRobotsTag);
    const resolved = signals?.canonical ? normalizeUrl(signals.canonical, finalUrl) : null;
    const normalizedFinal = normalizeUrl(finalUrl);
    return {
      html: isHtml ? text : null,
      check: {
        url,
        finalUrl,
        status: response.status,
        hops: hops.map((h) => ({ url: h.url, status: h.status })),
        ttfbMs,
        bytes,
        contentEncoding: response.headers.get("content-encoding"),
        contentType,
        xRobotsTag,
        headerCanonical,
        signals,
        directives,
        canonical: {
          href: signals?.canonical ?? null,
          resolved,
          self: resolved ? resolved === normalizedFinal || resolved.replace(/\/$/, "") === (normalizedFinal ?? "").replace(/\/$/, "") : null,
          conflict: Boolean(resolved && headerCanonical && resolved !== headerCanonical),
        },
        error: null,
      },
    };
  } catch (err) {
    return {
      html: null,
      check: {
        url,
        finalUrl: null,
        status: null,
        hops: [],
        ttfbMs: null,
        bytes: 0,
        contentEncoding: null,
        contentType: null,
        xRobotsTag: null,
        headerCanonical: null,
        signals: null,
        directives: [],
        canonical: { href: null, resolved: null, self: null, conflict: false },
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function isChallenge(status: number, headers: { get(name: string): string | null }, body: string): boolean {
  if (headers.get("cf-mitigated")) return true;
  const snippet = body.slice(0, 6000).toLowerCase();
  if ((status === 403 || status === 503 || status === 429) && CHALLENGE_BODY_MARKERS.some((m) => snippet.includes(m))) return true;
  return /captcha|cf-chl-|challenge-platform|px-captcha|datadome|perimeterx|access denied/i.test(snippet) && status >= 400;
}

async function fetchAsBot(url: string, userAgent: string, baseline: { status: number | null; words: number | null; finalUrl: string | null }): Promise<BotHttpResult> {
  try {
    const { response, finalUrl, ttfbMs } = await safeFetchFollow(url, {
      headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      timeoutMs: 15_000,
    });
    const isHtml = (response.headers.get("content-type") ?? "").includes("html");
    const { text } = isHtml || response.status >= 400 ? await readTextCapped(response, 1024 * 1024) : { text: "" };
    if (!isHtml && response.status < 400) await response.body?.cancel().catch(() => {});
    const status = response.status;
    const challenge = isChallenge(status, response.headers, text);
    const words = isHtml && status < 400 && !challenge ? analyzeHtml(text, finalUrl, status, 0).wordCount : null;
    let verdict: HttpVerdict = "ok";
    let reason: string | null = null;
    const baselineOk = baseline.status !== null && baseline.status < 400;
    if (!baselineOk) {
      verdict = "inconclusive";
      reason = "The page did not load for a regular browser either.";
    } else if (challenge) {
      verdict = "blocked";
      reason = "Bot challenge / WAF page instead of content";
    } else if (status >= 400) {
      verdict = "blocked";
      reason = `HTTP ${status} while browsers get ${baseline.status}`;
    } else if (baseline.finalUrl && finalUrl && normalizeUrl(finalUrl) !== normalizeUrl(baseline.finalUrl) && !isSameOrigin(finalUrl, baseline.finalUrl)) {
      verdict = "different";
      reason = `Redirected to ${finalUrl}`;
    } else if (baseline.words && baseline.words >= 50 && words !== null && words < baseline.words * 0.5) {
      verdict = "different";
      reason = `Only ${words} words vs ${baseline.words} for browsers`;
    }
    return { url, status, finalUrl, ttfbMs, words, challenge, verdict, reason };
  } catch (err) {
    return { url, status: null, finalUrl: null, ttfbMs: null, words: null, challenge: false, verdict: "error", reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function runCrawlabilityChecks(input: { origin: string; urls?: string[] }, progress?: ProgressFn): Promise<Omit<CrawlabilityResult, "categories" | "findings">> {
  const total = 6;
  await progress?.("Resolving site", 0, total);
  const start = normalizeStartUrlInput(input.origin);
  const home = await resolveStartUrl(start, BROWSER_USER_AGENT);
  const origin = new URL(home).origin;

  await progress?.("Reading robots.txt", 1, total);
  const robotsFetch = await fetchRobotsTxt(origin, BROWSER_USER_AGENT);
  const robotsUnreachable = robotsFetch.status !== null && robotsFetch.status >= 500;
  const robots = parseRobotsTxt(robotsFetch.text);

  await progress?.("Checking sitemaps & llms.txt", 2, total);
  const [sitemap, llmsTxt, llmsFull] = await Promise.all([
    discoverSitemapUrls(origin, robots.sitemaps, 500, BROWSER_USER_AGENT),
    checkLlmsFile(`${origin}/llms.txt`, false),
    checkLlmsFile(`${origin}/llms-full.txt`, true),
  ]);

  // Key pages: homepage + requested URLs (same site) or a sitemap sample.
  const extra = (input.urls ?? [])
    .map((u) => {
      try {
        return normalizeUrl(normalizeStartUrlInput(u));
      } catch {
        return null;
      }
    })
    .filter((u): u is string => !!u && isCrawlableUrl(u) && isSameOrigin(u, origin));
  const keyPages = [normalizeUrl(home) ?? home];
  for (const u of extra) if (!keyPages.includes(u)) keyPages.push(u);
  if (keyPages.length === 1) {
    const sample = sitemap.urls
      .filter((u) => u !== keyPages[0] && isSameOrigin(u, origin) && !/\.(md|txt|xml|json|pdf|jpe?g|png|gif|webp|svg|zip|csv)$/i.test(new URL(u).pathname))
      .sort((a, b) => a.split("/").length - b.split("/").length)
      .slice(0, 2);
    keyPages.push(...sample);
  }
  const pages = keyPages.slice(0, MAX_PAGES);

  await progress?.("Analyzing pages", 3, total);
  const pageResults: Array<{ check: PageCheck; html: string | null }> = [];
  for (const url of pages) pageResults.push(await checkPage(url));
  const browserBlocked = pageResults[0]?.check.status == null || (pageResults[0]?.check.status ?? 0) >= 400;

  await progress?.("Testing AI crawler user agents", 4, total);
  const matrixPages = pageResults.slice(0, MATRIX_PAGES).map((p) => ({
    url: p.check.url,
    baseline: { status: p.check.status, words: p.check.signals?.wordCount ?? null, finalUrl: p.check.finalUrl },
  }));
  const httpByBot = new Map<string, BotHttpResult[]>();
  const tasks = BOT_PROFILES.filter((b) => b.userAgent).flatMap((b) => matrixPages.map((p) => ({ bot: b, page: p })));
  await pool(tasks, MATRIX_CONCURRENCY, async ({ bot, page }) => {
    const r = await fetchAsBot(page.url, bot.userAgent!, page.baseline);
    const list = httpByBot.get(bot.token) ?? [];
    list.push(r);
    httpByBot.set(bot.token, list);
  });

  await progress?.("Scoring", 5, total);
  // Content sample for robots evaluation: key pages + sitemap URLs (≤ 300).
  const robotsSample = [...new Set([...pages, ...sitemap.urls.slice(0, 300)])];
  const bots: BotResult[] = BOT_PROFILES.map((bot) => {
    const cls = robotsUnreachable
      ? { status: "blocked" as const, group: { source: "none" as const, userAgents: [], rules: [], crawlDelay: null }, rootVerdict: { allowed: false, rule: null } }
      : classifyAccess(robots, bot.token);
    const pageVerdicts = pages.map((url) => {
      const v = robotsUnreachable ? { allowed: false, rule: null } : isAllowed(robots, bot.token, url);
      return { url, allowed: v.allowed, rule: formatRule(v.rule), line: v.rule?.line ?? null };
    });
    const sampleBlocked = robotsUnreachable ? robotsSample.length : robotsSample.filter((u) => !isAllowed(robots, bot.token, u).allowed).length;
    const blockedShare = robotsSample.length ? sampleBlocked / robotsSample.length : cls.rootVerdict.allowed ? 0 : 1;
    // Rules that only exclude cart/admin/search paths (no sampled content URL affected) count as "allowed".
    const robotsStatus: BotResult["robots"]["status"] =
      cls.status === "blocked" ? "blocked" : blockedShare === 0 && pageVerdicts.every((p) => p.allowed) ? "allowed" : cls.status === "allowed" ? "partial" : cls.status;
    const decisive = cls.rootVerdict.rule ?? cls.group.rules.find((r) => r.type === "disallow" && r.path) ?? null;
    const httpPages = (httpByBot.get(bot.token) ?? []).sort((a, b) => pages.indexOf(a.url) - pages.indexOf(b.url));
    const httpVerdict: HttpVerdict = !bot.userAgent
      ? "not_tested"
      : httpPages.some((p) => p.verdict === "blocked")
        ? "blocked"
        : httpPages.some((p) => p.verdict === "different")
          ? "different"
          : httpPages.length && httpPages.every((p) => p.verdict === "inconclusive")
            ? "inconclusive"
            : httpPages.some((p) => p.verdict === "error")
              ? "error"
              : "ok";
    const metaBlocked = pageResults.some((p) =>
      p.check.directives.some((d) => d.directive === "noindex" && (d.scope === "all" || d.scope === bot.token.toLowerCase())),
    );
    let overall: BotResult["overall"] = "allowed";
    if (robotsStatus === "blocked" || httpVerdict === "blocked") overall = "blocked";
    else if (robotsStatus === "partial" || httpVerdict === "different" || metaBlocked) overall = "partial";
    else if (httpVerdict === "error" || httpVerdict === "inconclusive") overall = robotsStatus === "allowed" ? "allowed" : "unknown";
    return {
      token: bot.token,
      name: bot.name,
      company: bot.company,
      purpose: bot.purpose,
      fetches: Boolean(bot.userAgent),
      robots: {
        status: robotsStatus,
        source: cls.group.source,
        rule: formatRule(decisive),
        ruleLine: decisive?.line ?? null,
        userAgents: cls.group.userAgents,
        crawlDelay: cls.group.crawlDelay,
        pages: pageVerdicts,
        blockedShare,
        sampleSize: robotsSample.length,
        disallowRules: cls.group.rules.filter((r) => r.type === "disallow" && r.path).length,
      },
      http: { verdict: httpVerdict, pages: httpPages },
      overall,
      metaBlocked,
    };
  });

  const sitemapTotal = sitemap.docs.filter((d) => d.ok && d.kind === "urlset").reduce((a, d) => a + d.urlCount, 0);
  return {
    version: 1,
    origin,
    checkedAt: new Date().toISOString(),
    robots: {
      url: `${origin}/robots.txt`,
      status: robotsFetch.status,
      found: robotsFetch.text !== null,
      bytes: robotsFetch.text ? Buffer.byteLength(robotsFetch.text) : 0,
      contentType: robotsFetch.contentType,
      error: robotsFetch.error,
      sitemaps: robots.sitemaps,
      groupCount: robots.groups.length,
      warnings: robots.warnings.slice(0, 50),
      raw: robotsFetch.text ? robotsFetch.text.slice(0, 20_000) : null,
      unreachable: robotsUnreachable,
    },
    bots,
    pages: pageResults.map((p) => p.check),
    browserBlocked,
    llms: { txt: llmsTxt, full: llmsFull },
    sitemap: {
      found: sitemap.docs.some((d) => d.ok),
      docs: sitemap.docs.slice(0, 50),
      totalUrls: sitemapTotal || sitemap.urls.length,
      sampleUrls: sitemap.urls.slice(0, 300),
    },
  };
}
