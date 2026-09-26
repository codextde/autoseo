import "server-only";
import { classifyAccess, formatRule, isAllowed, parseRobotsTxt } from "@/server/audit-crawler/robots";
import { BOT_PROFILES } from "@/server/crawlability/bots";
import { extractHtmlSignals, parseDirectives } from "@/server/crawlability/html-signals";
import { validateLlmsTxt } from "@/server/crawlability/llms-txt";
import { scoreCrawlability } from "@/server/crawlability/scoring";
import type { BotHttpResult, BotResult, CrawlabilityResult, HttpVerdict, LlmsFileCheck, PageCheck } from "@/server/crawlability/types";
import type { Rng } from "../random";

/**
 * Synthetic AI-crawlability check for the demo site, assembled exactly like `runCrawlabilityChecks`
 * (robots.txt parsing, per-bot matrix, llms.txt validation, HTML signals) from generated responses,
 * then scored with the crawlability module's own `scoreCrawlability`.
 */

/** The demo site's robots.txt (also stored on the demo site audits). */
export function demoRobotsTxt(origin: string) {
  return [
    `# robots.txt for ${new URL(origin).hostname}`,
    "User-agent: *",
    "Disallow: /cart",
    "Disallow: /checkout",
    "Disallow: /account",
    "Disallow: /search",
    "Allow: /",
    "",
    "# Opt out of model-training crawlers (search & assistant bots stay allowed)",
    "User-agent: GPTBot",
    "Disallow: /",
    "",
    "User-agent: Google-Extended",
    "Disallow: /",
    "",
    "User-agent: Bytespider",
    "Disallow: /",
    "",
    "User-agent: CCBot",
    "Disallow: /",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

function llmsTxt(origin: string, brand: string) {
  return [
    `# ${brand}`,
    "",
    `> ${brand} designs cushioned road and trail running shoes with recycled uppers, plus running apparel and gear.`,
    "",
    "Free shipping over $75 in the US, 60-day returns, and a size guide for every model.",
    "",
    "## Shoes",
    `- [Running shoes](${origin}/collections/running-shoes): road shoes for daily training and racing`,
    `- [Trail running shoes](${origin}/collections/trail): grippy, protective trail models incl. waterproof GTX`,
    `- [Wide fit](${origin}/collections/wide-fit): models available in wide widths`,
    "",
    "## Guides",
    `- [How to choose running shoes](${origin}/guides/how-to-choose-running-shoes): fit, drop and cushioning explained`,
    `- [Size guide](${origin}/size-guide): conversion tables and fit tips`,
    "",
    "## Company",
    `- [Sustainability](${origin}/sustainability): materials, recycling program and yearly report`,
    `- [Returns](${origin}/returns): 60-day trial and free exchanges`,
    "",
  ].join("\n");
}

function pageHtml(input: { origin: string; path: string; title: string; description: string; h1: string; words: number; jsonLdType: string; rng: Rng }) {
  const { origin, path, rng } = input;
  const vocab = ["cushioned", "ride", "trail", "grip", "recycled", "upper", "midsole", "foam", "stable", "daily", "miles", "runners", "fit", "breathable", "lightweight", "durable", "tested", "comfort", "outsole", "heel", "toe", "drop", "race", "training"];
  const paragraphs: string[] = [];
  let remaining = input.words;
  while (remaining > 0) {
    const n = Math.min(remaining, rng.int(40, 80));
    paragraphs.push(`<p>${Array.from({ length: n }, () => rng.pick(vocab)).join(" ")}.</p>`);
    remaining -= n;
  }
  const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@type": input.jsonLdType, name: input.title, url: `${origin}${path}` });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${input.title}</title>
<meta name="description" content="${input.description}"><meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${origin}${path}"><script type="application/ld+json">${jsonLd}</script></head>
<body><header><nav><a href="${origin}/">Home</a><a href="${origin}/collections/running-shoes">Running shoes</a><a href="${origin}/collections/trail">Trail</a><a href="${origin}/blog">Journal</a></nav></header>
<main><h1>${input.h1}</h1><h2>Why runners love it</h2>${paragraphs.join("\n")}</main>
<footer><a href="${origin}/about">About</a><a href="${origin}/returns">Returns</a></footer></body></html>`;
}

export function buildDemoCrawlability(input: {
  origin: string;
  brand: string;
  sitemapUrls: string[];
  checkedAt: Date;
  rng: Rng;
}): { result: CrawlabilityResult; score: number; scores: Record<string, number> } {
  const { origin, brand, rng } = input;
  const robotsText = demoRobotsTxt(origin);
  const robots = parseRobotsTxt(robotsText);

  /* ── llms.txt (present) + llms-full.txt (missing) ── */
  const llmsText = llmsTxt(origin, brand);
  const llms: LlmsFileCheck = {
    url: `${origin}/llms.txt`,
    present: true,
    status: 200,
    contentType: "text/plain; charset=utf-8",
    bytes: Buffer.byteLength(llmsText),
    validation: validateLlmsTxt(llmsText, { contentType: "text/plain; charset=utf-8" }),
    preview: llmsText.slice(0, 6000),
  };
  const llmsFull: LlmsFileCheck = { url: `${origin}/llms-full.txt`, present: false, status: 404, contentType: "text/html; charset=utf-8", bytes: 0, validation: null, preview: null };

  /* ── key pages: homepage + two shallow sitemap URLs (like the real check) ── */
  const home = `${origin}/`;
  const sample = input.sitemapUrls
    .filter((u) => u !== home && !u.includes("?"))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
    .slice(0, 2);
  const keyPages = [home, ...sample];
  const pageMeta = (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/") return { title: `${brand} — Running Shoes Built to Go the Distance`, h1: "Run further, recover faster", type: "Organization" };
    const label = path.split("/").filter(Boolean).pop()!.replace(/-/g, " ");
    const nice = label.replace(/\b\w/g, (c) => c.toUpperCase());
    return { title: `${nice} | ${brand}`, h1: nice, type: path.startsWith("/collections") ? "CollectionPage" : "WebPage" };
  };
  const pages: PageCheck[] = keyPages.map((url) => {
    const m = pageMeta(url);
    const html = pageHtml({
      origin,
      path: new URL(url).pathname,
      title: m.title,
      description: `${m.title}: cushioned road and trail running shoes with recycled uppers, 60-day returns and free exchanges.`,
      h1: m.h1,
      words: rng.int(480, 820),
      jsonLdType: m.type,
      rng,
    });
    const signals = extractHtmlSignals(html, url);
    return {
      url,
      finalUrl: url,
      status: 200,
      hops: [],
      ttfbMs: rng.int(160, 340),
      bytes: Buffer.byteLength(html),
      contentEncoding: "br",
      contentType: "text/html; charset=utf-8",
      xRobotsTag: null,
      headerCanonical: null,
      signals,
      directives: parseDirectives(signals.metaRobots, null),
      canonical: { href: signals.canonical, resolved: url, self: true, conflict: false },
      error: null,
    };
  });

  /* ── per-bot HTTP matrix (first three pages); the WAF challenges Perplexity's bots and meta-externalagent ── */
  const WAF_BLOCKED = new Set(["PerplexityBot", "Perplexity-User", "meta-externalagent"]);
  const httpFor = (token: string, hasAgent: boolean): BotHttpResult[] =>
    hasAgent
      ? pages.slice(0, 3).map((p) => {
          if (WAF_BLOCKED.has(token))
            return { url: p.url, status: 403, finalUrl: p.url, ttfbMs: rng.int(40, 90), words: null, challenge: true, verdict: "blocked" as HttpVerdict, reason: "Bot challenge / WAF page instead of content" };
          const words = p.signals?.wordCount ?? null;
          return { url: p.url, status: 200, finalUrl: p.url, ttfbMs: rng.int(150, 420), words, challenge: false, verdict: "ok" as HttpVerdict, reason: null };
        })
      : [];

  const robotsSample = [...new Set([...keyPages, ...input.sitemapUrls.slice(0, 300)])];
  const bots: BotResult[] = BOT_PROFILES.map((bot) => {
    const cls = classifyAccess(robots, bot.token);
    const pageVerdicts = keyPages.map((url) => {
      const v = isAllowed(robots, bot.token, url);
      return { url, allowed: v.allowed, rule: formatRule(v.rule), line: v.rule?.line ?? null };
    });
    const sampleBlocked = robotsSample.filter((u) => !isAllowed(robots, bot.token, u).allowed).length;
    const blockedShare = robotsSample.length ? sampleBlocked / robotsSample.length : cls.rootVerdict.allowed ? 0 : 1;
    const robotsStatus: BotResult["robots"]["status"] =
      cls.status === "blocked" ? "blocked" : blockedShare === 0 && pageVerdicts.every((p) => p.allowed) ? "allowed" : cls.status === "allowed" ? "partial" : cls.status;
    const decisive = cls.rootVerdict.rule ?? cls.group.rules.find((r) => r.type === "disallow" && r.path) ?? null;
    const httpPages = httpFor(bot.token, Boolean(bot.userAgent));
    const httpVerdict: HttpVerdict = !bot.userAgent
      ? "not_tested"
      : httpPages.some((p) => p.verdict === "blocked")
        ? "blocked"
        : httpPages.some((p) => p.verdict === "different")
          ? "different"
          : "ok";
    let overall: BotResult["overall"] = "allowed";
    if (robotsStatus === "blocked" || httpVerdict === "blocked") overall = "blocked";
    else if (robotsStatus === "partial" || httpVerdict === "different") overall = "partial";
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
      metaBlocked: false,
    };
  });

  /* ── sitemap index with three child sitemaps ── */
  const byPrefix = (prefix: string) => input.sitemapUrls.filter((u) => new URL(u).pathname.startsWith(prefix)).length;
  const productsN = byPrefix("/products");
  const blogN = byPrefix("/blog") + byPrefix("/guides");
  const pagesN = input.sitemapUrls.length - productsN - blogN;
  const docs = [
    { url: `${origin}/sitemap.xml`, status: 200, ok: true, kind: "sitemapindex" as const, urlCount: 0, nestedCount: 3, withLastmod: 0, error: null },
    { url: `${origin}/sitemap-products.xml`, status: 200, ok: true, kind: "urlset" as const, urlCount: productsN, nestedCount: 0, withLastmod: productsN, error: null },
    { url: `${origin}/sitemap-pages.xml`, status: 200, ok: true, kind: "urlset" as const, urlCount: pagesN, nestedCount: 0, withLastmod: pagesN, error: null },
    { url: `${origin}/sitemap-blog.xml`, status: 200, ok: true, kind: "urlset" as const, urlCount: blogN, nestedCount: 0, withLastmod: Math.max(0, blogN - 4), error: null },
  ];

  const base: Omit<CrawlabilityResult, "categories" | "findings"> = {
    version: 1,
    origin,
    checkedAt: input.checkedAt.toISOString(),
    robots: {
      url: `${origin}/robots.txt`,
      status: 200,
      found: true,
      bytes: Buffer.byteLength(robotsText),
      contentType: "text/plain; charset=utf-8",
      error: null,
      sitemaps: robots.sitemaps,
      groupCount: robots.groups.length,
      warnings: robots.warnings.slice(0, 50),
      raw: robotsText,
      unreachable: false,
    },
    bots,
    pages,
    browserBlocked: false,
    llms: { txt: llms, full: llmsFull },
    sitemap: { found: true, docs, totalUrls: input.sitemapUrls.length, sampleUrls: input.sitemapUrls.slice(0, 300) },
  };
  const { score, categories, findings } = scoreCrawlability(base);
  return {
    result: { ...base, categories, findings },
    score,
    scores: Object.fromEntries(categories.map((c) => [c.key, c.score])),
  };
}
