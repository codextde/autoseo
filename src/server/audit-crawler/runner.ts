import "server-only";
/**
 * Durable, chunked site-audit runner (replaces open-seo's Cloudflare Workflow + Durable Object).
 *
 * Every `audit.run` job executes one chunk (≤ CHUNK_BUDGET_MS of work) against Postgres-backed
 * state — the frontier table, page/issue rows, and the checkpointed throttle on the audit row —
 * then re-enqueues a continuation job. A restart therefore loses at most the in-flight fetches of
 * one sub-batch: leased frontier rows go back to pending and the next chunk resumes.
 *
 * Phases: discovery → crawling → lighthouse → finalizing → completed (| failed).
 */
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { siteAuditFrontier, siteAuditIssues, siteAuditLighthouse, siteAuditPageLinks, siteAuditPages, siteAudits } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import type { JobContext } from "@/server/jobs/types";
import { getSetting } from "@/server/settings";
import { projects } from "@/server/db/schema";
import { createCrawlThrottle, initialThrottleState, type CrawlThrottleState } from "./crawl-throttle";
import { adjustCrawlWindow, clampCrawlWindow, crawlWindowLimits } from "./crawl-window";
import { discoverSitemapUrls, fetchRobotsTxt } from "./discovery";
import { crawlPage } from "./fetch-page";
import { deterministicAuditRowId } from "./ids";
import { selectLighthouseSample } from "./lighthouse/sample";
import { runLighthouse } from "./lighthouse/providers";
import { runPageReporters } from "./page-reporters";
import { CRAWLER_USER_AGENT_TOKEN } from "./registry";
import { issueRows } from "./issue-rows";
import { isAllowed, matchGroup, parseRobotsTxt } from "./robots";
import { isCrawlableUrl } from "./url-policy";
import { isSameOrigin, normalizeUrl } from "./url-utils";
import { finalizeAudit, failAudit, classifyAuditError } from "./finalize";
import type { CrawledPageResult } from "./types";

export const AUDIT_RUN_JOB = "audit.run";

const CHUNK_BUDGET_MS = 4 * 60_000;
/** Small lease batches keep link-discovered URLs (with click depth) ahead of sitemap-only ones. */
const CLAIM_BATCH_MIN = 30;
const PERSIST_BATCH_SIZE = 25;
const FIRST_PERSIST_BATCH_SIZE = 5;
const MAX_STORED_LINKS_PER_PAGE = 500;
const MAX_DISCOVERED_PER_BATCH = 20_000;
const LEASE_STALE_MS = 3 * 60_000;
const DEFAULT_INTERVAL_MS = 250;
const MAX_CRAWL_DELAY_MS = 20_000;
const LIGHTHOUSE_CONCURRENCY = { psi: 3, dataforseo: 5 } as const;
/** Don't start a Lighthouse call with less budget than this left in the chunk. */
const LIGHTHOUSE_MIN_REMAINING_MS = 20_000;

type AuditRow = typeof siteAudits.$inferSelect;

export type ChunkOutcome =
  | { kind: "done"; status: string }
  | { kind: "continue"; runAt?: Date; phase: string }
  | { kind: "skipped"; reason: string };

/* ───────────────────────────── Lease ───────────────────────────── */

async function acquireLease(auditId: string, runnerId: string): Promise<AuditRow | null> {
  const [row] = await db
    .update(siteAudits)
    .set({ runnerId, heartbeatAt: new Date(), status: sql`CASE WHEN ${siteAudits.status} = 'queued' THEN 'running' ELSE ${siteAudits.status} END` })
    .where(
      and(
        eq(siteAudits.id, auditId),
        inArray(siteAudits.status, ["queued", "running"]),
        sql`(${siteAudits.runnerId} IS NULL OR ${siteAudits.runnerId} = ${runnerId} OR ${siteAudits.heartbeatAt} < now() - (${Math.round(LEASE_STALE_MS / 1000)} || ' seconds')::interval)`,
      ),
    )
    .returning();
  return row ?? null;
}

