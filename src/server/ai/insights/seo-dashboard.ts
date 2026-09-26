import "server-only";
import type { ProjectContext } from "@/server/auth/context";
import { getAuditHistory, getLatestAuditSummary } from "@/server/audit-crawler/service";
import { listCrawlabilityChecks } from "@/server/crawlability/service";
import { CATEGORY_MAX } from "@/server/crawlability/scoring";
import { getRankConfigTrend, getRankTrackingResults, listRankConfigSummaries, peekBacklinksOverview, seoContextFromProject } from "@/server/seo";
import { getScConnections, getScOverview, type ScSource } from "@/server/analytics/search-console/queries";
import { getTrafficOverview, getTrafficSources } from "@/server/analytics/traffic/queries";
import { resolveAnalyticsPeriod } from "@/server/analytics/period";
import { countOpenTasks } from "@/server/optimize/counts";

/**
 * Project dashboard cards for the classic SEO modules (open-seo parity). Reads stored data only
 * (latest audit / crawlability check, stored rank snapshots, cached backlink overview, synced Search
 * Console & analytics rows) — never triggers paid provider calls.
 */
export type SeoCards = {
  audit: {
    id: string;
    status: string;
    score: number | null;
    pagesCrawled: number;
    startedAt: string | null;
    completedAt: string | null;
    issueCounts: { critical: number; warning: number; info: number; total: number; types: number } | null;
    topIssues: { issueType: string; title: string; severity: string; pages: number }[];
    totalIssueTypes: number;
    history: number[];
  } | null;
  crawlability: {
    status: string;
    score: number | null;
    checkedAt: string | null;
    /** Category sub-scores as % of their max points, weakest first. */
    categories: { key: string; label: string; pct: number; points: number; max: number }[];
    history: number[];
  } | null;
  rank: {
    configs: number;
    trackedKeywords: number;
    top10: number;
    improved: number;
    declined: number;
    lastCheckedAt: string | null;
    running: boolean;
    trend: number[];
  } | null;
  backlinks: {
    rank: number | null;
    backlinks: number | null;
    referringDomains: number | null;
    newBacklinks: number | null;
    lostBacklinks: number | null;
    capturedAt: string;
    stale: boolean;
    trend: number[];
  } | null;
  searchConsole: {
    status: "not_connected" | "pending" | "connected" | "error";
    source: ScSource | null;
    site: string | null;
    lastSyncAt: string | null;
    label: string;
    data: {
      clicks: number;
      impressions: number;
      ctr: number | null;
      position: number | null;
      clicksDelta: number | null;
      impressionsDelta: number | null;
      series: number[];
    } | null;
  };
  traffic: {
    status: "not_connected" | "pending" | "connected" | "error";
    providerLabel: string | null;
    propertyLabel: string | null;
    lastSyncAt: string | null;
    label: string;
    data: {
      sessions: number;
      sessionsDelta: number | null;
      conversions: number;
      conversionsDelta: number | null;
      aiShare: number | null;
      topPlatform: string | null;
      series: number[];
    } | null;
  };
  openTasks: number;
};

