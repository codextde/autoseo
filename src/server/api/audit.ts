import "server-only";
import { z } from "zod";
import {
  compareAudits,
  getAuditHistory,
  getAuditIssues,
  getAuditIssueSummary,
  getAuditLighthouse,
  getAuditLimits,
  getAuditOverview,
  getAuditPages,
  getAuditStatus,
  getLatestAudit,
  getLighthouseResult,
} from "@/server/audit-crawler/service";
import { AUDIT_ISSUE_TYPE_IDS, ISSUE_CATEGORIES, LIGHTHOUSE_CATEGORIES, type IssueCategory } from "@/server/audit-crawler/registry";
import {
  getCrawlabilityCheck,
  getLatestCrawlabilityCheck,
  listCrawlabilityChecks,
} from "@/server/crawlability/service";
import { ApiError } from "./errors";

/**
 * Site audit + crawlability adapters shared by the REST API (v1) and the MCP tools. All reads are
 * scoped by projectId (the audit / crawlability services enforce it too).
 */

const ISSUE_CATEGORY_IDS = Object.keys(ISSUE_CATEGORIES) as [IssueCategory, ...IssueCategory[]];

export const startAuditBody = z.object({
  startUrl: z.string().trim().max(2048).optional().describe("Start URL (default: the project's website). Must be on a public host."),
  maxPages: z.number().int().min(10).max(100_000).optional().describe("Pages to crawl (default 50, capped by Admin → Limits)."),
  lighthouse: z.boolean().default(false).describe("Also run Lighthouse on a sample of up to 10 representative pages."),
  lighthouseProvider: z
    .enum(["psi", "dataforseo"])
    .default("psi")
    .describe("psi = Google PageSpeed Insights (free); dataforseo = DataForSEO Lighthouse (paid, ≈$0.004 per page)."),
});