async function releaseLease(auditId: string, runnerId: string) {
  await db
    .update(siteAudits)
    .set({ runnerId: null })
    .where(and(eq(siteAudits.id, auditId), eq(siteAudits.runnerId, runnerId)));
}

async function heartbeat(auditId: string, patch: Partial<typeof siteAudits.$inferInsert> = {}) {
  await db
    .update(siteAudits)
    .set({ ...patch, heartbeatAt: new Date() })
    .where(eq(siteAudits.id, auditId));
}

async function readControl(auditId: string): Promise<{ status: string; stopRequested: boolean } | null> {
  const [row] = await db
    .select({ status: siteAudits.status, stopRequested: siteAudits.stopRequested })
    .from(siteAudits)
    .where(eq(siteAudits.id, auditId))
    .limit(1);
  return row ?? null;
}

export async function enqueueAuditContinuation(audit: Pick<AuditRow, "id" | "projectId" | "chunkNo">, runAt?: Date) {
  return enqueueJob(
    AUDIT_RUN_JOB,
    { auditId: audit.id },
    {
      runAt,
      priority: 60,
      maxAttempts: 3,
      dedupeKey: `audit-run:${audit.id}:${audit.chunkNo}`,
      projectId: audit.projectId,
    },
  );
}

/* ───────────────────────────── Discovery ───────────────────────────── */

async function runDiscovery(audit: AuditRow) {
  await heartbeat(audit.id, { currentPhase: "discovery", status: "running" });
  const origin = new URL(audit.startUrl).origin;
  const robotsFetch = await fetchRobotsTxt(origin);
  const robots = parseRobotsTxt(robotsFetch.text);
  const allowed = (url: string) => isAllowed(robots, CRAWLER_USER_AGENT_TOKEN, url).allowed;
  const { urls: sitemapUrls } = await discoverSitemapUrls(origin, robots.sitemaps, audit.config.maxPages);

  const start = normalizeUrl(audit.startUrl);
  await db.transaction(async (tx) => {
    if (start && isCrawlableUrl(start) && allowed(start)) {
      await tx
        .insert(siteAuditFrontier)
        .values({ auditId: audit.id, url: start, depth: 0, source: "link", inSitemap: false })
        .onConflictDoNothing();
    }
    const seeds = [...new Set(sitemapUrls)].filter((u) => isSameOrigin(u, audit.startUrl) && isCrawlableUrl(u) && allowed(u));
    for (let i = 0; i < seeds.length; i += 2_000) {
      const chunk = seeds.slice(i, i + 2_000);
      await tx
        .insert(siteAuditFrontier)
        .values(chunk.map((url) => ({ auditId: audit.id, url, depth: null, source: "sitemap" as const, inSitemap: true })))
        .onConflictDoUpdate({ target: [siteAuditFrontier.auditId, siteAuditFrontier.url], set: { inSitemap: true } });
    }
  });
  const [{ seen }] = (await db
    .select({ seen: count() })
    .from(siteAuditFrontier)
    .where(eq(siteAuditFrontier.auditId, audit.id))) as [{ seen: number }];
  await heartbeat(audit.id, {
    robotsTxt: robotsFetch.text,
    robotsFetched: true,
    pagesTotal: Math.min(Number(seen), audit.config.maxPages),
    currentPhase: "crawling",
  });
}

/* ───────────────────────────── Crawl ───────────────────────────── */

type Lease = { url: string; depth: number | null; inSitemap: boolean };

