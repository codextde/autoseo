import "server-only";
/**
 * Site audit service — the reusable server API used by server actions, route handlers, jobs and
 * (later) the MCP server. Every read is scoped by projectId.
 */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs, projects, siteAuditIssues, siteAuditLighthouse, siteAuditPageLinks, siteAuditPages, siteAudits } from "@/server/db/schema";
import { cancelJob } from "@/server/jobs/queue";
import { getSetting } from "@/server/settings";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { buildCsv, formatIssueDetails } from "./csv";
import {
  AUDIT_ISSUE_TYPES,
  CRAWLER_USER_AGENT,
  DEFAULT_AUDIT_PAGES,
  getIssueDescriptor,
  ISSUE_CATEGORIES,
  ISSUE_SEVERITY_ORDER,
  MIN_AUDIT_PAGES,
  type IssueCategory,
  type IssueSeverity,
} from "./registry";
import { parseStoredLighthousePayload, sortLighthouseIssues, filterIssuesByCategory } from "./lighthouse/stored-payload";
import { resolveStartUrl } from "./safe-fetch";
import { CrawlTargetBlockedError, InvalidUrlError, normalizeStartUrlInput } from "./url-policy";
import { AUDIT_RUN_JOB, enqueueAuditContinuation } from "./runner";
import type { LighthouseCategory } from "./registry";

export type AuditActor = { projectId: string; workspaceId?: string | null; userId?: string | null };

export class AuditServiceError extends Error {
  constructor(
    message: string,
    public code:
      | "VALIDATION_ERROR"
      | "CRAWL_TARGET_BLOCKED"
      | "AUDIT_ALREADY_RUNNING"
      | "NOT_FOUND"
      | "PROVIDER_NOT_CONFIGURED"
      | "INVALID_STATE",
  ) {
    super(message);
  }
}

export type StartAuditInput = {
  startUrl?: string | null;
  maxPages?: number | null;
  /** Run the sampled Lighthouse checks (default false, open-seo UI parity). */
  lighthouse?: boolean;
  lighthouseProvider?: "psi" | "dataforseo";
  trigger?: "manual" | "scheduled" | "api" | "mcp";
  scheduleId?: string | null;
};

export async function getAuditLimits() {
  const limits = await getSetting("limits");
  return { minPages: MIN_AUDIT_PAGES, maxPages: limits.auditMaxPages, defaultPages: Math.min(DEFAULT_AUDIT_PAGES, limits.auditMaxPages), concurrency: limits.auditConcurrency };
}

export async function startAudit(actor: AuditActor, input: StartAuditInput): Promise<{ auditId: string; startUrl: string }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, actor.projectId)).limit(1);
  if (!project) throw new AuditServiceError("Project not found.", "NOT_FOUND");

  const raw = input.startUrl?.trim() || project.websiteUrl || `https://${project.domain}`;
  let normalized: string;
  try {
    normalized = normalizeStartUrlInput(raw);
  } catch (err) {
    if (err instanceof CrawlTargetBlockedError) throw new AuditServiceError(err.message, "CRAWL_TARGET_BLOCKED");
    if (err instanceof InvalidUrlError) throw new AuditServiceError(err.message, "VALIDATION_ERROR");
    throw err;
  }
  let startUrl: string;
  try {
    startUrl = await resolveStartUrl(normalized, CRAWLER_USER_AGENT);
  } catch (err) {
    if (err instanceof CrawlTargetBlockedError) throw new AuditServiceError(err.message, "CRAWL_TARGET_BLOCKED");
    throw err;
  }

  const limits = await getAuditLimits();
  const maxPages = Math.min(Math.max(Math.round(input.maxPages ?? limits.defaultPages), MIN_AUDIT_PAGES), limits.maxPages);
  const provider = input.lighthouseProvider ?? "psi";
  if (input.lighthouse && provider === "dataforseo" && !(await isDataForSeoConfigured())) {
    throw new AuditServiceError("DataForSEO is not configured. An admin can add credentials in Admin → Data Providers, or use PageSpeed Insights.", "PROVIDER_NOT_CONFIGURED");
  }

  const [running] = await db
    .select({ id: siteAudits.id })
    .from(siteAudits)
    .where(and(eq(siteAudits.projectId, actor.projectId), inArray(siteAudits.status, ["queued", "running"])))
    .limit(1);
  if (running) {
    throw new AuditServiceError("An audit is already running for this project. Wait for it to finish or stop it first.", "AUDIT_ALREADY_RUNNING");
  }

  const [audit] = await db
    .insert(siteAudits)
    .values({
      projectId: actor.projectId,
      startUrl,
      status: "queued",
      currentPhase: "queued",
      trigger: input.trigger ?? "manual",
      scheduleId: input.scheduleId ?? null,
      config: {
        maxPages,
        lighthouseStrategy: input.lighthouse ? "auto" : "none",
        lighthouseProvider: provider,
        concurrency: limits.concurrency,
      },
      pagesTotal: maxPages,
      lighthouseTotal: input.lighthouse ? 20 : 0,
      createdBy: actor.userId ?? null,
    })
    .returning();
  await enqueueAuditContinuation(audit!);
  return { auditId: audit!.id, startUrl };
}

