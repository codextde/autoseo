import "server-only";
import { z } from "zod";
import type { OpenApiOperation } from "../openapi-helpers";
import {
  auditExportQuery,
  auditIssuesQuery,
  auditPagesQuery,
  compareAuditsQuery,
  lighthouseResultQuery,
  startAuditBody,
  startCrawlabilityBody,
} from "../audit";

/*
 * Local JSON-schema helpers: importing `S` from ../openapi would create an import cycle
 * (openapi.ts imports this file at module load, before `S` is initialised).
 */
type Json = Record<string, unknown>;
const obj = (properties: Json, extra: Json = {}): Json => ({ type: "object", properties, ...extra });
const arr = (items: Json): Json => ({ type: "array", items });
const str: Json = { type: "string" };
const strN: Json = { type: ["string", "null"] };
const int: Json = { type: "integer" };
const num: Json = { type: ["number", "null"] };
const bool: Json = { type: "boolean" };
const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });

const auditRow = obj({
  id: str,
  startUrl: str,
  status: { type: "string", enum: ["queued", "running", "completed", "failed", "cancelled"] },
  phase: str,
  trigger: str,
  pagesCrawled: int,
  pagesTotal: int,
  score: num,
  issueCounts: { type: ["object", "null"] },
  lighthouse: bool,
  startedAt: { type: "string", format: "date-time" },
  completedAt: { type: ["string", "null"], format: "date-time" },
  errorCode: strN,
});

const issueSummary = obj({ issueType: str, title: str, severity: str, category: str, count: int, pages: int });

const crawlabilitySummary = obj({
  id: str,
  status: { type: "string", enum: ["queued", "running", "completed", "failed"] },
  origin: str,
  score: num,
  scores: { type: ["object", "null"] },
  error: strN,
  createdAt: { type: "string", format: "date-time" },
  completedAt: { type: ["string", "null"], format: "date-time" },
  result: {
    type: ["object", "null"],
    description: "categories, findings (severity, category, title, description, fix, snippet), robots, bots (per-crawler access), llms, sitemap, pages",
  },
});

const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