export const auditIssuesQuery = z.object({
  severity: z.enum(["critical", "warning", "info"]).optional(),
  issueType: z.enum(AUDIT_ISSUE_TYPE_IDS as [string, ...string[]]).optional().describe("One issue type id (see the issue summary)."),
  category: z.enum(ISSUE_CATEGORY_IDS).optional(),
  search: z.string().max(500).optional().describe("Substring of the page URL."),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export const auditPagesQuery = z.object({
  status: z.enum(["2xx", "3xx", "4xx", "5xx", "error", "blocked"]).optional().describe("HTTP status class or fetch outcome."),
  indexable: z.enum(["yes", "no"]).optional(),
  withIssues: z.enum(["true", "false"]).optional(),
  missingAlt: z.enum(["true", "false"]).optional(),
  search: z.string().max(500).optional().describe("Substring of URL, title or meta description."),
  sort: z.enum(["url", "status", "title", "h1", "words", "images", "speed", "depth", "inlinks", "issues", "score"]).default("url"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export const lighthouseResultQuery = z.object({
  category: z.enum([...LIGHTHOUSE_CATEGORIES, "all"] as [string, ...string[]]).default("all"),
});

export const auditExportQuery = z.object({
  kind: z.enum(["issues", "pages", "performance"]).default("issues"),
  format: z.enum(["csv", "json"]).default("csv"),
  issueType: z.string().max(100).optional(),
});

export const compareAuditsQuery = z.object({
  base: z.string().max(64).optional().describe("Older audit id (default: the completed audit before `target`)."),
  target: z.string().max(64).optional().describe("Newer audit id (default: the latest completed audit)."),
});

export const startCrawlabilityBody = z.object({
  urls: z.array(z.string().trim().max(2048)).max(10).default([]).describe("Up to 10 extra pages of the project's site to test (home page is always tested)."),
});

/** Resolves an audit id (or the latest audit of the project). */
export async function resolveAuditId(projectId: string, auditId: string | undefined, opts: { completedOnly?: boolean } = {}) {
  if (auditId) return auditId;
  const latest = await getLatestAudit(projectId, opts);
  if (!latest) throw new ApiError("not_found", opts.completedOnly ? "No completed site audit yet — start one with run_site_audit." : "No site audit yet — start one with run_site_audit.");
  return latest.id;
}

export async function listAudits(projectId: string, limit = 20) {
  const rows = await getAuditHistory(projectId, limit);
  return rows.map((r) => ({
    id: r.id,
    startUrl: r.startUrl,
    status: r.status,
    phase: r.currentPhase,
    trigger: r.trigger,
    pagesCrawled: r.pagesCrawled,
    pagesTotal: r.pagesTotal,
    score: r.score,
    issueCounts: r.issueCounts,
    lighthouse: r.config?.lighthouseStrategy !== "none",
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    errorCode: r.errorCode,
  }));
}

export async function auditStatus(projectId: string, auditId: string, feed = 10) {
  const s = await getAuditStatus(projectId, auditId, feed);
  if (!s) throw new ApiError("not_found", "Audit not found.");
  const done = s.status === "completed" || s.status === "failed" || s.status === "cancelled";
  return { ...s, done };
}

/** Compact overview (score, category breakdown, page stats, Lighthouse averages). */
export async function auditOverview(projectId: string, auditId: string) {
  const o = await getAuditOverview(projectId, auditId);
  const a = o.audit;
  return {
    audit: {
      id: a.id,
      startUrl: a.startUrl,
      status: a.status,
      phase: a.currentPhase,
      score: a.score,
      pagesCrawled: a.pagesCrawled,
      pagesTotal: a.pagesTotal,
      issueCounts: a.issueCounts,
      startedAt: a.startedAt.toISOString(),
      completedAt: a.completedAt?.toISOString() ?? null,
      errorCode: a.errorCode,
    },
    predominantHost: o.predominantHost,
    pages: o.pages,
    categories: o.categories.filter((c) => c.issues > 0),
    issueSummary: o.summary,
    lighthouse: {
      tests: o.lighthouse.tests,
      failures: o.lighthouse.failures,
      avgPerformance: o.lighthouse.avgPerformance,
      avgAccessibility: o.lighthouse.avgAccessibility,
      avgBestPractices: o.lighthouse.avgBestPractices,
      avgSeo: o.lighthouse.avgSeo,
    },
  };
}

export async function auditIssues(projectId: string, auditId: string, q: z.infer<typeof auditIssuesQuery>) {
  const [summary, res] = await Promise.all([
    getAuditIssueSummary(projectId, auditId),
    getAuditIssues(projectId, auditId, {
      severity: q.severity,
      issueType: q.issueType,
      category: q.category,
      search: q.search,
      limit: q.limit,
      offset: (q.page - 1) * q.limit,
    }),
  ]);
  return {
    summary,
    issues: res.issues.map((i) => ({
      severity: i.severity,
      category: i.category,
      issueType: i.issueType,
      title: i.title,
      url: i.pageUrl,
      pageId: i.pageId,
      details: i.details,
      howToFix: i.howToFix,
    })),
    pagination: { page: q.page, limit: q.limit, total: res.total, totalPages: Math.max(1, Math.ceil(res.total / q.limit)) },
  };
}

export async function auditPages(projectId: string, auditId: string, q: z.infer<typeof auditPagesQuery>) {
  const res = await getAuditPages(projectId, auditId, {
    status: q.status,
    indexable: q.indexable,
    withIssues: q.withIssues === "true" ? true : null,
    missingAlt: q.missingAlt === "true" ? true : null,
    search: q.search,
    sort: q.sort,
    dir: q.dir,
    limit: q.limit,
    offset: (q.page - 1) * q.limit,
  });
  return { pages: res.pages, pagination: { page: q.page, limit: q.limit, total: res.total, totalPages: Math.max(1, Math.ceil(res.total / q.limit)) } };
}

export async function auditLighthouse(projectId: string, auditId: string) {
  const rows = await getAuditLighthouse(projectId, auditId);
  return rows.map(({ hasPayload, ...r }) => ({ ...r, hasDetails: hasPayload }));
}

export async function auditLighthouseResult(projectId: string, auditId: string, resultId: string, category: string) {
  const r = await getLighthouseResult(projectId, auditId, resultId, category as (typeof LIGHTHOUSE_CATEGORIES)[number] | "all");
  if (!r) throw new ApiError("not_found", "Lighthouse result not found.");
  return {
    result: r.result,
    finalUrl: r.finalUrl,
    hasIssueDetails: r.hasIssueDetails,
    issues: r.issues.slice(0, 200),
    issueCount: r.issues.length,
  };
}

/** Compares two audits; defaults to the two latest completed audits. */
export async function auditCompare(projectId: string, q: z.infer<typeof compareAuditsQuery>) {
  let { base, target } = q;
  if (!base || !target) {
    // History is newest first: default target = latest completed, base = the completed audit before it.
    const completed = (await getAuditHistory(projectId, 50)).filter((a) => a.status === "completed");
    if (!target) target = completed[0]?.id;
    if (!base) {
      const idx = completed.findIndex((a) => a.id === target);
      base = (idx >= 0 ? completed[idx + 1] : completed.find((a) => a.id !== target))?.id;
    }
  }
  if (!base || !target) throw new ApiError("not_found", "Two completed audits are needed to compare — pass base and target audit ids.");
  const c = await compareAudits(projectId, base, target);
  const brief = (a: { id: string; startUrl: string; startedAt: Date; score: number | null; pagesCrawled: number }) => ({
    id: a.id,
    startUrl: a.startUrl,
    startedAt: a.startedAt.toISOString(),
    score: a.score,
    pagesCrawled: a.pagesCrawled,
  });
  return {
    base: brief(c.base),
    target: brief(c.target),
    byIssueType: c.rows.filter((r) => r.delta !== 0 || r.after > 0),
    newCount: c.newCount,
    resolvedCount: c.resolvedCount,
    newIssues: c.newIssues.slice(0, 200).map((i) => ({ issueType: i.issueType, title: i.title, severity: i.severity, url: i.pageUrl })),
    resolvedIssues: c.resolvedIssues.slice(0, 200).map((i) => ({ issueType: i.issueType, title: i.title, severity: i.severity, url: i.pageUrl })),
  };
}

export async function auditLimits() {
  return getAuditLimits();
}

/* ───────────────────────────── Crawlability ───────────────────────────── */

type CheckDetail = NonNullable<Awaited<ReturnType<typeof getCrawlabilityCheck>>>;

/** Agent-friendly crawlability summary (drops raw robots.txt bodies and HTML signals). */
export function summarizeCrawlability(c: CheckDetail) {
  const p = c.parsed;
  const severityOrder = { critical: 0, warning: 1, info: 2, pass: 3 } as const;
  return {
    id: c.id,
    status: c.status,
    origin: c.origin,
    score: c.score,
    scores: c.scores,
    error: c.error,
    progress: c.progress,
    createdAt: c.createdAt.toISOString(),
    completedAt: c.completedAt?.toISOString() ?? null,
    result: p
      ? {
          checkedAt: p.checkedAt,
          categories: p.categories,
          findings: [...p.findings]
            .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
            .map((f) => ({ severity: f.severity, category: f.category, title: f.title, description: f.description, fix: f.fix ?? null, snippet: f.snippet ?? null, affected: f.affected?.slice(0, 10) ?? [] })),
          robots: {
            url: p.robots.url,
            found: p.robots.found,
            status: p.robots.status,
            unreachable: p.robots.unreachable,
            sitemaps: p.robots.sitemaps,
            warnings: p.robots.warnings.slice(0, 20),
          },
          bots: p.bots.map((b) => ({
            token: b.token,
            name: b.name,
            company: b.company,
            purpose: b.purpose,
            overall: b.overall,
            robots: b.robots.status,
            robotsRule: b.robots.rule,
            blockedShare: b.robots.blockedShare,
            http: b.http.verdict,
            metaBlocked: b.metaBlocked,
          })),
          llms: {
            txt: { url: p.llms.txt.url, present: p.llms.txt.present, status: p.llms.txt.status, bytes: p.llms.txt.bytes },
            full: { url: p.llms.full.url, present: p.llms.full.present, status: p.llms.full.status, bytes: p.llms.full.bytes },
          },
          sitemap: { found: p.sitemap.found, totalUrls: p.sitemap.totalUrls, docs: p.sitemap.docs.length },
          browserBlocked: p.browserBlocked,
          pages: p.pages.map((pg) => ({
            url: pg.url,
            finalUrl: pg.finalUrl,
            status: pg.status,
            ttfbMs: pg.ttfbMs,
            xRobotsTag: pg.xRobotsTag,
            canonical: pg.canonical,
            directives: pg.directives,
            error: pg.error,
          })),
        }
      : null,
  };
}

export async function crawlabilityCheck(projectId: string, checkId: string | undefined) {
  const c = checkId ? await getCrawlabilityCheck(projectId, checkId) : await getLatestCrawlabilityCheck(projectId);
  if (!c) throw new ApiError("not_found", checkId ? "Crawlability check not found." : "No crawlability check yet — start one with run_crawlability_check.");
  return summarizeCrawlability(c);
}

export async function crawlabilityHistory(projectId: string, limit = 20) {
  const rows = await listCrawlabilityChecks(projectId, limit);
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    trigger: r.trigger,
    origin: r.origin,
    score: r.score,
    scores: r.scores,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  }));
}

/** Polls a crawlability check (run by the job worker) until it finishes or the wait budget is spent. */
export async function waitForCrawlability(projectId: string, checkId: string, waitSeconds: number) {
  const deadline = Date.now() + Math.max(0, Math.min(55, waitSeconds)) * 1000;
  for (;;) {
    const c = await getCrawlabilityCheck(projectId, checkId);
    if (!c) throw new ApiError("not_found", "Crawlability check not found.");
    if (c.status === "completed" || c.status === "failed" || Date.now() >= deadline) return summarizeCrawlability(c);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