async function claimLeases(auditId: string, limit: number): Promise<Lease[]> {
  if (limit <= 0) return [];
  // The locking CTE is evaluated exactly once. (An UPDATE … FROM (SELECT … LIMIT n FOR UPDATE SKIP LOCKED)
  // subquery can be rescanned by the planner and then leases far more than n rows.)
  const rows = (await db.execute(sql`
    WITH c AS MATERIALIZED (
      SELECT url FROM site_audit_frontier
      WHERE audit_id = ${auditId} AND state = 'pending'
      ORDER BY (source = 'link') DESC, seq ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE site_audit_frontier f SET state = 'leased'
    FROM c
    WHERE f.audit_id = ${auditId} AND f.url = c.url
    RETURNING f.url, f.depth, f.in_sitemap, f.seq`)) as unknown as Array<{ url: string; depth: number | null; in_sitemap: boolean; seq: number }>;
  // Keep the priority order (UPDATE … RETURNING does not preserve it).
  return rows
    .sort((a, b) => Number(a.seq) - Number(b.seq))
    .map((r) => ({ url: r.url, depth: r.depth, inSitemap: r.in_sitemap }));
}

async function releaseLeases(auditId: string, urls: string[]) {
  if (!urls.length) return;
  await db
    .update(siteAuditFrontier)
    .set({ state: "pending" })
    .where(and(eq(siteAuditFrontier.auditId, auditId), inArray(siteAuditFrontier.url, urls), eq(siteAuditFrontier.state, "leased")));
}

async function frontierStats(auditId: string): Promise<{ crawled: number; pending: number; seen: number }> {
  const rows = (await db.execute(sql`
    SELECT count(*) FILTER (WHERE state = 'crawled')::int AS crawled,
           count(*) FILTER (WHERE state <> 'crawled')::int AS pending,
           count(*)::int AS seen
    FROM site_audit_frontier WHERE audit_id = ${auditId}`)) as unknown as Array<{ crawled: number; pending: number; seen: number }>;
  const r = rows[0] ?? { crawled: 0, pending: 0, seen: 0 };
  return { crawled: Number(r.crawled), pending: Number(r.pending), seen: Number(r.seen) };
}

function pageRow(auditId: string, p: CrawledPageResult) {
  const internal = p.links.filter((l) => l.isInternal).length;
  return {
    id: p.id,
    auditId,
    url: p.url,
    statusCode: p.statusCode,
    fetchClass: p.fetchClass,
    redirectUrl: p.redirectUrl,
    contentType: p.contentType?.slice(0, 200) ?? null,
    title: p.title.slice(0, 1000),
    metaDescription: p.metaDescription.slice(0, 2000),
    canonicalUrl: p.canonicalUrl,
    robotsMeta: p.robotsMeta?.slice(0, 500) ?? null,
    xRobotsTag: p.xRobotsTag?.slice(0, 500) ?? null,
    headerCanonicalUrl: p.headerCanonicalUrl,
    ogTitle: p.ogTitle?.slice(0, 1000) ?? null,
    ogDescription: p.ogDescription?.slice(0, 2000) ?? null,
    ogImage: p.ogImage?.slice(0, 1000) ?? null,
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
    hasStructuredData: p.hasStructuredData,
    structuredDataTypes: p.structuredDataTypes,
    hreflangTags: p.hreflangTags,
    lang: p.lang?.slice(0, 50) ?? null,
    isIndexable: p.isIndexable,
    crawlDepth: p.crawlDepth,
    inSitemap: p.inSitemap,
    responseTimeMs: p.responseTimeMs,
    crawledAt: new Date(),
  };
}