/* ───────────────────────────── Reads ───────────────────────────── */

export type AuditRow = typeof siteAudits.$inferSelect;

export async function getAudit(projectId: string, auditId: string): Promise<AuditRow | null> {
  const [row] = await db
    .select()
    .from(siteAudits)
    .where(and(eq(siteAudits.id, auditId), eq(siteAudits.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

async function requireAudit(projectId: string, auditId: string) {
  const audit = await getAudit(projectId, auditId);
  if (!audit) throw new AuditServiceError("Audit not found.", "NOT_FOUND");
  return audit;
}

export async function getAuditHistory(projectId: string, limit = 50) {
  return db
    .select({
      id: siteAudits.id,
      startUrl: siteAudits.startUrl,
      status: siteAudits.status,
      currentPhase: siteAudits.currentPhase,
      trigger: siteAudits.trigger,
      pagesCrawled: siteAudits.pagesCrawled,
      pagesTotal: siteAudits.pagesTotal,
      score: siteAudits.score,
      issueCounts: siteAudits.issueCounts,
      config: siteAudits.config,
      lighthouseCompleted: siteAudits.lighthouseCompleted,
      startedAt: siteAudits.startedAt,
      completedAt: siteAudits.completedAt,
      errorCode: siteAudits.errorCode,
    })
    .from(siteAudits)
    .where(eq(siteAudits.projectId, projectId))
    .orderBy(desc(siteAudits.startedAt))
    .limit(limit);
}

export async function getLatestAudit(projectId: string, opts: { completedOnly?: boolean } = {}) {
  const [row] = await db
    .select()
    .from(siteAudits)
    .where(and(eq(siteAudits.projectId, projectId), opts.completedOnly ? eq(siteAudits.status, "completed") : undefined))
    .orderBy(desc(siteAudits.startedAt))
    .limit(1);
  return row ?? null;
}

export type CrawlFeedEntry = { url: string; statusCode: number | null; title: string | null; crawledAt: string; fetchClass: string };

export async function getAuditStatus(projectId: string, auditId: string, feedLimit = 40) {
  const audit = await getAudit(projectId, auditId);
  if (!audit) return null;
  const feed =
    feedLimit > 0
      ? await db
          .select({ url: siteAuditPages.url, statusCode: siteAuditPages.statusCode, title: siteAuditPages.title, crawledAt: siteAuditPages.crawledAt, fetchClass: siteAuditPages.fetchClass })
          .from(siteAuditPages)
          .where(eq(siteAuditPages.auditId, auditId))
          .orderBy(desc(siteAuditPages.crawledAt))
          .limit(feedLimit)
      : [];
  return {
    id: audit.id,
    startUrl: audit.startUrl,
    status: audit.status,
    currentPhase: audit.currentPhase,
    pagesCrawled: audit.pagesCrawled,
    pagesTotal: audit.pagesTotal,
    lighthouseTotal: audit.lighthouseTotal,
    lighthouseCompleted: audit.lighthouseCompleted,
    lighthouseFailed: audit.lighthouseFailed,
    stopRequested: audit.stopRequested,
    errorCode: audit.errorCode,
    errorDetail: audit.errorDetail,
    score: audit.score,
    startedAt: audit.startedAt.toISOString(),
    completedAt: audit.completedAt?.toISOString() ?? null,
    heartbeatAt: audit.heartbeatAt?.toISOString() ?? null,
    feed: feed.map((f) => ({ ...f, title: f.title?.slice(0, 300) ?? null, crawledAt: f.crawledAt.toISOString() })) as CrawlFeedEntry[],
  };
}

export type IssueTypeSummary = {
  issueType: string;
  title: string;
  severity: IssueSeverity;
  category: IssueCategory;
  count: number;
  pages: number;
};

export async function getAuditIssueSummary(projectId: string, auditId: string): Promise<IssueTypeSummary[]> {
  await requireAudit(projectId, auditId);
  const rows = (await db.execute(sql`
    SELECT issue_type, count(*)::int AS count, count(DISTINCT page_url)::int AS pages
    FROM site_audit_issues WHERE audit_id = ${auditId} GROUP BY issue_type`)) as unknown as Array<{ issue_type: string; count: number; pages: number }>;
  return rows
    .map((r) => {
      const d = getIssueDescriptor(r.issue_type);
      return {
        issueType: r.issue_type,
        title: d?.title ?? r.issue_type,
        severity: d?.severity ?? "info",
        category: d?.category ?? "structure",
        count: Number(r.count),
        pages: Number(r.pages),
      } satisfies IssueTypeSummary;
    })
    .sort((a, b) => ISSUE_SEVERITY_ORDER[a.severity] - ISSUE_SEVERITY_ORDER[b.severity] || b.count - a.count);
}

export async function getAuditOverview(projectId: string, auditId: string) {
  const audit = await requireAudit(projectId, auditId);
  const [summary, lighthouse, pageStats] = await Promise.all([
    getAuditIssueSummary(projectId, auditId),
    getAuditLighthouse(projectId, auditId),
    db.execute(sql`
      SELECT
        count(*)::int AS pages,
        count(*) FILTER (WHERE fetch_class = 'blocked')::int AS blocked,
        count(*) FILTER (WHERE fetch_class = 'rate_limited')::int AS rate_limited,
        count(*) FILTER (WHERE fetch_class = 'error')::int AS errors,
        count(*) FILTER (WHERE status_code BETWEEN 200 AND 299)::int AS ok,
        count(*) FILTER (WHERE status_code BETWEEN 300 AND 399)::int AS redirects,
        count(*) FILTER (WHERE status_code >= 400)::int AS broken,
        count(*) FILTER (WHERE is_indexable AND status_code BETWEEN 200 AND 299)::int AS indexable,
        round(avg(response_time_ms) FILTER (WHERE status_code > 0))::int AS avg_response,
        round(avg(word_count) FILTER (WHERE status_code BETWEEN 200 AND 299 AND word_count > 0))::int AS avg_words,
        (SELECT split_part(split_part(url, '://', 2), '/', 1) FROM site_audit_pages
           WHERE audit_id = ${auditId} AND status_code BETWEEN 200 AND 299
           GROUP BY 1 ORDER BY count(*) DESC LIMIT 1) AS predominant_host
      FROM site_audit_pages WHERE audit_id = ${auditId}`) as unknown as Promise<Array<Record<string, number | string | null>>>,
  ]);
  const ps = pageStats[0] ?? {};
  const okLh = lighthouse.filter((r) => r.status === "done");
  const avg = (vals: Array<number | null>) => {
    const v = vals.filter((x): x is number => typeof x === "number");
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const categories = (Object.keys(ISSUE_CATEGORIES) as IssueCategory[]).map((key) => {
    const items = summary.filter((s) => s.category === key);
    return {
      key,
      label: ISSUE_CATEGORIES[key].label,
      description: ISSUE_CATEGORIES[key].description,
      issues: items.reduce((a, s) => a + s.count, 0),
      critical: items.filter((s) => s.severity === "critical").reduce((a, s) => a + s.count, 0),
      warning: items.filter((s) => s.severity === "warning").reduce((a, s) => a + s.count, 0),
      info: items.filter((s) => s.severity === "info").reduce((a, s) => a + s.count, 0),
      types: items.length,
    };
  });
  let predominantHost = (ps.predominant_host as string | null) ?? null;
  if (!predominantHost) {
    try {
      predominantHost = new URL(audit.startUrl).hostname;
    } catch {
      predominantHost = null;
    }
  }
  return {
    audit,
    summary,
    categories,
    pages: {
      total: Number(ps.pages ?? 0),
      blocked: Number(ps.blocked ?? 0),
      rateLimited: Number(ps.rate_limited ?? 0),
      errors: Number(ps.errors ?? 0),
      ok: Number(ps.ok ?? 0),
      redirects: Number(ps.redirects ?? 0),
      broken: Number(ps.broken ?? 0),
      indexable: Number(ps.indexable ?? 0),
      avgResponseMs: ps.avg_response == null ? null : Number(ps.avg_response),
      avgWords: ps.avg_words == null ? null : Number(ps.avg_words),
    },
    predominantHost,
    lighthouse: {
      rows: lighthouse,
      tests: lighthouse.length,
      failures: lighthouse.filter((r) => r.status === "failed").length,
      avgPerformance: avg(okLh.map((r) => r.performanceScore)),
      avgAccessibility: avg(okLh.map((r) => r.accessibilityScore)),
      avgBestPractices: avg(okLh.map((r) => r.bestPracticesScore)),
      avgSeo: avg(okLh.map((r) => r.seoScore)),
    },
  };
}

/** First N affected rows per issue type (for the grouped issues view). */
export async function getIssueSamples(projectId: string, auditId: string, perType = 20) {
  await requireAudit(projectId, auditId);
  const rows = (await db.execute(sql`
    SELECT id, page_id, page_url, issue_type, details FROM (
      SELECT i.*, row_number() OVER (PARTITION BY issue_type ORDER BY page_url) AS rn
      FROM site_audit_issues i WHERE audit_id = ${auditId}
    ) x WHERE rn <= ${perType}
    ORDER BY issue_type, page_url`)) as unknown as Array<{ id: string; page_id: string | null; page_url: string; issue_type: string; details: Record<string, unknown> | null }>;
  const out: Record<string, Array<{ id: string; pageId: string | null; pageUrl: string; details: Record<string, unknown> | null }>> = {};
  for (const r of rows) (out[r.issue_type] ??= []).push({ id: r.id, pageId: r.page_id, pageUrl: r.page_url, details: r.details });
  return out;
}

export type AuditIssueFilter = {
  severity?: IssueSeverity | null;
  issueType?: string | null;
  category?: IssueCategory | null;
  search?: string | null;
  limit?: number;
  offset?: number;
};

export async function getAuditIssues(projectId: string, auditId: string, filter: AuditIssueFilter = {}) {
  await requireAudit(projectId, auditId);
  const conds: SQL[] = [eq(siteAuditIssues.auditId, auditId)];
  if (filter.severity) conds.push(eq(siteAuditIssues.severity, filter.severity));
  if (filter.issueType) conds.push(eq(siteAuditIssues.issueType, filter.issueType));
  if (filter.category) conds.push(eq(siteAuditIssues.category, filter.category));
  if (filter.search) conds.push(ilike(siteAuditIssues.pageUrl, `%${filter.search.replace(/[%_\\]/g, "\\$&")}%`));
  const where = and(...conds);
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 5000);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: siteAuditIssues.id,
        pageId: siteAuditIssues.pageId,
        pageUrl: siteAuditIssues.pageUrl,
        issueType: siteAuditIssues.issueType,
        severity: siteAuditIssues.severity,
        category: siteAuditIssues.category,
        details: siteAuditIssues.details,
      })
      .from(siteAuditIssues)
      .where(where)
      .orderBy(
        sql`CASE ${siteAuditIssues.severity} WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END`,
        asc(siteAuditIssues.issueType),
        asc(siteAuditIssues.pageUrl),
      )
      .limit(limit)
      .offset(Math.max(filter.offset ?? 0, 0)),
    db.select({ total: sql<number>`count(*)::int` }).from(siteAuditIssues).where(where) as unknown as Promise<[{ total: number }]>,
  ]);
  return {
    total: Number(total),
    issues: rows.map((r) => {
      const d = getIssueDescriptor(r.issueType);
      return { ...r, title: d?.title ?? r.issueType, howToFix: d?.howToFix ?? "" };
    }),
  };
}

