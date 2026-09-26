import "server-only";
import { eq } from "drizzle-orm";
import { auditSchedules, crawlabilityChecks, siteAuditIssues, siteAuditLighthouse, siteAuditPageLinks, siteAuditPages, siteAudits } from "@/server/db/schema";
import { newId } from "@/server/db/schema/_helpers";
import { deterministicAuditRowId } from "@/server/audit-crawler/ids";
import { issueRows } from "@/server/audit-crawler/issue-rows";
import { buildStoredPayloadFromReport, type RawLighthouseAudit, type RawLighthouseReport } from "@/server/audit-crawler/lighthouse/stored-payload";
import { countInlinks, findBrokenInternalLinks, findDuplicates, findOrphanPages, findRedirectChainsAndLoops, type SlimPage } from "@/server/audit-crawler/multipage-checks";
import { runPageReporters } from "@/server/audit-crawler/page-reporters";
import { getIssueDescriptor } from "@/server/audit-crawler/registry";
import { computeHealthScore, summarizeIssueCounts } from "@/server/audit-crawler/scoring";
import type { CrawledPageResult, DetectedIssue } from "@/server/audit-crawler/types";
import type { Rng } from "../random";
import { buildDemoCrawlability, demoRobotsTxt } from "./audit-crawlability";
import { buildDemoSite } from "./audit-site";
import { chunks, type DemoModule, type DemoModuleCtx } from "./context";

/**
 * Demo data for Site Audit + Crawlability: four completed audits (fix levels 0→3, rising health
 * score) produced by the audit module's own reporters / cross-page checks / scoring over a synthetic
 * crawl, Lighthouse results on the latest audit, and one completed AI-crawlability check.
 * Insert-only — nothing is fetched, no jobs are enqueued, no schedules are created.
 */

const DAY = 86_400_000;
/** Audit ages in days (oldest first) → fix levels 0..3. */
const AUDIT_AGES = [56, 38, 19, 3];

async function clear(ctx: DemoModuleCtx) {
  const { tx, projectId } = ctx;
  // Pages, links, issues, Lighthouse rows and frontier cascade from site_audits.
  await tx.delete(siteAudits).where(eq(siteAudits.projectId, projectId));
  await tx.delete(crawlabilityChecks).where(eq(crawlabilityChecks.projectId, projectId));
  await tx.delete(auditSchedules).where(eq(auditSchedules.projectId, projectId));
}

function pageRow(auditId: string, p: CrawledPageResult, extra: { score: number | null; issueCount: number; inlinkCount: number; crawledAt: Date }) {
  const internal = p.links.filter((l) => l.isInternal).length;
  return {
    id: p.id,
    auditId,
    url: p.url,
    statusCode: p.statusCode,
    fetchClass: p.fetchClass,
    redirectUrl: p.redirectUrl,
    contentType: p.contentType,
    title: p.title,
    metaDescription: p.metaDescription,
    canonicalUrl: p.canonicalUrl,
    robotsMeta: p.robotsMeta,
    xRobotsTag: p.xRobotsTag,
    headerCanonicalUrl: p.headerCanonicalUrl,
    ogTitle: p.ogTitle,
    ogDescription: p.ogDescription,
    ogImage: p.ogImage,
    h1Count: p.h1Count,
    h2Count: p.h2Count,
    h3Count: p.h3Count,
    h4Count: p.h4Count,
    h5Count: p.h5Count,
    h6Count: p.h6Count,
    h1s: p.h1s,
    headingOrder: p.headingOrder,
    wordCount: p.wordCount,
    contentHash: p.contentHash,
    htmlBytes: p.htmlBytes,
    imagesTotal: p.imagesTotal,
    imagesMissingAlt: p.imagesMissingAlt,
    images: p.images,
    internalLinkCount: internal,
    externalLinkCount: p.links.length - internal,
    inlinkCount: extra.inlinkCount,
    hasStructuredData: p.hasStructuredData,
    structuredDataTypes: p.structuredDataTypes,
    hreflangTags: p.hreflangTags,
    lang: p.lang,
    isIndexable: p.isIndexable,
    crawlDepth: p.crawlDepth,
    inSitemap: p.inSitemap,
    responseTimeMs: p.responseTimeMs,
    score: extra.score,
    issueCount: extra.issueCount,
    crawledAt: extra.crawledAt,
  };
}