async function persistBatch(
  audit: AuditRow,
  batch: Array<{ result: CrawledPageResult; lease: Lease }>,
  shouldQueue: (url: string) => boolean,
  maxFrontier: number,
  frontierSeen: { value: number },
) {
  if (!batch.length) return;
  // A sitemap-leased URL may have been reached via a link meanwhile: use its click depth.
  if (batch.some((b) => b.result.crawlDepth === null)) {
    const rows = await db
      .select({ url: siteAuditFrontier.url, depth: siteAuditFrontier.depth })
      .from(siteAuditFrontier)
      .where(and(eq(siteAuditFrontier.auditId, audit.id), inArray(siteAuditFrontier.url, batch.map((b) => b.lease.url))));
    const depthByUrl = new Map(rows.map((r) => [r.url, r.depth]));
    for (const b of batch) if (b.result.crawlDepth === null) b.result.crawlDepth = depthByUrl.get(b.lease.url) ?? null;
  }
  const pages = batch.map((b) => pageRow(audit.id, b.result));
  const issues = issueRows(
    audit.id,
    batch.flatMap((b) => runPageReporters(b.result)),
  );
  const links = batch
    .filter((b) => b.result.links.length > 0)
    .map((b) => ({
      pageId: b.result.id,
      auditId: audit.id,
      links: b.result.links.slice(0, MAX_STORED_LINKS_PER_PAGE).map((l) => ({ u: l.targetUrl, a: l.anchor, i: l.isInternal, n: l.isNofollow })),
    }));

  // Discovered URLs (global dedup via the frontier PK). Redirect targets keep the redirecting depth.
  const discovered = new Map<string, number | null>();
  for (const { result } of batch) {
    const childDepth = result.crawlDepth === null ? null : result.crawlDepth + 1;
    if (result.redirectUrl && shouldQueue(result.redirectUrl) && !discovered.has(result.redirectUrl)) {
      discovered.set(result.redirectUrl, result.crawlDepth);
    }
    for (const link of result.links) {
      if (discovered.size >= MAX_DISCOVERED_PER_BATCH) break;
      if (!link.isInternal || discovered.has(link.targetUrl)) continue;
      if (!shouldQueue(link.targetUrl)) continue;
      discovered.set(link.targetUrl, childDepth);
    }
  }
  const room = Math.max(0, maxFrontier - frontierSeen.value);
  const discoveredRows = [...discovered.entries()].slice(0, Math.max(room, 0)).map(([url, depth]) => ({
    auditId: audit.id,
    url,
    depth,
    source: "link" as const,
    inSitemap: false,
  }));

  await db.transaction(async (tx) => {
    await tx
      .insert(siteAuditPages)
      .values(pages)
      .onConflictDoUpdate({
        target: siteAuditPages.id,
        set: Object.fromEntries(
          Object.keys(pages[0]!)
            .filter((k) => k !== "id" && k !== "auditId")
            .map((k) => [k, sql.raw(`excluded.${k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)}`)]),
        ),
      });
    if (links.length) {
      await tx.insert(siteAuditPageLinks).values(links).onConflictDoUpdate({ target: siteAuditPageLinks.pageId, set: { links: sql`excluded.links` } });
    }
    if (issues.length) await tx.insert(siteAuditIssues).values(issues).onConflictDoNothing();
    await tx
      .update(siteAuditFrontier)
      .set({ state: "crawled" })
      .where(and(eq(siteAuditFrontier.auditId, audit.id), inArray(siteAuditFrontier.url, batch.map((b) => b.lease.url))));
    for (let i = 0; i < discoveredRows.length; i += 2_000) {
      const chunk = discoveredRows.slice(i, i + 2_000);
      // A pending sitemap-only row reached via a link gets its click depth (and link priority).
      await tx
        .insert(siteAuditFrontier)
        .values(chunk)
        .onConflictDoUpdate({
          target: [siteAuditFrontier.auditId, siteAuditFrontier.url],
          set: { depth: sql`excluded.depth`, source: sql`'link'` },
          setWhere: sql`${siteAuditFrontier.depth} IS NULL AND ${siteAuditFrontier.state} <> 'crawled' AND excluded.depth IS NOT NULL`,
        });
    }
  });
}