export type AuditPagesFilter = {
  search?: string | null;
  status?: "2xx" | "3xx" | "4xx" | "5xx" | "error" | "blocked" | null;
  indexable?: "yes" | "no" | null;
  missingAlt?: boolean | null;
  withIssues?: boolean | null;
  sort?: string | null;
  dir?: "asc" | "desc" | null;
  limit?: number;
  offset?: number;
};

const PAGE_SORTS = {
  url: siteAuditPages.url,
  status: siteAuditPages.statusCode,
  title: siteAuditPages.title,
  h1: siteAuditPages.h1Count,
  words: siteAuditPages.wordCount,
  images: siteAuditPages.imagesMissingAlt,
  speed: siteAuditPages.responseTimeMs,
  depth: siteAuditPages.crawlDepth,
  inlinks: siteAuditPages.inlinkCount,
  issues: siteAuditPages.issueCount,
  score: siteAuditPages.score,
} as const;

export async function getAuditPages(projectId: string, auditId: string, filter: AuditPagesFilter = {}) {
  await requireAudit(projectId, auditId);
  const conds: SQL[] = [eq(siteAuditPages.auditId, auditId)];
  if (filter.search) {
    const q = `%${filter.search.replace(/[%_\\]/g, "\\$&")}%`;
    conds.push(or(ilike(siteAuditPages.url, q), ilike(siteAuditPages.title, q), ilike(siteAuditPages.metaDescription, q))!);
  }
  switch (filter.status) {
    case "2xx":
      conds.push(sql`${siteAuditPages.statusCode} BETWEEN 200 AND 299`);
      break;
    case "3xx":
      conds.push(sql`${siteAuditPages.statusCode} BETWEEN 300 AND 399`);
      break;
    case "4xx":
      conds.push(sql`${siteAuditPages.statusCode} BETWEEN 400 AND 499 AND ${siteAuditPages.fetchClass} = 'ok'`);
      break;
    case "5xx":
      conds.push(sql`${siteAuditPages.statusCode} >= 500 AND ${siteAuditPages.fetchClass} = 'ok'`);
      break;
    case "error":
      conds.push(sql`${siteAuditPages.fetchClass} = 'error'`);
      break;
    case "blocked":
      conds.push(sql`${siteAuditPages.fetchClass} IN ('blocked','rate_limited')`);
      break;
  }
  if (filter.indexable === "yes") conds.push(sql`${siteAuditPages.isIndexable} AND ${siteAuditPages.statusCode} BETWEEN 200 AND 299`);
  if (filter.indexable === "no") conds.push(sql`NOT ${siteAuditPages.isIndexable}`);
  if (filter.missingAlt) conds.push(sql`${siteAuditPages.imagesMissingAlt} > 0`);
  if (filter.withIssues) conds.push(sql`${siteAuditPages.issueCount} > 0`);
  const where = and(...conds);
  const sortCol = PAGE_SORTS[(filter.sort ?? "url") as keyof typeof PAGE_SORTS] ?? siteAuditPages.url;
  const order = filter.dir === "desc" ? sql`${sortCol} DESC NULLS LAST` : sql`${sortCol} ASC NULLS LAST`;
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 5000);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: siteAuditPages.id,
        url: siteAuditPages.url,
        statusCode: siteAuditPages.statusCode,
        fetchClass: siteAuditPages.fetchClass,
        redirectUrl: siteAuditPages.redirectUrl,
        title: siteAuditPages.title,
        metaDescription: siteAuditPages.metaDescription,
        h1Count: siteAuditPages.h1Count,
        wordCount: siteAuditPages.wordCount,
        imagesTotal: siteAuditPages.imagesTotal,
        imagesMissingAlt: siteAuditPages.imagesMissingAlt,
        responseTimeMs: siteAuditPages.responseTimeMs,
        isIndexable: siteAuditPages.isIndexable,
        crawlDepth: siteAuditPages.crawlDepth,
        inSitemap: siteAuditPages.inSitemap,
        inlinkCount: siteAuditPages.inlinkCount,
        internalLinkCount: siteAuditPages.internalLinkCount,
        issueCount: siteAuditPages.issueCount,
        score: siteAuditPages.score,
        contentType: siteAuditPages.contentType,
      })
      .from(siteAuditPages)
      .where(where)
      .orderBy(order, asc(siteAuditPages.url))
      .limit(limit)
      .offset(Math.max(filter.offset ?? 0, 0)),
    db.select({ total: sql<number>`count(*)::int` }).from(siteAuditPages).where(where) as unknown as Promise<[{ total: number }]>,
  ]);
  return { total: Number(total), pages: rows };
}