/* ───────────────────────────── Lighthouse (synthetic PSI report) ───────────────────────────── */

function metric(score: number, numericValue: number, displayValue: string): RawLighthouseAudit {
  return { score, numericValue, displayValue, scoreDisplayMode: "numeric" };
}

function lighthouseReport(url: string, strategy: "mobile" | "desktop", rng: Rng, missingAlt: number): RawLighthouseReport {
  const mobile = strategy === "mobile";
  const perf = mobile ? rng.float(0.58, 0.79) : rng.float(0.84, 0.96);
  const lcp = mobile ? rng.int(2600, 4200) : rng.int(1100, 1900);
  const tbt = mobile ? rng.int(220, 520) : rng.int(40, 140);
  const cls = Math.round(rng.float(0.01, mobile ? 0.14 : 0.06) * 1000) / 1000;
  const fcp = mobile ? rng.int(1500, 2600) : rng.int(500, 1000);
  const ttfb = rng.int(180, 520);
  const renderBlockingMs = mobile ? rng.int(380, 820) : rng.int(90, 240);
  const unusedJsBytes = rng.int(90_000, 210_000);
  const audits: Record<string, RawLighthouseAudit> = {
    "first-contentful-paint": metric(mobile ? 0.62 : 0.94, fcp, `${(fcp / 1000).toFixed(1)} s`),
    "largest-contentful-paint": metric(mobile ? 0.44 : 0.9, lcp, `${(lcp / 1000).toFixed(1)} s`),
    "total-blocking-time": metric(mobile ? 0.55 : 0.97, tbt, `${tbt} ms`),
    "cumulative-layout-shift": metric(cls < 0.1 ? 0.95 : 0.72, cls, cls.toFixed(3)),
    "speed-index": metric(mobile ? 0.6 : 0.93, fcp + 900, `${((fcp + 900) / 1000).toFixed(1)} s`),
    interactive: metric(mobile ? 0.58 : 0.95, lcp + 600, `${((lcp + 600) / 1000).toFixed(1)} s`),
    "server-response-time": { score: ttfb < 600 ? 1 : 0.5, numericValue: ttfb, displayValue: `Root document took ${ttfb} ms`, scoreDisplayMode: "metricSavings" },
    "render-blocking-resources": {
      title: "Eliminate render-blocking resources",
      description: "Resources are blocking the first paint of your page. Consider delivering critical JS/CSS inline and deferring all non-critical JS/styles.",
      score: mobile ? 0.3 : 0.7,
      scoreDisplayMode: "metricSavings",
      displayValue: `Potential savings of ${renderBlockingMs} ms`,
      details: {
        overallSavingsMs: renderBlockingMs,
        items: [
          { url: `${new URL(url).origin}/cdn/theme.css`, totalBytes: 48_210, wastedMs: Math.round(renderBlockingMs * 0.6) },
          { url: `${new URL(url).origin}/cdn/vendor.js`, totalBytes: 88_540, wastedMs: Math.round(renderBlockingMs * 0.4) },
        ],
      },
    },
    "unused-javascript": {
      title: "Reduce unused JavaScript",
      description: "Reduce unused JavaScript and defer loading scripts until they are required to decrease bytes consumed by network activity.",
      score: 0.45,
      scoreDisplayMode: "metricSavings",
      displayValue: `Potential savings of ${Math.round(unusedJsBytes / 1024)} KiB`,
      details: { overallSavingsBytes: unusedJsBytes, overallSavingsMs: mobile ? 450 : 120, items: [{ url: `${new URL(url).origin}/cdn/vendor.js`, totalBytes: 212_400, wastedBytes: unusedJsBytes }] },
    },
    "modern-image-formats": {
      title: "Serve images in modern formats",
      description: "Image formats like WebP and AVIF often provide better compression than PNG or JPEG.",
      score: 0.62,
      scoreDisplayMode: "metricSavings",
      displayValue: "Potential savings of 64 KiB",
      details: { overallSavingsBytes: 65_536, items: [{ url: `${new URL(url).origin}/cdn/hero.jpg`, totalBytes: 182_000, wastedBytes: 65_536 }] },
    },
    "color-contrast": {
      title: "Background and foreground colors do not have a sufficient contrast ratio.",
      description: "Low-contrast text is difficult or impossible for many users to read.",
      score: 0,
      scoreDisplayMode: "binary",
      details: { items: [{ nodeLabel: "Free shipping over $75", snippet: '<p class="promo-bar">' }] },
    },
    "image-alt": {
      title: "Image elements do not have `[alt]` attributes",
      description: "Informative elements should aim for short, descriptive alternate text.",
      score: missingAlt > 0 ? 0 : 1,
      scoreDisplayMode: "binary",
      details: { items: missingAlt > 0 ? [{ nodeLabel: "product image", snippet: '<img src="/cdn/images/product-2.webp">' }] : [] },
    },
    "errors-in-console": {
      title: "Browser errors were logged to the console",
      description: "Errors logged to the console indicate unresolved problems.",
      score: mobile ? 0 : 1,
      scoreDisplayMode: "binary",
      details: { items: mobile ? [{ source: "network", description: "Failed to load resource: the server responded with a status of 404 ()" }] : [] },
    },
    "link-text": { title: "Links have descriptive text", description: "Descriptive link text helps search engines understand your content.", score: 1, scoreDisplayMode: "binary" },
  };
  const acc = rng.float(0.86, 0.95);
  return {
    requestedUrl: url,
    finalUrl: url,
    lighthouseVersion: "12.6.0",
    categories: {
      performance: {
        score: Math.round(perf * 100) / 100,
        auditRefs: [
          "first-contentful-paint",
          "largest-contentful-paint",
          "total-blocking-time",
          "cumulative-layout-shift",
          "speed-index",
          "interactive",
          "server-response-time",
          "render-blocking-resources",
          "unused-javascript",
          "modern-image-formats",
        ].map((id) => ({ id })),
      },
      accessibility: { score: Math.round(acc * 100) / 100, auditRefs: [{ id: "color-contrast" }, { id: "image-alt" }] },
      "best-practices": { score: mobile ? 0.93 : 1, auditRefs: [{ id: "errors-in-console" }] },
      seo: { score: rng.float(0.92, 1) > 0.97 ? 1 : 0.92, auditRefs: [{ id: "link-text" }] },
    },
    audits,
  };
}