async function runCrawl(audit: AuditRow, deadline: number, runnerId: string): Promise<{ finished: boolean; resumeAt?: Date }> {
  const limits = await getSetting("limits");
  const windowLimits = crawlWindowLimits(Math.min(audit.config.concurrency || limits.auditConcurrency, limits.auditConcurrency));
  const maxPages = audit.config.maxPages;
  const robots = parseRobotsTxt(audit.robotsTxt);
  const group = matchGroup(robots, CRAWLER_USER_AGENT_TOKEN);
  const crawlDelayMs = group.crawlDelay ? Math.min(group.crawlDelay * 1000, MAX_CRAWL_DELAY_MS) : 0;
  const allowed = (url: string) => isAllowed(robots, CRAWLER_USER_AGENT_TOKEN, url).allowed;
  const shouldQueue = (url: string) => isSameOrigin(url, audit.startUrl) && isCrawlableUrl(url) && allowed(url);
  const maxFrontier = Math.min(Math.max(maxPages * 20, 500), 200_000);

  // We own the lease: anything still leased belongs to a dead runner.
  await db
    .update(siteAuditFrontier)
    .set({ state: "pending" })
    .where(and(eq(siteAuditFrontier.auditId, audit.id), eq(siteAuditFrontier.state, "leased")));

  const persistThrottle = async (state: CrawlThrottleState) => {
    await db.update(siteAudits).set({ throttleState: state }).where(and(eq(siteAudits.id, audit.id), eq(siteAudits.runnerId, runnerId)));
  };
  const throttle = createCrawlThrottle(deadline, audit.throttleState ?? initialThrottleState(DEFAULT_INTERVAL_MS), persistThrottle, {
    minIntervalMs: crawlDelayMs || undefined,
  });

  let stats = await frontierStats(audit.id);
  const frontierSeen = { value: stats.seen };
  let windowSize = clampCrawlWindow(crawlDelayMs ? 1 : (audit.windowHint ?? windowLimits.initial), windowLimits);
  if (crawlDelayMs) windowLimits.max = 1;
  let firstBatch = stats.crawled === 0;
  let fetchedThisChunk = 0;

  while (Date.now() < deadline && stats.crawled < maxPages && !throttle.stopped) {
    const control = await readControl(audit.id);
    if (!control || control.status === "cancelled" || control.status === "failed" || control.stopRequested) break;

    const leases = await claimLeases(audit.id, Math.min(Math.max(CLAIM_BATCH_MIN, windowSize * 4), maxPages - stats.crawled));
    if (!leases.length) break; // frontier exhausted

    const queue = [...leases];
    const deferred: string[] = [];
    const inFlight = new Set<Promise<void>>();
    const buffer: Array<{ result: CrawledPageResult; lease: Lease }> = [];
    let stop = false;

    const flush = async (force: boolean) => {
      const size = firstBatch ? FIRST_PERSIST_BATCH_SIZE : PERSIST_BATCH_SIZE;
      if (!buffer.length || (!force && buffer.length < size)) return;
      const batch = buffer.splice(0, buffer.length);
      await persistBatch(audit, batch, shouldQueue, maxFrontier, frontierSeen);
      firstBatch = false;
      windowSize = adjustCrawlWindow(windowSize, batch.map((b) => b.result), windowLimits);
      stats = await frontierStats(audit.id);
      frontierSeen.value = stats.seen;
      await heartbeat(audit.id, {
        pagesCrawled: stats.crawled,
        pagesTotal: Math.min(stats.seen, maxPages),
        windowHint: windowSize,
      });
      const ctl = await readControl(audit.id);
      if (!ctl || ctl.status !== "running" || ctl.stopRequested) stop = true;
    };

    while (queue.length || inFlight.size) {
      while (queue.length && inFlight.size < windowSize && Date.now() < deadline && !throttle.stopped && !stop) {
        const lease = queue.shift()!;
        const p: Promise<void> = crawlPage(audit.id, lease.url, lease.depth, lease.inSitemap, throttle)
          .then((result) => {
            if (result) {
              buffer.push({ result, lease });
              fetchedThisChunk += 1;
            } else deferred.push(lease.url);
          })
          .catch((err) => {
            deferred.push(lease.url);
            if (throttle.checkpointFailed) throw err;
          })
          .finally(() => {
            inFlight.delete(p);
          });
        inFlight.add(p);
      }
      if (!inFlight.size) break;
      await Promise.race(inFlight);
      await flush(false);
    }
    await flush(true);
    await releaseLeases(audit.id, [...queue.map((l) => l.url), ...deferred]);
    if (stop) break;
  }

  stats = await frontierStats(audit.id);
  const idle = fetchedThisChunk === 0;
  const idleChunks = idle ? audit.idleChunks + 1 : 0;
  await heartbeat(audit.id, { pagesCrawled: stats.crawled, pagesTotal: Math.min(stats.seen, maxPages), idleChunks, windowHint: windowSize });

  const control = await readControl(audit.id);
  if (control?.stopRequested) return { finished: true };
  if (throttle.stopped && !throttle.checkpointFailed) {
    await heartbeat(audit.id, { rateLimited: true, crawlCompleted: false });
    return { finished: true };
  }
  const budgetReached = stats.crawled >= maxPages;
  const exhausted = stats.pending === 0;
  if (budgetReached || exhausted) {
    await heartbeat(audit.id, { crawlCompleted: exhausted });
    return { finished: true };
  }
  // Two consecutive chunks without progress → frontier unservable; stop crawling.
  if (idleChunks >= 2 && throttle.state.pausedUntil <= Date.now()) return { finished: true };
  const pausedUntil = throttle.state.pausedUntil;
  return { finished: false, resumeAt: pausedUntil > Date.now() ? new Date(pausedUntil) : undefined };
}