export async function getAuditPage(projectId: string, auditId: string, pageId: string) {
  const audit = await requireAudit(projectId, auditId);
  const [page] = await db
    .select()
    .from(siteAuditPages)
    .where(and(eq(siteAuditPages.id, pageId), eq(siteAuditPages.auditId, auditId)))
    .limit(1);
  if (!page) return null;
  const [issues, [links], inbound, lighthouse] = await Promise.all([
    db
      .select()
      .from(siteAuditIssues)
      .where(and(eq(siteAuditIssues.auditId, auditId), eq(siteAuditIssues.pageId, pageId))),
    db.select({ links: siteAuditPageLinks.links }).from(siteAuditPageLinks).where(eq(siteAuditPageLinks.pageId, pageId)).limit(1),
    db.execute(sql`
      SELECT s.id, s.url, s.title, (SELECT e->>'a' FROM jsonb_array_elements(l.links) e WHERE e->>'u' = ${page.url} LIMIT 1) AS anchor
      FROM site_audit_page_links l JOIN site_audit_pages s ON s.id = l.page_id
      WHERE l.audit_id = ${auditId} AND s.id <> ${pageId}
        AND l.links @> ${JSON.stringify([{ u: page.url }])}::jsonb
      ORDER BY s.url LIMIT 200`) as unknown as Promise<Array<{ id: string; url: string; title: string | null; anchor: string | null }>>,
    db
      .select({
        id: siteAuditLighthouse.id,
        strategy: siteAuditLighthouse.strategy,
        status: siteAuditLighthouse.status,
        performanceScore: siteAuditLighthouse.performanceScore,
        accessibilityScore: siteAuditLighthouse.accessibilityScore,
        bestPracticesScore: siteAuditLighthouse.bestPracticesScore,
        seoScore: siteAuditLighthouse.seoScore,
        lcpMs: siteAuditLighthouse.lcpMs,
        cls: siteAuditLighthouse.cls,
        ttfbMs: siteAuditLighthouse.ttfbMs,
      })
      .from(siteAuditLighthouse)
      .where(and(eq(siteAuditLighthouse.auditId, auditId), eq(siteAuditLighthouse.url, page.url))),
  ]);
  // Duplicate peers (same content hash / title) for context.
  const duplicates = page.contentHash
    ? await db
        .select({ id: siteAuditPages.id, url: siteAuditPages.url })
        .from(siteAuditPages)
        .where(and(eq(siteAuditPages.auditId, auditId), eq(siteAuditPages.contentHash, page.contentHash), sql`${siteAuditPages.id} <> ${pageId}`))
        .limit(20)
    : [];
  return {
    audit,
    page,
    issues: issues
      .map((i) => ({ ...i, descriptor: getIssueDescriptor(i.issueType) }))
      .sort((a, b) => ISSUE_SEVERITY_ORDER[a.severity] - ISSUE_SEVERITY_ORDER[b.severity]),
    links: links?.links ?? [],
    inbound,
    lighthouse,
    duplicates,
  };
}