/** Runs a card loader; a failing module must not break the whole dashboard. */
async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[dashboard] ${label} card failed`, err);
    return fallback;
  }
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function getSeoCards(ctx: ProjectContext, preset: string): Promise<SeoCards> {
  const pid = ctx.project.id;
  const seo = seoContextFromProject(ctx);
  const scPeriod = resolveAnalyticsPeriod({ period: preset }, { lagDays: 3 });
  const trafficPeriod = resolveAnalyticsPeriod({ period: preset }, { lagDays: 1 });

  const [audit, auditHistory, crawl, rankConfigs, backlinks, scConn, trafficSources, openTasks] = await Promise.all([
    safe("audit", () => getLatestAuditSummary(pid), null),
    safe("audit history", () => getAuditHistory(pid, 12), []),
    safe("crawlability", () => listCrawlabilityChecks(pid, 12), []),
    safe("rank configs", () => listRankConfigSummaries(seo), []),
    safe("backlinks", () => (ctx.project.domain ? peekBacklinksOverview(seo, ctx.project.domain) : Promise.resolve(null)), null),
    safe("search console", () => getScConnections(pid), null),
    safe("traffic sources", () => getTrafficSources(pid), []),
    safe("open tasks", () => countOpenTasks(pid), 0),
  ]);

  // Second round (depends on connection state / configs) — all in parallel.
  const scSource: ScSource | null = scConn?.google.connected ? "google" : scConn?.bing.connected ? "bing" : null;
  const trafficSource = trafficSources.find((s) => s.status === "connected") ?? null;
  const rankTop = rankConfigs.slice(0, 5);
  const first = rankTop[0];
  const [scOverview, trafficOverview, rankResults, rankTrend] = await Promise.all([
    scSource ? safe("search console overview", () => getScOverview(pid, scSource, scPeriod), null) : Promise.resolve(null),
    trafficSource ? safe("traffic overview", () => getTrafficOverview(pid, trafficSource.provider, trafficPeriod, "daily"), null) : Promise.resolve(null),
    Promise.all(rankTop.map((c) => safe("rank results", () => getRankTrackingResults(seo, c.id, "7d"), null))),
    first
      ? safe("rank trend", () => getRankConfigTrend(seo, { configId: first.id, device: first.devices === "mobile" ? "mobile" : "desktop", sinceDays: 180 }), [])
      : Promise.resolve([]),
  ]);

  /* ── rank ── */
  let rank: SeoCards["rank"] = null;
  if (rankConfigs.length) {
    let tracked = 0;
    let top10 = 0;
    let improved = 0;
    let declined = 0;
    let last: Date | null = null;
    let running = false;
    for (const r of rankResults) {
      if (!r) continue;
      tracked += r.rows.length;
      for (const row of r.rows) {
        for (const d of [row.desktop, row.mobile]) {
          if (d.position == null) continue;
          if (d.position <= 10) top10++;
          if (d.previousPosition != null && d.position < d.previousPosition) improved++;
          if (d.previousPosition != null && d.position > d.previousPosition) declined++;
        }
      }
      const at = r.run?.lastCheckedAt ?? null;
      if (at && (!last || at > last)) last = at;
      if (r.run && r.run.status === "pending") running = true;
    }
    rank = {
      configs: rankConfigs.length,
      trackedKeywords: tracked,
      top10,
      improved,
      declined,
      lastCheckedAt: iso(last),
      running,
      trend: rankTrend.map((t) => t.top3 + t.top4to10),
    };
  }

  /* ── search console ── */
  const scInfo = scSource ? scConn![scSource] : (scConn?.google.status !== "not_connected" ? scConn?.google : scConn?.bing) ?? null;
  const searchConsole: SeoCards["searchConsole"] = {
    status: scInfo?.status ?? "not_connected",
    source: scSource,
    site: scInfo?.site ?? null,
    lastSyncAt: scInfo?.lastSyncAt ?? null,
    label: scPeriod.label,
    data:
      scOverview && scOverview.hasData
        ? {
            clicks: scOverview.totals.clicks,
            impressions: scOverview.totals.impressions,
            ctr: scOverview.totals.ctr,
            position: scOverview.totals.position,
            clicksDelta: scOverview.deltas.clicks,
            impressionsDelta: scOverview.deltas.impressions,
            series: scOverview.series.map((d) => d.clicks),
          }
        : null,
  };

  /* ── AI traffic (GA4 / Matomo / Piwik) ── */
  const anySource = trafficSource ?? trafficSources[0] ?? null;
  const traffic: SeoCards["traffic"] = {
    status: anySource ? anySource.status : "not_connected",
    providerLabel: anySource?.label ?? null,
    propertyLabel: anySource?.propertyLabel || null,
    lastSyncAt: anySource?.lastSyncAt ?? null,
    label: trafficPeriod.label,
    data:
      trafficOverview && trafficOverview.hasData
        ? {
            sessions: trafficOverview.kpis.sessions,
            sessionsDelta: trafficOverview.kpis.sessionsDelta,
            conversions: trafficOverview.kpis.conversions,
            conversionsDelta: trafficOverview.kpis.conversionsDelta,
            aiShare: trafficOverview.kpis.aiShare,
            topPlatform: trafficOverview.platforms[0]?.name ?? null,
            series: trafficOverview.series.map((row) =>
              Object.entries(row).reduce((s, [k, v]) => (k === "date" ? s : s + (Number(v) || 0)), 0),
            ),
          }
        : null,
  };

  const scores = (list: { score: number | null }[]) =>
    list
      .map((a) => a.score)
      .filter((s): s is number => s != null)
      .reverse();

  const latestCrawl = crawl[0];
  return {
    audit: audit
      ? {
          id: audit.id,
          status: audit.status,
          score: audit.score,
          pagesCrawled: audit.pagesCrawled,
          startedAt: iso(audit.startedAt),
          completedAt: iso(audit.completedAt),
          issueCounts: audit.issueCounts ?? null,
          topIssues: audit.topIssues.map((i) => ({ issueType: i.issueType, title: i.title, severity: i.severity, pages: i.pages })),
          totalIssueTypes: audit.totalIssueTypes,
          history: scores(auditHistory.filter((a) => a.status === "completed")),
        }
      : null,
    crawlability: latestCrawl
      ? {
          status: latestCrawl.status,
          score: latestCrawl.score,
          checkedAt: iso(latestCrawl.completedAt ?? latestCrawl.createdAt),
          categories: Object.entries(latestCrawl.scores ?? {})
            .map(([key, points]) => {
              const def = CATEGORY_MAX[key as keyof typeof CATEGORY_MAX];
              const max = def?.max ?? 0;
              return { key, label: def?.label ?? key, points: Number(points), max, pct: max > 0 ? (Number(points) / max) * 100 : 0 };
            })
            .filter((c) => c.max > 0 && Number.isFinite(c.points))
            .sort((a, b) => a.pct - b.pct || b.max - a.max),
          history: scores(crawl.filter((c) => c.status === "completed")),
        }
      : null,
    rank,
    backlinks: backlinks
      ? {
          rank: backlinks.overview.summary.rank,
          backlinks: backlinks.overview.summary.backlinks,
          referringDomains: backlinks.overview.summary.referringDomains,
          newBacklinks: backlinks.overview.summary.newBacklinks,
          lostBacklinks: backlinks.overview.summary.lostBacklinks,
          capturedAt: backlinks.capturedAt.toISOString(),
          stale: backlinks.stale,
          trend: backlinks.overview.trends.map((t) => t.referringDomains).filter((v): v is number => v != null),
        }
      : null,
    searchConsole,
    traffic,
    openTasks,
  };
}