/* ───────────────────────────── Lighthouse ───────────────────────────── */

async function lighthouseCounts(auditId: string) {
  const rows = (await db.execute(sql`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status = 'done')::int AS done,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*) FILTER (WHERE status IN ('pending','running'))::int AS open
    FROM site_audit_lighthouse WHERE audit_id = ${auditId}`)) as unknown as Array<{ total: number; done: number; failed: number; open: number }>;
  const r = rows[0]!;
  return { total: Number(r.total), done: Number(r.done), failed: Number(r.failed), open: Number(r.open) };
}

async function prepareLighthouse(audit: AuditRow): Promise<number> {
  const existing = await lighthouseCounts(audit.id);
  if (existing.total > 0) return existing.total;
  const pages = await db
    .select({ id: siteAuditPages.id, url: siteAuditPages.url, statusCode: siteAuditPages.statusCode, contentType: siteAuditPages.contentType, fetchClass: siteAuditPages.fetchClass })
    .from(siteAuditPages)
    .where(eq(siteAuditPages.auditId, audit.id));
  const sample = selectLighthouseSample(
    pages
      .filter((p) => p.fetchClass === "ok")
      .map((p) => ({ url: p.url, statusCode: p.statusCode, isHtml: (p.contentType ?? "").includes("html") })),
    audit.startUrl,
    audit.config.lighthouseStrategy,
  );
  if (!sample.length) return 0;
  const byUrl = new Map(pages.map((p) => [p.url, p.id]));
  const rows = sample.flatMap((url) =>
    (["mobile", "desktop"] as const).map((strategy) => ({
      id: deterministicAuditRowId(audit.id, url, strategy),
      auditId: audit.id,
      pageId: byUrl.get(url) ?? null,
      url,
      strategy,
      provider: audit.config.lighthouseProvider,
      status: "pending" as const,
    })),
  );
  await db.insert(siteAuditLighthouse).values(rows).onConflictDoNothing();
  await heartbeat(audit.id, { lighthouseTotal: rows.length });
  return rows.length;
}

async function claimLighthouseRow(auditId: string) {
  const rows = (await db.execute(sql`
    WITH c AS MATERIALIZED (
      SELECT id FROM site_audit_lighthouse WHERE audit_id = ${auditId} AND status = 'pending'
      ORDER BY url, strategy LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE site_audit_lighthouse l SET status = 'running', updated_at = now()
    FROM c WHERE l.id = c.id
    RETURNING l.id, l.url, l.strategy, l.provider`)) as unknown as Array<{ id: string; url: string; strategy: "mobile" | "desktop"; provider: "psi" | "dataforseo" }>;
  return rows[0] ?? null;
}