export async function getAuditLighthouse(projectId: string, auditId: string) {
  await requireAudit(projectId, auditId);
  return db
    .select({
      id: siteAuditLighthouse.id,
      pageId: siteAuditLighthouse.pageId,
      url: siteAuditLighthouse.url,
      strategy: siteAuditLighthouse.strategy,
      provider: siteAuditLighthouse.provider,
      status: siteAuditLighthouse.status,
      performanceScore: siteAuditLighthouse.performanceScore,
      accessibilityScore: siteAuditLighthouse.accessibilityScore,
      bestPracticesScore: siteAuditLighthouse.bestPracticesScore,
      seoScore: siteAuditLighthouse.seoScore,
      lcpMs: siteAuditLighthouse.lcpMs,
      cls: siteAuditLighthouse.cls,
      inpMs: siteAuditLighthouse.inpMs,
      ttfbMs: siteAuditLighthouse.ttfbMs,
      errorMessage: siteAuditLighthouse.errorMessage,
      hasPayload: sql<boolean>`${siteAuditLighthouse.payload} IS NOT NULL`,
    })
    .from(siteAuditLighthouse)
    .where(eq(siteAuditLighthouse.auditId, auditId))
    .orderBy(asc(siteAuditLighthouse.url), asc(siteAuditLighthouse.strategy));
}

