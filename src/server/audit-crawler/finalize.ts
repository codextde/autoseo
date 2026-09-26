import "server-only";
/**
 * Finalize (open-seo `multipage-checks` + `finalize` steps) and failure handling.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { siteAuditFrontier, siteAuditIssues, siteAuditPages, siteAudits } from "@/server/db/schema";
import { BROKEN_LINK_ISSUE_CAP, findDuplicates, findRedirectChainsAndLoops, type SlimPage } from "./multipage-checks";
import { computeHealthScore, summarizeIssueCounts } from "./scoring";
import type { DetectedIssue } from "./types";
import type { IssueSeverity } from "./registry";
import { issueRows } from "./issue-rows";

type AuditRow = typeof siteAudits.$inferSelect;

async function insertIssues(auditId: string, issues: DetectedIssue[]) {
  const rows = issueRows(auditId, issues);
  for (let i = 0; i < rows.length; i += 1_000) {
    await db.insert(siteAuditIssues).values(rows.slice(i, i + 1_000)).onConflictDoNothing();
  }
}

async function brokenInternalLinks(auditId: string): Promise<DetectedIssue[]> {
  const rows = (await db.execute(sql`
    SELECT l.page_id, s.url AS source_url, t.url AS target_url, t.status_code
    FROM site_audit_page_links l
    JOIN site_audit_pages s ON s.id = l.page_id
    CROSS JOIN LATERAL (SELECT DISTINCT e->>'u' AS u FROM jsonb_array_elements(l.links) e WHERE (e->>'i')::boolean) j
    JOIN site_audit_pages t ON t.audit_id = l.audit_id AND t.url = j.u
    WHERE l.audit_id = ${auditId} AND t.status_code >= 400 AND t.fetch_class = 'ok'
    ORDER BY l.page_id, t.url
    LIMIT ${BROKEN_LINK_ISSUE_CAP}`)) as unknown as Array<{ page_id: string; source_url: string; target_url: string; status_code: number }>;
  return rows.map((r) => ({
    issueType: "broken-internal-link" as const,
    pageId: r.page_id,
    pageUrl: r.source_url,
    details: { targetUrl: r.target_url, targetStatus: Number(r.status_code) },
    dedupeKey: r.target_url,
  }));
}

async function orphanPages(auditId: string, startUrl: string): Promise<DetectedIssue[]> {
  const rows = (await db.execute(sql`
    WITH inbound AS (
      SELECT DISTINCT e->>'u' AS url
      FROM site_audit_page_links l
      JOIN site_audit_pages s ON s.id = l.page_id
      CROSS JOIN LATERAL jsonb_array_elements(l.links) e
      WHERE l.audit_id = ${auditId} AND (e->>'i')::boolean AND e->>'u' <> s.url
    )
    SELECT p.id, p.url FROM site_audit_pages p
    WHERE p.audit_id = ${auditId}
      AND p.url <> ${startUrl}
      AND p.fetch_class = 'ok' AND p.status_code BETWEEN 200 AND 299
      AND NOT EXISTS (SELECT 1 FROM inbound i WHERE i.url = p.url)
      AND NOT EXISTS (SELECT 1 FROM site_audit_pages r WHERE r.audit_id = ${auditId} AND r.redirect_url = p.url)`)) as unknown as Array<{
    id: string;
    url: string;
  }>;
  return rows.map((r) => ({ issueType: "orphan-page" as const, pageId: r.id, pageUrl: r.url }));
}

async function updateInlinkCounts(auditId: string) {
  await db.execute(sql`
    UPDATE site_audit_pages p SET inlink_count = COALESCE(c.n, 0)
    FROM (
      SELECT p2.id, x.n FROM site_audit_pages p2
      LEFT JOIN (
        SELECT j.u, count(DISTINCT l.page_id)::int AS n
        FROM site_audit_page_links l
        JOIN site_audit_pages s ON s.id = l.page_id
        CROSS JOIN LATERAL (SELECT DISTINCT e->>'u' AS u FROM jsonb_array_elements(l.links) e WHERE (e->>'i')::boolean) j
        WHERE l.audit_id = ${auditId} AND j.u <> s.url
        GROUP BY j.u
      ) x ON x.u = p2.url
      WHERE p2.audit_id = ${auditId}
    ) c
    WHERE p.id = c.id`);
}

/** Recomputes page scores, audit score and issue counts from stored rows. */
export async function computeAndStoreScores(auditId: string, opts: { rateLimited: boolean }) {
  const pages = await db
    .select({ id: siteAuditPages.id, statusCode: siteAuditPages.statusCode, responseTimeMs: siteAuditPages.responseTimeMs })
    .from(siteAuditPages)
    .where(eq(siteAuditPages.auditId, auditId));
  const issues = await db
    .select({ pageId: siteAuditIssues.pageId, issueType: siteAuditIssues.issueType, severity: siteAuditIssues.severity })
    .from(siteAuditIssues)
    .where(eq(siteAuditIssues.auditId, auditId));
  const { score, pageScores } = computeHealthScore(pages, issues, opts);
  const values = [...pageScores.entries()];
  for (let i = 0; i < values.length; i += 500) {
    const slice = values.slice(i, i + 500);
    const tuples = sql.join(
      slice.map(([id, v]) => sql`(${id}, ${v.score}::int, ${v.issueCount}::int)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE site_audit_pages p SET score = v.score, issue_count = v.issue_count
      FROM (VALUES ${tuples}) AS v(id, score, issue_count)
      WHERE p.id = v.id`);
  }
  const counts = summarizeIssueCounts(issues as Array<{ issueType: string; severity: IssueSeverity }>);
  const okPages = pages.filter((p) => p.statusCode !== null && p.statusCode > 0);
  const avgResponseMs = okPages.length ? Math.round(okPages.reduce((a, p) => a + (p.responseTimeMs ?? 0), 0) / okPages.length) : null;
  return { score, counts, avgResponseMs, pagesCrawled: pages.length };
}

export async function finalizeAudit(audit: AuditRow) {
  await db.update(siteAudits).set({ currentPhase: "finalizing", heartbeatAt: new Date() }).where(eq(siteAudits.id, audit.id));

  const slim: SlimPage[] = await db
    .select({
      id: siteAuditPages.id,
      url: siteAuditPages.url,
      statusCode: siteAuditPages.statusCode,
      fetchClass: siteAuditPages.fetchClass,
      title: siteAuditPages.title,
      metaDescription: siteAuditPages.metaDescription,
      contentHash: siteAuditPages.contentHash,
      redirectUrl: siteAuditPages.redirectUrl,
      wordCount: siteAuditPages.wordCount,
      isIndexable: siteAuditPages.isIndexable,
      canonicalUrl: siteAuditPages.canonicalUrl,
      headerCanonicalUrl: siteAuditPages.headerCanonicalUrl,
    })
    .from(siteAuditPages)
    .where(eq(siteAuditPages.auditId, audit.id));

  if (audit.pagesCrawled > 0 && slim.length === 0) throw new Error("Integrity check failed: crawl reported pages but none were persisted");

  const [fresh] = await db.select().from(siteAudits).where(eq(siteAudits.id, audit.id)).limit(1);
  const current = fresh ?? audit;

  const issues: DetectedIssue[] = [...findDuplicates(slim), ...findRedirectChainsAndLoops(slim), ...(await brokenInternalLinks(audit.id))];
  if (current.crawlCompleted) issues.push(...(await orphanPages(audit.id, audit.startUrl)));
  if (current.rateLimited) issues.push({ issueType: "crawl-rate-limited", pageId: null, pageUrl: audit.startUrl });
  await insertIssues(audit.id, issues);
  await updateInlinkCounts(audit.id);

  const { score, counts, avgResponseMs, pagesCrawled } = await computeAndStoreScores(audit.id, { rateLimited: current.rateLimited });

  const [done] = await db
    .update(siteAudits)
    .set({
      status: "completed",
      currentPhase: "completed",
      completedAt: new Date(),
      pagesCrawled,
      pagesTotal: pagesCrawled,
      score,
      issueCounts: counts,
      avgResponseMs,
      lighthouseTotal: sql`(SELECT count(*)::int FROM site_audit_lighthouse WHERE audit_id = ${audit.id})`,
      runnerId: null,
      heartbeatAt: new Date(),
    })
    .where(and(eq(siteAudits.id, audit.id), inArray(siteAudits.status, ["running", "queued"])))
    .returning();

  // The frontier is transient crawl state (open-seo destroys its scratchpad after finalize).
  await db.delete(siteAuditFrontier).where(eq(siteAuditFrontier.auditId, audit.id));

  if (done) {
    const { afterAuditCompleted } = await import("./notify");
    await afterAuditCompleted(done).catch((err) => console.error("[audit] post-completion hook failed", err));
  }
}

/* ───────────────────────────── Failure ───────────────────────────── */

export function classifyAuditError(err: unknown): { code: string; detail: string } {
  const message = err instanceof Error ? err.message : String(err);
  const detail = message.slice(0, 500);
  if (/heap out of memory|allocation failed/i.test(message)) return { code: "oom", detail };
  if (/timed out|timeout/i.test(message)) return { code: "step_timeout", detail };
  if (/Failed query|ECONNREFUSED.*5432|database|relation .* does not exist|deadlock/i.test(message)) return { code: "db_error", detail };
  if (/CRAWL_TARGET_BLOCKED|private or internal address/i.test(message)) return { code: "crawl_target_blocked", detail };
  if (/Integrity check failed/i.test(message)) return { code: "integrity", detail };
  return { code: "unknown", detail };
}

/** Only transitions audits that are still queued/running (guards the race with finalize). */
export async function failAudit(auditId: string, err: unknown, phase: string, code?: string) {
  const classified = classifyAuditError(err);
  const [row] = await db
    .update(siteAudits)
    .set({
      status: "failed",
      currentPhase: "failed",
      errorCode: code ?? classified.code,
      errorDetail: classified.detail,
      failedPhase: phase,
      completedAt: new Date(),
      runnerId: null,
    })
    .where(and(eq(siteAudits.id, auditId), inArray(siteAudits.status, ["queued", "running"])))
    .returning();
  if (!row) return;
  // Partial results stay viewable: best-effort counts/score over what was crawled.
  try {
    const { score, counts, avgResponseMs, pagesCrawled } = await computeAndStoreScores(auditId, { rateLimited: row.rateLimited });
    await db.update(siteAudits).set({ score, issueCounts: counts, avgResponseMs, pagesCrawled }).where(eq(siteAudits.id, auditId));
  } catch (e) {
    console.warn("[audit] partial scoring failed", e);
  }
  await db.delete(siteAuditFrontier).where(eq(siteAuditFrontier.auditId, auditId));
}