async function runLighthousePhase(audit: AuditRow, deadline: number, workspaceId: string): Promise<{ finished: boolean }> {
  await heartbeat(audit.id, { currentPhase: "lighthouse" });
  const total = await prepareLighthouse(audit);
  if (!total) return { finished: true };

  // Interrupted calls: billed providers are never replayed; the free PSI API may retry.
  await db.execute(sql`
    UPDATE site_audit_lighthouse SET
      status = CASE WHEN provider = 'psi' THEN 'pending' ELSE 'failed' END,
      error_message = CASE WHEN provider = 'psi' THEN NULL ELSE 'Interrupted before completion — not retried to avoid double billing.' END,
      updated_at = now()
    WHERE audit_id = ${audit.id} AND status = 'running'`);

  const concurrency = LIGHTHOUSE_CONCURRENCY[audit.config.lighthouseProvider] ?? 3;
  const worker = async () => {
    while (Date.now() < deadline - LIGHTHOUSE_MIN_REMAINING_MS) {
      const ctl = await readControl(audit.id);
      if (!ctl || ctl.status !== "running" || ctl.stopRequested) return;
      const row = await claimLighthouseRow(audit.id);
      if (!row) return;
      try {
        const payload = await runLighthouse(row.provider, row.url, row.strategy, { projectId: audit.projectId, workspaceId, userId: audit.createdBy });
        const json = JSON.stringify(payload);
        await db
          .update(siteAuditLighthouse)
          .set({
            status: "done",
            performanceScore: payload.scores.performance,
            accessibilityScore: payload.scores.accessibility,
            bestPracticesScore: payload.scores["best-practices"],
            seoScore: payload.scores.seo,
            lcpMs: payload.metrics.largestContentfulPaint.numericValue,
            cls: payload.metrics.cumulativeLayoutShift.numericValue,
            inpMs: payload.metrics.interactionToNextPaint.numericValue,
            ttfbMs: payload.metrics.serverResponseTime.numericValue,
            payload: payload as unknown as Record<string, unknown>,
            payloadSizeBytes: Buffer.byteLength(json),
            costUsd: payload.metadata.cost,
            errorMessage: null,
          })
          .where(eq(siteAuditLighthouse.id, row.id));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        (message.includes("Lighthouse encountered an error") ? console.warn : console.error)(
          `[audit] Lighthouse failed for ${row.url} (${row.strategy}): ${message}`,
        );
        await db
          .update(siteAuditLighthouse)
          .set({ status: "failed", errorMessage: message.slice(0, 1000) })
          .where(eq(siteAuditLighthouse.id, row.id));
        // A daily-quota error will fail every remaining check: stop hammering the API.
        if (/quota exceeded|rateLimitExceeded|dailyLimitExceeded/i.test(message)) {
          await db
            .update(siteAuditLighthouse)
            .set({ status: "failed", errorMessage: message.slice(0, 1000) })
            .where(and(eq(siteAuditLighthouse.auditId, audit.id), eq(siteAuditLighthouse.status, "pending")));
        }
      }
      const c = await lighthouseCounts(audit.id);
      await heartbeat(audit.id, { lighthouseTotal: c.total, lighthouseCompleted: c.done, lighthouseFailed: c.failed });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const c = await lighthouseCounts(audit.id);
  await heartbeat(audit.id, { lighthouseTotal: c.total, lighthouseCompleted: c.done, lighthouseFailed: c.failed });
  const ctl = await readControl(audit.id);
  if (ctl?.stopRequested) {
    await db
      .update(siteAuditLighthouse)
      .set({ status: "failed", errorMessage: "Skipped — the audit was stopped." })
      .where(and(eq(siteAuditLighthouse.auditId, audit.id), eq(siteAuditLighthouse.status, "pending")));
    return { finished: true };
  }
  return { finished: c.open === 0 };
}

/* ───────────────────────────── Chunk driver ───────────────────────────── */

export async function runAuditChunk(auditId: string, runnerId: string, opts: { budgetMs?: number } = {}): Promise<ChunkOutcome> {
  const audit = await acquireLease(auditId, runnerId);
  if (!audit) {
    const control = await readControl(auditId);
    if (!control) return { kind: "skipped", reason: "deleted" };
    if (!["queued", "running"].includes(control.status)) return { kind: "done", status: control.status };
    return { kind: "skipped", reason: "another runner holds the lease" };
  }
  const [project] = await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, audit.projectId)).limit(1);
  const workspaceId = project?.workspaceId ?? "";
  const deadline = Date.now() + (opts.budgetMs ?? CHUNK_BUDGET_MS);
  let current: AuditRow = audit;
  const reload = async () => {
    const [row] = await db.select().from(siteAudits).where(eq(siteAudits.id, auditId)).limit(1);
    if (row) current = row;
    return row;
  };

  try {
    // discovery
    if (current.currentPhase === "queued" || current.currentPhase === "discovery") {
      await runDiscovery(current);
      await reload();
    }
    // crawling
    if (current.currentPhase === "crawling") {
      const res = current.stopRequested ? { finished: true } : await runCrawl(current, deadline, runnerId);
      if (!res.finished) return await continueLater(current, runnerId, "resumeAt" in res ? res.resumeAt : undefined);
      await reload();
      const next = current.config.lighthouseStrategy === "auto" && !current.stopRequested ? "lighthouse" : "finalizing";
      await heartbeat(auditId, { currentPhase: next });
      await reload();
    }
    // lighthouse
    if (current.currentPhase === "lighthouse") {
      if (Date.now() > deadline - 60_000) return await continueLater(current, runnerId);
      const res = await runLighthousePhase(current, deadline, workspaceId);
      if (!res.finished) return await continueLater(current, runnerId);
      await heartbeat(auditId, { currentPhase: "finalizing" });
      await reload();
    }
    // finalize
    if (current.currentPhase === "finalizing") {
      const control = await readControl(auditId);
      if (control?.status === "cancelled") return { kind: "done", status: "cancelled" };
      await finalizeAudit(current);
      await releaseLease(auditId, runnerId);
      return { kind: "done", status: "completed" };
    }
    await releaseLease(auditId, runnerId);
    return { kind: "done", status: current.status };
  } catch (err) {
    await releaseLease(auditId, runnerId).catch(() => {});
    throw err;
  }
}