export async function getLighthouseResult(projectId: string, auditId: string, resultId: string, category?: LighthouseCategory | "all") {
  const audit = await requireAudit(projectId, auditId);
  const [row] = await db
    .select()
    .from(siteAuditLighthouse)
    .where(and(eq(siteAuditLighthouse.id, resultId), eq(siteAuditLighthouse.auditId, auditId)))
    .limit(1);
  if (!row) return null;
  const payload = parseStoredLighthousePayload(row.payload);
  const issues = payload ? sortLighthouseIssues(filterIssuesByCategory(payload.issues, category)) : [];
  return {
    audit,
    result: { ...row, payload: undefined },
    payload,
    finalUrl: payload?.metadata.finalUrl ?? row.url,
    hasIssueDetails: payload?.hasIssueDetails ?? false,
    issues,
    allIssues: payload ? sortLighthouseIssues(payload.issues) : [],
  };
}

/* ───────────────────────────── Compare ───────────────────────────── */

export async function compareAudits(projectId: string, baseId: string, targetId: string) {
  const [base, target] = await Promise.all([requireAudit(projectId, baseId), requireAudit(projectId, targetId)]);
  const [baseSummary, targetSummary] = await Promise.all([getAuditIssueSummary(projectId, baseId), getAuditIssueSummary(projectId, targetId)]);
  const types = new Set([...baseSummary.map((s) => s.issueType), ...targetSummary.map((s) => s.issueType)]);
  const rows = [...types].map((t) => {
    const b = baseSummary.find((s) => s.issueType === t);
    const n = targetSummary.find((s) => s.issueType === t);
    const d = getIssueDescriptor(t);
    return {
      issueType: t,
      title: d?.title ?? t,
      severity: (d?.severity ?? "info") as IssueSeverity,
      category: (d?.category ?? "structure") as IssueCategory,
      before: b?.count ?? 0,
      after: n?.count ?? 0,
      delta: (n?.count ?? 0) - (b?.count ?? 0),
    };
  });
  rows.sort((a, b) => ISSUE_SEVERITY_ORDER[a.severity] - ISSUE_SEVERITY_ORDER[b.severity] || Math.abs(b.delta) - Math.abs(a.delta));

  // Issue-level diff keyed by (type, path, dedupe detail) so different hosts/runs line up.
  const keyOf = (r: { issueType: string; pageUrl: string; details: Record<string, unknown> | null }) => {
    let path = r.pageUrl;
    try {
      const u = new URL(r.pageUrl);
      path = `${u.pathname}${u.search}`;
    } catch {
      /* keep */
    }
    const extra = r.details && typeof r.details.targetUrl === "string" ? `|${r.details.targetUrl}` : "";
    return `${r.issueType}|${path}${extra}`;
  };
  const load = (auditId: string) =>
    db
      .select({ issueType: siteAuditIssues.issueType, pageUrl: siteAuditIssues.pageUrl, pageId: siteAuditIssues.pageId, severity: siteAuditIssues.severity, details: siteAuditIssues.details })
      .from(siteAuditIssues)
      .where(eq(siteAuditIssues.auditId, auditId))
      .limit(20_000);
  const [baseIssues, targetIssues] = await Promise.all([load(baseId), load(targetId)]);
  const baseKeys = new Set(baseIssues.map(keyOf));
  const targetKeys = new Set(targetIssues.map(keyOf));
  const decorate = <T extends { issueType: string }>(r: T) => ({ ...r, title: getIssueDescriptor(r.issueType)?.title ?? r.issueType });
  const bySeverity = <T extends { severity: IssueSeverity }>(a: T, b: T) => ISSUE_SEVERITY_ORDER[a.severity] - ISSUE_SEVERITY_ORDER[b.severity];
  const newIssues = targetIssues.filter((r) => !baseKeys.has(keyOf(r))).map(decorate).sort(bySeverity);
  const resolved = baseIssues.filter((r) => !targetKeys.has(keyOf(r))).map(decorate).sort(bySeverity);
  return {
    base,
    target,
    rows,
    newIssues: newIssues.slice(0, 1000),
    resolvedIssues: resolved.slice(0, 1000),
    newCount: newIssues.length,
    resolvedCount: resolved.length,
  };
}