/** REST v1 operations of this domain (merged into /api/v1/openapi.json). */
export const auditOperations: OpenApiOperation[] = [
  {
    method: "get",
    path: "/projects/{projectId}/audits",
    operationId: "listSiteAudits",
    summary: "List site audits",
    tag: "Site audit",
    scope: "read",
    query: limitQuery,
    data: arr(auditRow),
  },
  {
    method: "post",
    path: "/projects/{projectId}/audits",
    operationId: "startSiteAudit",
    summary: "Start site audit",
    description:
      "Starts a background technical SEO crawl (free). Optional Lighthouse on ≤10 sample pages via PageSpeed Insights (free) or DataForSEO (paid). One audit per project at a time (409 conflict otherwise). Poll GET /audits/{auditId}.",
    tag: "Site audit",
    scope: "write",
    permission: "seo.run",
    body: startAuditBody,
    status: 202,
    data: obj({ auditId: str, startUrl: str }),
  },
  {
    method: "get",
    path: "/projects/{projectId}/audits/latest",
    operationId: "getLatestSiteAudit",
    summary: "Latest audit summary",
    description: "Status, score, issue counts and the top 3 issue types of the most recent audit.",
    tag: "Site audit",
    scope: "read",
    data: { type: "object" },
  },
  {
    method: "get",
    path: "/projects/{projectId}/audits/compare",
    operationId: "compareSiteAudits",
    summary: "Compare two audits",
    description: "Issue counts per type before/after plus new and resolved issue URLs. Defaults to the two latest completed audits.",
    tag: "Site audit",
    scope: "read",
    query: compareAuditsQuery,
    data: obj({
      base: obj({ id: str, startUrl: str, startedAt: str, score: num, pagesCrawled: int }),
      target: obj({ id: str, startUrl: str, startedAt: str, score: num, pagesCrawled: int }),
      byIssueType: arr(obj({ issueType: str, title: str, severity: str, category: str, before: int, after: int, delta: int })),
      newCount: int,
      resolvedCount: int,
      newIssues: arr(obj({ issueType: str, title: str, severity: str, url: str })),
      resolvedIssues: arr(obj({ issueType: str, title: str, severity: str, url: str })),
    }),
  },
  {
    method: "get",
    path: "/projects/{projectId}/audits/{auditId}",
    operationId: "getSiteAudit",
    summary: "Audit status & overview",
    description: "Progress (status, phase, pages crawled, Lighthouse progress, recent crawl feed) and overview (score, category breakdown, page stats, Lighthouse averages, issue summary).",
    tag: "Site audit",
    scope: "read",
    data: obj({ status: { type: "object" }, overview: { type: "object" } }),
  },
  {
    method: "delete",
    path: "/projects/{projectId}/audits/{auditId}",
    operationId: "deleteSiteAudit",
    summary: "Delete audit",
    description: "Deletes an audit with all its pages, issues and Lighthouse results (stops it first if running).",
    tag: "Site audit",
    scope: "write",
    permission: "seo.run",
    data: { type: "object" },
  },
  {
    method: "post",
    path: "/projects/{projectId}/audits/{auditId}/stop",
    operationId: "stopSiteAudit",
    summary: "Stop audit",
    description: "Stops a queued/running audit; pages crawled so far are finalized.",
    tag: "Site audit",
    scope: "write",
    permission: "seo.run",
    data: obj({ auditId: str, stopped: bool, finalizing: bool }),
  },
  {
    method: "get",
    path: "/projects/{projectId}/audits/{auditId}/issues",
    operationId: "getSiteAuditIssues",
    summary: "Audit issues",
    tag: "Site audit",
    scope: "read",
    query: auditIssuesQuery,
    data: obj({
      summary: arr(issueSummary),
      issues: arr(obj({ severity: str, category: str, issueType: str, title: str, url: str, pageId: strN, details: { type: ["object", "null"] }, howToFix: str })),
    }),
    meta: { pagination: ref("Pagination") },
  },
  {
    method: "get",
    path: "/projects/{projectId}/audits/{auditId}/pages",
    operationId: "getSiteAuditPages",
    summary: "Audit pages",
    tag: "Site audit",
    scope: "read",
    query: auditPagesQuery,
    data: arr(
      obj({
        id: str,
        url: str,
        statusCode: { type: ["integer", "null"] },
        fetchClass: str,
        title: strN,
        metaDescription: strN,
        h1Count: int,
        wordCount: int,
        imagesMissingAlt: int,
        responseTimeMs: { type: ["integer", "null"] },
        isIndexable: bool,
        crawlDepth: int,
        inlinkCount: int,
        issueCount: int,
        score: num,
      }),
    ),
    meta: { pagination: ref("Pagination") },
  },
  {
    method: "get",
    path: "/projects/{projectId}/audits/{auditId}/lighthouse",
    operationId: "getSiteAuditLighthouse",
    summary: "Audit Lighthouse results",
    tag: "Site audit",
    scope: "read",
    data: arr(
      obj({
        id: str,
        url: str,
        strategy: str,
        provider: str,
        status: str,
        performanceScore: num,
        accessibilityScore: num,
        bestPracticesScore: num,
        seoScore: num,
        lcpMs: num,
        cls: num,
        inpMs: num,
        ttfbMs: num,
        hasDetails: bool,
      }),
    ),
  },
  {
    method: "get",
    path: "/projects/{projectId}/audits/{auditId}/lighthouse/{resultId}",
    operationId: "getSiteAuditLighthouseResult",
    summary: "Lighthouse result details",
    tag: "Site audit",
    scope: "read",
    query: lighthouseResultQuery,
    data: obj({ result: { type: "object" }, finalUrl: str, hasIssueDetails: bool, issues: arr({ type: "object" }), issueCount: int }),
  },
  {
    method: "get",
    path: "/projects/{projectId}/audits/{auditId}/export",
    operationId: "exportSiteAudit",
    summary: "Export audit",
    description: "Downloads issues, pages or performance (Lighthouse) as a CSV or JSON file (not wrapped in the envelope).",
    tag: "Site audit",
    scope: "export",
    query: auditExportQuery,
    data: { type: "string", description: "File content" },
    csv: true,
  },
  {
    method: "get",
    path: "/projects/{projectId}/crawlability",
    operationId: "listCrawlabilityChecks",
    summary: "List AI crawlability checks",
    tag: "Crawlability",
    scope: "read",
    query: limitQuery,
    data: arr(obj({ id: str, status: str, trigger: str, origin: str, score: num, scores: { type: ["object", "null"] }, error: strN, createdAt: str, completedAt: strN })),
  },
  {
    method: "post",
    path: "/projects/{projectId}/crawlability",
    operationId: "startCrawlabilityCheck",
    summary: "Start AI crawlability check",
    description:
      "Checks robots.txt rules per AI crawler, live HTTP access, meta/X-Robots directives, llms.txt, sitemaps, canonicals and rendering (free). Runs in the background — poll GET /crawlability/{checkId}.",
    tag: "Crawlability",
    scope: "write",
    permission: "seo.run",
    body: startCrawlabilityBody,
    status: 202,
    data: obj({ checkId: str }),
  },
  {
    method: "get",
    path: "/projects/{projectId}/crawlability/latest",
    operationId: "getLatestCrawlabilityCheck",
    summary: "Latest crawlability check",
    tag: "Crawlability",
    scope: "read",
    data: crawlabilitySummary,
  },
  {
    method: "get",
    path: "/projects/{projectId}/crawlability/{checkId}",
    operationId: "getCrawlabilityCheck",
    summary: "Crawlability check",
    tag: "Crawlability",
    scope: "read",
    data: crawlabilitySummary,
  },
];