async function continueLater(audit: AuditRow, runnerId: string, runAt?: Date): Promise<ChunkOutcome> {
  const [row] = await db
    .update(siteAudits)
    .set({ chunkNo: sql`${siteAudits.chunkNo} + 1`, runnerId: null, heartbeatAt: new Date() })
    .where(and(eq(siteAudits.id, audit.id), eq(siteAudits.runnerId, runnerId)))
    .returning({ id: siteAudits.id, projectId: siteAudits.projectId, chunkNo: siteAudits.chunkNo, currentPhase: siteAudits.currentPhase });
  if (row) await enqueueAuditContinuation(row, runAt);
  return { kind: "continue", runAt, phase: row?.currentPhase ?? audit.currentPhase };
}

/** Job entrypoint (registered in jobs/handlers/audit.ts). */
export async function runAuditJob(payload: { auditId: string }, ctx: JobContext) {
  const runnerId = `job:${ctx.job.id}`;
  try {
    const outcome = await runAuditChunk(payload.auditId, runnerId);
    ctx.log(`chunk → ${outcome.kind}${"phase" in outcome ? ` (${outcome.phase})` : ""}`);
    return outcome;
  } catch (err) {
    const lastAttempt = ctx.job.attempts >= ctx.job.maxAttempts;
    const [row] = await db.select({ currentPhase: siteAudits.currentPhase }).from(siteAudits).where(eq(siteAudits.id, payload.auditId)).limit(1);
    if (lastAttempt && row) {
      await failAudit(payload.auditId, err, row.currentPhase);
      return { kind: "done", status: "failed", error: classifyAuditError(err).code };
    }
    throw err;
  }
}