/* ───────────────────────────── Mutations ───────────────────────────── */

async function cancelAuditJobs(auditId: string) {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, AUDIT_RUN_JOB), inArray(jobs.status, ["queued"]), sql`${jobs.payload}->>'auditId' = ${auditId}`));
  for (const r of rows) await cancelJob(r.id);
}

/** Stops a running audit: remaining crawl/Lighthouse work is skipped and results are finalized. */
export async function stopAudit(projectId: string, auditId: string) {
  const audit = await requireAudit(projectId, auditId);
  if (!["queued", "running"].includes(audit.status)) throw new AuditServiceError("This audit is not running.", "INVALID_STATE");
  if (audit.status === "queued" || audit.currentPhase === "discovery" || audit.currentPhase === "queued") {
    await cancelAuditJobs(auditId);
    await db
      .update(siteAudits)
      .set({ status: "cancelled", currentPhase: "failed", errorCode: "cancelled", completedAt: new Date(), runnerId: null })
      .where(eq(siteAudits.id, auditId));
    return { stopped: true, finalizing: false };
  }
  await db.update(siteAudits).set({ stopRequested: true }).where(eq(siteAudits.id, auditId));
  // If no runner is active (e.g. waiting on a rate-limit cooldown), kick a chunk now.
  if (!audit.runnerId) {
    await cancelAuditJobs(auditId);
    const [row] = await db
      .update(siteAudits)
      .set({ chunkNo: sql`${siteAudits.chunkNo} + 1` })
      .where(eq(siteAudits.id, auditId))
      .returning();
    if (row) await enqueueAuditContinuation(row);
  }
  return { stopped: true, finalizing: true };
}

export async function deleteAudit(projectId: string, auditId: string) {
  await requireAudit(projectId, auditId);
  await cancelAuditJobs(auditId);
  await db.delete(siteAudits).where(and(eq(siteAudits.id, auditId), eq(siteAudits.projectId, projectId)));
  return { deleted: true };
}

/* ───────────────────────────── Exports ───────────────────────────── */

export type ExportKind = "issues" | "pages" | "performance";

