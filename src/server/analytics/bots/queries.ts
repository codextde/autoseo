import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { integrations, logIngestStats, type BotVisitSource } from "@/server/db/schema";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { addDays, dateRange, isoDate, pctChange, type AnalyticsPeriod } from "@/server/analytics/period";
import type { LogUpload } from "./uploads";
import { getBotInfo } from "./bot-classifier";

export type SerializedUpload = {
  id: string;
  filename: string;
  sizeBytes: number;
  receivedBytes: number;
  format: string;
  detectedFormat: string | null;
  status: LogUpload["status"];
  totalLines: number;
  parsedLines: number;
  invalidLines: number;
  botVisits: number;
  saved: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export function serializeUpload(u: LogUpload): SerializedUpload {
  return {
    id: u.id,
    filename: u.filename,
    sizeBytes: u.sizeBytes,
    receivedBytes: u.receivedBytes,
    format: u.format,
    detectedFormat: u.detectedFormat,
    status: u.status,
    totalLines: u.totalLines,
    parsedLines: u.parsedLines,
    invalidLines: u.invalidLines,
    botVisits: u.botVisits,
    saved: u.saved,
    error: u.error,
    createdAt: u.createdAt.toISOString(),
    finishedAt: u.finishedAt?.toISOString() ?? null,
  };
}

/** Raw-SQL timestamp bounds as ISO strings (postgres-js can't infer types of Date params in `sql` templates). */
function bounds(from: string, to: string) {
  return { start: `${from}T00:00:00.000Z`, end: `${addDays(to, 1)}T00:00:00.000Z` };
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown) => res as unknown as Row[];
const num = (v: unknown) => Number(v ?? 0) || 0;

/* ───────────────────────────── Overview ───────────────────────────── */

export type BotCard = {
  bot: string;
  company: string;
  purpose: string;
  visits: number;
  pages: number;
  prevVisits: number;
  trend: number | null;
  verified: number;
  unverified: number;
  lastSeen: string | null;
};

export type BotOverview = {
  totals: {
    visits: number;
    prevVisits: number;
    uniqueUrls: number;
    prevUniqueUrls: number;
    ok: number;
    redirects: number;
    clientErrors: number;
    serverErrors: number;
    verified: number;
    unverified: number;
  };
  daily: Record<string, string | number>[];
  series: { key: string; label: string }[];
  bots: BotCard[];
  firstSeen: string | null;
  hasAnyData: boolean;
};

export async function getBotOverview(projectId: string, period: AnalyticsPeriod, botFilter: string[] = []): Promise<BotOverview> {
  const { start, end } = bounds(period.from, period.to);
  const prev = bounds(period.prevFrom, period.prevTo);
  const botCond = botFilter.length ? sql`and bot in (${sql.join(botFilter.map((b) => sql`${b}`), sql`, `)})` : sql``;

  const [totalsRes, prevRes, dailyRes, botsRes, prevBotsRes, anyRes] = await Promise.all([
    db.execute(sql`
      select count(*) visits, count(distinct path) urls,
        count(*) filter (where status between 200 and 299) ok,
        count(*) filter (where status between 300 and 399) redirects,
        count(*) filter (where status between 400 and 499) client_errors,
        count(*) filter (where status >= 500) server_errors,
        count(*) filter (where verified is true) verified,
        count(*) filter (where verified is false) unverified
      from analytics_bot_visits where project_id = ${projectId} and ts >= ${start}::timestamptz and ts < ${end}::timestamptz ${botCond}`),
    db.execute(sql`
      select count(*) visits, count(distinct path) urls
      from analytics_bot_visits where project_id = ${projectId} and ts >= ${prev.start}::timestamptz and ts < ${prev.end}::timestamptz ${botCond}`),
    db.execute(sql`
      select to_char(ts at time zone 'UTC', 'YYYY-MM-DD') d, bot, count(*) c
      from analytics_bot_visits where project_id = ${projectId} and ts >= ${start}::timestamptz and ts < ${end}::timestamptz ${botCond}
      group by 1, 2`),
    db.execute(sql`
      select bot, max(company) company, count(*) visits, count(distinct path) pages, max(ts) last_seen,
        count(*) filter (where verified is true) verified, count(*) filter (where verified is false) unverified
      from analytics_bot_visits where project_id = ${projectId} and ts >= ${start}::timestamptz and ts < ${end}::timestamptz ${botCond}
      group by bot order by visits desc`),
    db.execute(sql`
      select bot, count(*) visits from analytics_bot_visits
      where project_id = ${projectId} and ts >= ${prev.start}::timestamptz and ts < ${prev.end}::timestamptz ${botCond} group by bot`),
    db.execute(sql`select min(ts) first_seen from analytics_bot_visits where project_id = ${projectId}`),
  ]);

  const t = rowsOf(totalsRes)[0] ?? {};
  const p = rowsOf(prevRes)[0] ?? {};
  const botRows = rowsOf(botsRes);
  const prevByBot = new Map(rowsOf(prevBotsRes).map((r) => [String(r.bot), num(r.visits)]));

  // Stacked series: top 6 bots + "Other".
  const topBots = botRows.slice(0, 6).map((r) => String(r.bot));
  const series = topBots.map((b, i) => ({ key: `b${i}`, label: b }));
  const hasOther = botRows.length > topBots.length;
  if (hasOther) series.push({ key: "other", label: "Other bots" });
  const keyOf = new Map(topBots.map((b, i) => [b, `b${i}`]));
  const byDay = new Map<string, Record<string, string | number>>();
  for (const d of dateRange(period.from, period.to)) {
    const base: Record<string, string | number> = { date: d };
    for (const s of series) base[s.key] = 0;
    byDay.set(d, base);
  }
  for (const r of rowsOf(dailyRes)) {
    const day = byDay.get(String(r.d));
    if (!day) continue;
    const key = keyOf.get(String(r.bot)) ?? "other";
    day[key] = num(day[key]) + num(r.c);
  }

  const bots: BotCard[] = botRows.map((r) => {
    const info = getBotInfo(String(r.bot));
    const visits = num(r.visits);
    const prevVisits = prevByBot.get(String(r.bot)) ?? 0;
    return {
      bot: String(r.bot),
      company: String(r.company ?? info?.company ?? ""),
      purpose: info?.purpose ?? "other",
      visits,
      pages: num(r.pages),
      prevVisits,
      trend: pctChange(visits, prevVisits),
      verified: num(r.verified),
      unverified: num(r.unverified),
      lastSeen: r.last_seen ? new Date(String(r.last_seen)).toISOString() : null,
    };
  });

  const any = rowsOf(anyRes)[0] ?? {};
  return {
    totals: {
      visits: num(t.visits),
      prevVisits: num(p.visits),
      uniqueUrls: num(t.urls),
      prevUniqueUrls: num(p.urls),
      ok: num(t.ok),
      redirects: num(t.redirects),
      clientErrors: num(t.client_errors),
      serverErrors: num(t.server_errors),
      verified: num(t.verified),
      unverified: num(t.unverified),
    },
    daily: [...byDay.values()],
    series,
    bots,
    firstSeen: any.first_seen ? new Date(String(any.first_seen)).toISOString() : null,
    hasAnyData: !!any.first_seen,
  };
}

/* ───────────────────────────── Crawled pages ───────────────────────────── */

export type CrawledPage = { path: string; host: string | null; bots: string[]; visits: number; lastVisited: string };

export type PageListOptions = {
  q?: string;
  bots?: string[];
  status?: string[];
  sort?: "visits" | "last" | "path" | "errors";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

function filters(projectId: string, period: AnalyticsPeriod, opts: PageListOptions) {
  const { start, end } = bounds(period.from, period.to);
  const parts = [sql`project_id = ${projectId}`, sql`ts >= ${start}::timestamptz`, sql`ts < ${end}::timestamptz`];
  const q = opts.q?.trim();
  if (q) parts.push(sql`path ilike ${`%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`}`);
  if (opts.bots?.length) parts.push(sql`bot in (${sql.join(opts.bots.map((b) => sql`${b}`), sql`, `)})`);
  const classes = (opts.status ?? []).filter((s) => /^[1-5]xx$/.test(s));
  if (classes.length) {
    parts.push(sql`(${sql.join(classes.map((c) => sql`(status >= ${Number(c[0]) * 100} and status < ${Number(c[0]) * 100 + 100})`), sql` or `)})`);
  }
  return sql.join(parts, sql` and `);
}

export async function getCrawledPages(projectId: string, period: AnalyticsPeriod, opts: PageListOptions = {}) {
  const pageSize = Math.min(100, Math.max(10, opts.pageSize ?? 50));
  const page = Math.max(0, opts.page ?? 0);
  const where = filters(projectId, period, opts);
  const order =
    opts.sort === "last"
      ? sql`last_visited`
      : opts.sort === "path"
        ? sql`path`
        : sql`visits`;
  const dir = opts.dir === "asc" ? sql`asc` : sql`desc`;
  const res = await db.execute(sql`
    select path, max(host) host, array_agg(distinct bot) bots, count(*) visits, max(ts) last_visited, count(*) over () total
    from analytics_bot_visits where ${where}
    group by path order by ${order} ${dir}, path asc
    limit ${pageSize} offset ${page * pageSize}`);
  const rows = rowsOf(res);
  return {
    total: num(rows[0]?.total),
    page,
    pageSize,
    rows: rows.map(
      (r): CrawledPage => ({
        path: String(r.path),
        host: r.host ? String(r.host) : null,
        bots: (r.bots as string[] | null) ?? [],
        visits: num(r.visits),
        lastVisited: new Date(String(r.last_visited)).toISOString(),
      }),
    ),
  };
}

/* ───────────────────────────── Performance ───────────────────────────── */

export type PerformanceRow = {
  path: string;
  host: string | null;
  bots: string[];
  breakdown: { status: string; count: number }[];
  errors: number;
  total: number;
};

export async function getPerformance(projectId: string, period: AnalyticsPeriod, opts: PageListOptions = {}) {
  const pageSize = Math.min(100, Math.max(10, opts.pageSize ?? 50));
  const page = Math.max(0, opts.page ?? 0);
  const where = filters(projectId, period, opts);
  const order = opts.sort === "errors" ? sql`errors` : opts.sort === "path" ? sql`path` : sql`total`;
  const dir = opts.dir === "asc" ? sql`asc` : sql`desc`;
  const [res, summaryRes] = await Promise.all([
    db.execute(sql`
      with f as (select path, host, bot, status from analytics_bot_visits where ${where}),
      per_status as (select path, coalesce(status::text, '—') s, count(*) c from f group by 1, 2),
      per_path as (
        select path, max(host) host, array_agg(distinct bot) bots, count(*) total, count(*) filter (where status >= 400) errors
        from f group by path
      )
      select p.path, p.host, p.bots, p.total, p.errors, count(*) over () total_rows,
        (select jsonb_agg(jsonb_build_array(s, c) order by c desc) from per_status ps where ps.path = p.path) breakdown
      from per_path p order by ${order} ${dir}, p.path asc
      limit ${pageSize} offset ${page * pageSize}`),
    db.execute(sql`
      select coalesce(status::text, '—') s, count(*) c from analytics_bot_visits where ${where} group by 1 order by 2 desc limit 12`),
  ]);
  const rows = rowsOf(res);
  return {
    total: num(rows[0]?.total_rows),
    page,
    pageSize,
    summary: rowsOf(summaryRes).map((r) => ({ status: String(r.s), count: num(r.c) })),
    rows: rows.map(
      (r): PerformanceRow => ({
        path: String(r.path),
        host: r.host ? String(r.host) : null,
        bots: (r.bots as string[] | null) ?? [],
        breakdown: ((r.breakdown as [string, number][] | null) ?? []).map(([status, count]) => ({ status, count: num(count) })),
        errors: num(r.errors),
        total: num(r.total),
      }),
    ),
  };
}

/** Bots seen in the project (for filter dropdowns). */
export async function getSeenBots(projectId: string): Promise<{ bot: string; visits: number }[]> {
  const res = await db.execute(sql`
    select bot, count(*) visits from analytics_bot_visits where project_id = ${projectId}
    and ts >= now() - interval '400 days' group by bot order by visits desc`);
  return rowsOf(res).map((r) => ({ bot: String(r.bot), visits: num(r.visits) }));
}

/* ───────────────────────────── Sync / connectors ───────────────────────────── */

export type ConnectorStatus = {
  provider: string;
  source: BotVisitSource;
  connected: boolean;
  tokenPrefix: string | null;
  tokenCreatedAt: string | null;
  lastReceivedAt: string | null;
  /** Data received in the last 7 days. */
  live: boolean;
  lines7d: number;
  botVisits7d: number;
  saved7d: number;
  requests7d: number;
};

const CONNECTORS: { provider: string; source: BotVisitSource }[] = [
  { provider: PROVIDERS.cloudflare, source: "cloudflare" },
  { provider: PROVIDERS.akamai, source: "akamai" },
  { provider: PROVIDERS.serverLogs, source: "api" },
];

export async function getConnectorStatuses(projectId: string): Promise<ConnectorStatus[]> {
  const since = addDays(isoDate(new Date()), -6);
  const [rows, stats] = await Promise.all([
    db
      .select()
      .from(integrations)
      .where(and(eq(integrations.projectId, projectId), inArray(integrations.provider, CONNECTORS.map((c) => c.provider)))),
    db
      .select({
        source: logIngestStats.source,
        lines: sql<number>`sum(${logIngestStats.lines})`,
        botVisits: sql<number>`sum(${logIngestStats.botVisits})`,
        saved: sql<number>`sum(${logIngestStats.saved})`,
        requests: sql<number>`sum(${logIngestStats.requests})`,
        last: sql<Date | null>`max(${logIngestStats.lastReceivedAt})`,
      })
      .from(logIngestStats)
      .where(and(eq(logIngestStats.projectId, projectId), gte(logIngestStats.date, since)))
      .groupBy(logIngestStats.source),
  ]);
  const lastEver = await db
    .select({ source: logIngestStats.source, last: sql<Date | null>`max(${logIngestStats.lastReceivedAt})` })
    .from(logIngestStats)
    .where(eq(logIngestStats.projectId, projectId))
    .groupBy(logIngestStats.source);
  return CONNECTORS.map((c) => {
    const row = rows.find((r) => r.provider === c.provider);
    const s = stats.find((x) => x.source === c.source);
    const last = lastEver.find((x) => x.source === c.source)?.last;
    return {
      provider: c.provider,
      source: c.source,
      connected: !!row?.tokenHash && row.status !== "disconnected",
      tokenPrefix: row?.tokenHash ? row.tokenPrefix : null,
      tokenCreatedAt: typeof row?.config.tokenCreatedAt === "string" ? row.config.tokenCreatedAt : null,
      lastReceivedAt: last ? new Date(last).toISOString() : null,
      live: !!last && Date.now() - new Date(last).getTime() < 7 * 86_400_000,
      lines7d: num(s?.lines),
      botVisits7d: num(s?.botVisits),
      saved7d: num(s?.saved),
      requests7d: num(s?.requests),
    };
  });
}

/** "Live" when a push connector delivered data in the last 7 days, otherwise "Manual" (uploads). */
export async function getBotMode(projectId: string): Promise<"live" | "manual"> {
  const since = addDays(isoDate(new Date()), -6);
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(logIngestStats)
    .where(
      and(
        eq(logIngestStats.projectId, projectId),
        inArray(logIngestStats.source, ["api", "cloudflare", "akamai"]),
        gte(logIngestStats.date, since),
      ),
    );
  return num(row?.n) > 0 ? "live" : "manual";
}

export async function getRecentUploads(projectId: string, limit = 8) {
  const { logUploads } = await import("@/server/db/schema");
  const rows = await db.select().from(logUploads).where(eq(logUploads.projectId, projectId)).orderBy(desc(logUploads.createdAt)).limit(limit);
  return rows.map(serializeUpload);
}