/* ───────────────────────────── insert ───────────────────────────── */

async function insert(ctx: DemoModuleCtx): Promise<Record<string, number>> {
  const { tx, projectId, now } = ctx;
  const origin = `https://${ctx.domain}`;
  const nowMs = now.getTime();
  const counts = { audits: 0, auditPages: 0, auditIssues: 0, auditLinks: 0, lighthouse: 0, crawlabilityChecks: 0 };
  const scores: number[] = [];
  let latestSitemap: string[] = [];

  for (let level = 0; level < AUDIT_AGES.length; level++) {
    const auditId = newId("sau");
    const rng = ctx.rng(`audit.site.${level}`);
    const startedAt = new Date(nowMs - AUDIT_AGES[level]! * DAY - rng.int(2, 9) * 3_600_000);
    const { pages, startUrl } = buildDemoSite({ auditId, origin, brand: ctx.brandName, level, rng });

    /* issues: per-page reporters + cross-page checks (same functions as the crawler/finalize) */
    const slim: SlimPage[] = pages.map((p) => ({
      id: p.id,
      url: p.url,
      statusCode: p.statusCode,
      fetchClass: p.fetchClass,
      title: p.title,
      metaDescription: p.metaDescription,
      contentHash: p.contentHash,
      redirectUrl: p.redirectUrl,
      wordCount: p.wordCount,
      isIndexable: p.isIndexable,
      canonicalUrl: p.canonicalUrl,
      headerCanonicalUrl: p.headerCanonicalUrl,
    }));
    const graph = pages.map((p) => ({
      id: p.id,
      url: p.url,
      statusCode: p.statusCode,
      fetchClass: p.fetchClass,
      redirectUrl: p.redirectUrl,
      internalTargets: p.links.filter((l) => l.isInternal).map((l) => l.targetUrl),
    }));
    const issues: DetectedIssue[] = [
      ...pages.flatMap((p) => runPageReporters(p)),
      ...findDuplicates(slim),
      ...findRedirectChainsAndLoops(slim),
      ...findBrokenInternalLinks(graph),
      ...findOrphanPages(graph, startUrl),
    ];
    const rows = issueRows(auditId, issues);
    const withSeverity = rows.map((r) => ({ pageId: r.pageId, issueType: r.issueType, severity: getIssueDescriptor(r.issueType)!.severity }));
    const { score, pageScores } = computeHealthScore(
      pages.map((p) => ({ id: p.id, statusCode: p.statusCode })),
      withSeverity,
    );
    const issueCounts = summarizeIssueCounts(withSeverity);
    const inlinks = countInlinks(graph);
    const okPages = pages.filter((p) => p.statusCode > 0);
    const avgResponseMs = okPages.length ? Math.round(okPages.reduce((a, p) => a + p.responseTimeMs, 0) / okPages.length) : null;
    const crawlMs = pages.length * rng.int(900, 1600);
    const completedAt = new Date(startedAt.getTime() + crawlMs + 45_000);
    const latest = level === AUDIT_AGES.length - 1;

    /* Lighthouse on the latest audit: home, two collections, a product, a journal post × mobile/desktop */
    const lhUrls = latest
      ? [startUrl, `${origin}/collections/running-shoes`, `${origin}/collections/trail`, `${origin}/products/stridewell-cloudrun-4`, `${origin}/blog/best-running-shoes`].filter((u) =>
          pages.some((p) => p.url === u),
        )
      : [];
    const lhRng = ctx.rng("audit.lighthouse");
    const lighthouseRows = lhUrls.flatMap((url) =>
      (["mobile", "desktop"] as const).map((strategy) => {
        const page = pages.find((p) => p.url === url)!;
        const payload = buildStoredPayloadFromReport(lighthouseReport(url, strategy, lhRng, page.imagesMissingAlt), { url, strategy, source: "pagespeed-insights" });
        payload.metadata.fetchedAt = new Date(completedAt.getTime() - lhRng.int(30, 300) * 1000).toISOString();
        const json = JSON.stringify(payload);
        return {
          id: deterministicAuditRowId(auditId, url, strategy),
          auditId,
          pageId: page.id,
          url,
          strategy,
          provider: "psi" as const,
          status: "done" as const,
          performanceScore: payload.scores.performance,
          accessibilityScore: payload.scores.accessibility,
          bestPracticesScore: payload.scores["best-practices"],
          seoScore: payload.scores.seo,
          lcpMs: payload.metrics.largestContentfulPaint.numericValue,
          cls: payload.metrics.cumulativeLayoutShift.numericValue,
          inpMs: payload.metrics.interactionToNextPaint.numericValue,
          ttfbMs: payload.metrics.serverResponseTime.numericValue,
          errorMessage: null,
          payload: payload as unknown as Record<string, unknown>,
          payloadSizeBytes: Buffer.byteLength(json),
          costUsd: null,
          createdAt: completedAt,
          updatedAt: completedAt,
        };
      }),
    );

    await tx.insert(siteAudits).values({
      id: auditId,
      projectId,
      startUrl,
      status: "completed",
      currentPhase: "completed",
      trigger: "manual",
      config: { maxPages: 200, lighthouseStrategy: latest ? "auto" : "none", lighthouseProvider: "psi", concurrency: 8 },
      pagesCrawled: pages.length,
      pagesTotal: pages.length,
      lighthouseTotal: lighthouseRows.length,
      lighthouseCompleted: lighthouseRows.length,
      lighthouseFailed: 0,
      score,
      issueCounts,
      avgResponseMs,
      crawlCompleted: true,
      rateLimited: false,
      robotsTxt: demoRobotsTxt(origin),
      robotsFetched: true,
      chunkNo: Math.ceil(pages.length / 40),
      createdBy: ctx.userId,
      startedAt,
      completedAt,
      createdAt: startedAt,
      updatedAt: completedAt,
    });
    const pageRows = pages.map((p, i) =>
      pageRow(auditId, p, {
        score: pageScores.get(p.id)?.score ?? null,
        issueCount: pageScores.get(p.id)?.issueCount ?? 0,
        inlinkCount: inlinks.get(p.url) ?? 0,
        crawledAt: new Date(startedAt.getTime() + 20_000 + Math.round((i / pages.length) * crawlMs)),
      }),
    );
    for (const part of chunks(pageRows, 250)) await tx.insert(siteAuditPages).values(part);
    const linkRows = pages
      .filter((p) => p.links.length > 0)
      .map((p) => ({ pageId: p.id, auditId, links: p.links.map((l) => ({ u: l.targetUrl, a: l.anchor, i: l.isInternal, n: l.isNofollow })) }));
    for (const part of chunks(linkRows, 250)) await tx.insert(siteAuditPageLinks).values(part);
    for (const part of chunks(rows, 500)) await tx.insert(siteAuditIssues).values(part.map((r) => ({ ...r, createdAt: completedAt })));
    if (lighthouseRows.length) await tx.insert(siteAuditLighthouse).values(lighthouseRows);

    counts.audits++;
    counts.auditPages += pageRows.length;
    counts.auditIssues += rows.length;
    counts.auditLinks += linkRows.length;
    counts.lighthouse += lighthouseRows.length;
    scores.push(score ?? 0);
    if (latest) latestSitemap = pages.filter((p) => p.inSitemap && p.statusCode === 200).map((p) => p.url);
  }

  /* ── one completed AI crawlability check (2 days ago) ── */
  const crwRng = ctx.rng("audit.crawlability");
  const createdAt = new Date(nowMs - 2 * DAY - crwRng.int(1, 6) * 3_600_000);
  const completedAt = new Date(createdAt.getTime() + crwRng.int(25, 70) * 1000);
  const crawl = buildDemoCrawlability({ origin, brand: ctx.brandName, sitemapUrls: latestSitemap, checkedAt: completedAt, rng: crwRng });
  await tx.insert(crawlabilityChecks).values({
    projectId,
    status: "completed",
    trigger: "manual",
    origin,
    urls: [],
    score: crawl.score,
    scores: crawl.scores,
    result: crawl.result as unknown as Record<string, unknown>,
    progress: { step: "Done", done: 1, total: 1 },
    llmsTxtStatus: "idle",
    createdBy: ctx.userId,
    startedAt: createdAt,
    completedAt,
    createdAt,
    updatedAt: completedAt,
  });
  counts.crawlabilityChecks = 1;

  return { ...counts, scoreFirst: scores[0] ?? 0, scoreLatest: scores[scores.length - 1] ?? 0, crawlabilityScore: crawl.score };
}

export default { name: "audit", clear, insert } satisfies DemoModule;