export async function exportAudit(
  projectId: string,
  auditId: string,
  kind: ExportKind,
  format: "csv" | "json",
  opts: { issueType?: string | null } = {},
): Promise<{ filename: string; contentType: string; content: string }> {
  const audit = await requireAudit(projectId, auditId);
  const host = (() => {
    try {
      return new URL(audit.startUrl).hostname;
    } catch {
      return "site";
    }
  })();
  const stamp = audit.startedAt.toISOString().slice(0, 10);
  const base = `audit-${host}-${stamp}`;
  if (kind === "issues") {
    const { issues } = await getAuditIssues(projectId, auditId, { limit: 5000, issueType: opts.issueType ?? undefined });
    const suffix = opts.issueType ? `-${opts.issueType}` : "";
    if (format === "json") {
      return {
        filename: `${base}-issues${suffix}.json`,
        contentType: "application/json",
        content: JSON.stringify(
          issues.map((i) => ({ severity: i.severity, issueType: i.issueType, issue: i.title, url: i.pageUrl, details: i.details, howToFix: i.howToFix })),
          null,
          2,
        ),
      };
    }
    return {
      filename: `${base}-issues${suffix}.csv`,
      contentType: "text/csv; charset=utf-8",
      content: buildCsv(
        ["Severity", "Issue", "URL", "Details", "How To Fix"],
        issues.map((i) => [i.severity, i.title, i.pageUrl, formatIssueDetails(i.details), i.howToFix]),
      ),
    };
  }
  if (kind === "pages") {
    const { pages } = await getAuditPages(projectId, auditId, { limit: 5000 });
    if (format === "json") return { filename: `${base}-pages.json`, contentType: "application/json", content: JSON.stringify(pages, null, 2) };
    return {
      filename: `${base}-pages.csv`,
      contentType: "text/csv; charset=utf-8",
      content: buildCsv(
        ["URL", "Status", "Title", "H1", "Words", "Images", "Missing Alt", "Response Time (ms)", "Indexable", "Depth", "Inlinks", "Issues", "Score"],
        pages.map((p) => [
          p.url,
          p.statusCode,
          p.title,
          p.h1Count,
          p.wordCount,
          p.imagesTotal,
          p.imagesMissingAlt,
          p.responseTimeMs,
          p.isIndexable ? "yes" : "no",
          p.crawlDepth,
          p.inlinkCount,
          p.issueCount,
          p.score,
        ]),
      ),
    };
  }
  const rows = await getAuditLighthouse(projectId, auditId);
  if (format === "json") return { filename: `${base}-performance.json`, contentType: "application/json", content: JSON.stringify(rows, null, 2) };
  return {
    filename: `${base}-performance.csv`,
    contentType: "text/csv; charset=utf-8",
    content: buildCsv(
      ["URL", "Device", "Status", "Performance", "Accessibility", "Best Practices", "SEO", "LCP (ms)", "CLS", "INP (ms)", "TTFB (ms)", "Error"],
      rows.map((r) => [
        r.url,
        r.strategy,
        r.status,
        r.performanceScore,
        r.accessibilityScore,
        r.bestPracticesScore,
        r.seoScore,
        r.lcpMs == null ? "" : Math.round(r.lcpMs),
        r.cls == null ? "" : r.cls.toFixed(3),
        r.inpMs == null ? "" : Math.round(r.inpMs),
        r.ttfbMs == null ? "" : Math.round(r.ttfbMs),
        r.errorMessage ?? "",
      ]),
    ),
  };
}

export async function exportLighthouseResult(
  projectId: string,
  auditId: string,
  resultId: string,
  mode: "full" | "issues" | "category" | "csv",
  category?: LighthouseCategory,
) {
  const data = await getLighthouseResult(projectId, auditId, resultId, mode === "category" ? category : "all");
  if (!data || !data.payload) throw new AuditServiceError("Lighthouse result not found.", "NOT_FOUND");
  const createdAt = data.audit.startedAt.toISOString();
  const base = `lighthouse-${data.result.strategy}-${createdAt.replace(/[:.]/g, "-")}`;
  if (mode === "full") return { filename: `${base}-payload.json`, contentType: "application/json", content: JSON.stringify(data.payload, null, 2) };
  if (mode === "csv") {
    const issues = category ? data.allIssues.filter((i) => i.category === category) : data.allIssues;
    return {
      filename: `${base}${category ? `-${category}` : ""}-issues.csv`,
      contentType: "text/csv; charset=utf-8",
      content: buildCsv(
        ["Category", "Severity", "Score", "Title", "Display Value", "Description", "Impact (ms)", "Impact (bytes)", "Affected Items"],
        issues.map((i) => [i.category, i.severity, i.score, i.title, i.displayValue, i.description, i.impactMs, i.impactBytes, i.items.join("\n")]),
      ),
    };
  }
  return {
    filename: mode === "category" && category ? `${base}-${category}-issues.json` : `${base}-issues.json`,
    contentType: "application/json",
    content: JSON.stringify(
      { resultId, finalUrl: data.finalUrl, strategy: data.result.strategy, createdAt, category: mode === "category" ? (category ?? "all") : "all", issues: data.issues },
      null,
      2,
    ),
  };
}

/** Dashboard / MCP summary of the latest audit. */
export async function getLatestAuditSummary(projectId: string) {
  const audit = await getLatestAudit(projectId);
  if (!audit) return null;
  const summary = await getAuditIssueSummary(projectId, audit.id);
  return {
    id: audit.id,
    status: audit.status,
    startUrl: audit.startUrl,
    score: audit.score,
    pagesCrawled: audit.pagesCrawled,
    startedAt: audit.startedAt,
    completedAt: audit.completedAt,
    issueCounts: audit.issueCounts,
    topIssues: [...summary].sort((a, b) => ISSUE_SEVERITY_ORDER[a.severity] - ISSUE_SEVERITY_ORDER[b.severity] || b.pages - a.pages).slice(0, 3),
    totalIssueTypes: summary.length,
  };
}

export const ISSUE_TYPE_OPTIONS = Object.entries(AUDIT_ISSUE_TYPES).map(([id, d]) => ({ id, title: d.title, severity: d.severity, category: d.category }));
