import "server-only";
import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { trafficDaily, trafficRows, type TrafficProvider } from "@/server/db/schema";
import { listIntegrations } from "@/server/integrations/store";
import { getAiPlatform } from "../ai-platforms";
import { dateRange, monthKey, pctChange, type AnalyticsPeriod } from "../period";
import { buildTrafficFlow, type FlowMetric, type FlowResult } from "./flow";

export const TRAFFIC_PROVIDERS: TrafficProvider[] = ["google_analytics", "matomo", "piwik_pro"];
export const TRAFFIC_PROVIDER_LABEL: Record<TrafficProvider, string> = {
  google_analytics: "Google Analytics",
  matomo: "Matomo",
  piwik_pro: "Piwik PRO",
};

export type TrafficSource = {
  provider: TrafficProvider;
  label: string;
  propertyLabel: string;
  status: "connected" | "error" | "pending";
  lastSyncAt: string | null;
  lastError: string | null;
  currency: string;
  syncedThrough: string | null;
};

function hostOf(url: unknown): string {
  if (typeof url !== "string" || !url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Traffic providers of the project (connected first, in catalog order). Pending GA4 rows are included with status "pending". */
export async function getTrafficSources(projectId: string): Promise<TrafficSource[]> {
  const rows = await listIntegrations(projectId);
  const out: TrafficSource[] = [];
  for (const provider of TRAFFIC_PROVIDERS) {
    const row = rows.find((r) => r.provider === provider);
    if (!row || row.status === "disconnected") continue;
    const cfg = row.config ?? {};
    const propertyLabel =
      provider === "google_analytics"
        ? String(cfg.propertyName ?? cfg.propertyId ?? "")
        : provider === "matomo"
          ? `${hostOf(cfg.url)} · site ${String(cfg.siteId ?? "")}`
          : hostOf(cfg.accountUrl);
    const pending = row.status === "pending" || (provider === "google_analytics" && !cfg.propertyId);
    out.push({
      provider,
      label: TRAFFIC_PROVIDER_LABEL[provider],
      propertyLabel,
      status: pending ? "pending" : row.status === "error" ? "error" : "connected",
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      lastError: row.lastError,
      currency: provider === "google_analytics" && typeof cfg.currency === "string" ? cfg.currency : "EUR",
      syncedThrough: typeof cfg.syncedThrough === "string" ? cfg.syncedThrough : null,
    });
  }
  return out;
}

function rangeWhere(projectId: string, provider: TrafficProvider, from: string, to: string, models?: string[]): SQL {
  return and(
    eq(trafficRows.projectId, projectId),
    eq(trafficRows.provider, provider),
    gte(trafficRows.date, from),
    lte(trafficRows.date, to),
    models?.length ? inArray(trafficRows.platform, models) : undefined,
  )!;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

export type PlatformTotal = {
  platform: string;
  name: string;
  color: string;
  engineId: string | null;
  sessions: number;
  conversions: number;
  revenue: number;
  share: number;
};

export type TrafficOverview = {
  kpis: {
    sessions: number;
    conversions: number;
    revenue: number;
    prevSessions: number;
    prevConversions: number;
    prevRevenue: number;
    sessionsDelta: number | null;
    conversionsDelta: number | null;
    revenueDelta: number | null;
    allSessions: number;
    aiShare: number | null;
    conversionRate: number | null;
  };
  series: Record<string, string | number>[];
  seriesKeys: { key: string; label: string; color: string }[];
  platforms: PlatformTotal[];
  hasData: boolean;
};

export async function getTrafficOverview(
  projectId: string,
  provider: TrafficProvider,
  period: AnalyticsPeriod,
  granularity: "daily" | "monthly",
): Promise<TrafficOverview> {
  const totals = (from: string, to: string) =>
    db
      .select({
        sessions: sql<number>`coalesce(sum(${trafficRows.sessions}), 0)`,
        conversions: sql<number>`coalesce(sum(${trafficRows.conversions}), 0)`,
        converted: sql<number>`coalesce(sum(${trafficRows.convertedSessions}), 0)`,
        revenue: sql<number>`coalesce(sum(${trafficRows.revenue}), 0)`,
      })
      .from(trafficRows)
      .where(rangeWhere(projectId, provider, from, to));

  const bucket = granularity === "monthly" ? sql<string>`to_char(date_trunc('month', ${trafficRows.date}), 'YYYY-MM-DD')` : sql<string>`${trafficRows.date}::text`;

  const [[cur], [prev], [all], seriesRows, platformRows] = await Promise.all([
    totals(period.from, period.to),
    totals(period.prevFrom, period.prevTo),
    db
      .select({ sessions: sql<number>`coalesce(sum(${trafficDaily.sessions}), 0)` })
      .from(trafficDaily)
      .where(
        and(
          eq(trafficDaily.projectId, projectId),
          eq(trafficDaily.provider, provider),
          gte(trafficDaily.date, period.from),
          lte(trafficDaily.date, period.to),
        ),
      ),
    db
      .select({ bucket, platform: trafficRows.platform, sessions: sql<number>`sum(${trafficRows.sessions})` })
      .from(trafficRows)
      .where(rangeWhere(projectId, provider, period.from, period.to))
      .groupBy(bucket, trafficRows.platform),
    db
      .select({
        platform: trafficRows.platform,
        sessions: sql<number>`sum(${trafficRows.sessions})`,
        conversions: sql<number>`sum(${trafficRows.conversions})`,
        revenue: sql<number>`sum(${trafficRows.revenue})`,
      })
      .from(trafficRows)
      .where(rangeWhere(projectId, provider, period.from, period.to))
      .groupBy(trafficRows.platform)
      .orderBy(sql`sum(${trafficRows.sessions}) desc`),
  ]);

  const totalAi = platformRows.reduce((a, r) => a + num(r.sessions), 0);
  const platforms: PlatformTotal[] = platformRows.map((r) => {
    const info = getAiPlatform(r.platform);
    return {
      platform: r.platform,
      name: info?.name ?? r.platform,
      color: info?.color ?? "#777",
      engineId: info?.engineId ?? null,
      sessions: num(r.sessions),
      conversions: num(r.conversions),
      revenue: num(r.revenue),
      share: totalAi ? (num(r.sessions) / totalAi) * 100 : 0,
    };
  });

  // Top 6 platforms get their own series, the rest is grouped as "Other".
  const top = platforms.slice(0, 6).map((p) => p.platform);
  const seriesKeys = platforms.slice(0, 6).map((p) => ({ key: p.platform, label: p.name, color: p.color }));
  const hasOther = platforms.length > 6;
  if (hasOther) seriesKeys.push({ key: "other", label: "Other AI", color: "#a1a1aa" });
  const buckets =
    granularity === "monthly"
      ? [...new Set(dateRange(period.from, period.to).map(monthKey))]
      : dateRange(period.from, period.to);
  const byBucket = new Map<string, Record<string, string | number>>(
    buckets.map((b) => [b, { date: b, ...Object.fromEntries(seriesKeys.map((s) => [s.key, 0])) }]),
  );
  for (const r of seriesRows) {
    const row = byBucket.get(r.bucket);
    if (!row) continue;
    const key = top.includes(r.platform) ? r.platform : "other";
    row[key] = num(row[key]) + num(r.sessions);
  }

  const sessions = num(cur?.sessions);
  const allSessions = num(all?.sessions);
  return {
    kpis: {
      sessions,
      conversions: num(cur?.conversions),
      revenue: num(cur?.revenue),
      prevSessions: num(prev?.sessions),
      prevConversions: num(prev?.conversions),
      prevRevenue: num(prev?.revenue),
      sessionsDelta: pctChange(sessions, num(prev?.sessions)),
      conversionsDelta: pctChange(num(cur?.conversions), num(prev?.conversions)),
      revenueDelta: pctChange(num(cur?.revenue), num(prev?.revenue)),
      allSessions,
      aiShare: allSessions > 0 ? (sessions / allSessions) * 100 : null,
      conversionRate: sessions > 0 ? (num(cur?.converted) / sessions) * 100 : null,
    },
    series: [...byBucket.values()],
    seriesKeys,
    platforms,
    hasData: sessions > 0 || allSessions > 0,
  };
}

/** "AI Model → Page → Outcome" flow for the period. */
export async function getTrafficFlow(
  projectId: string,
  provider: TrafficProvider,
  period: AnalyticsPeriod,
  opts: { metric: FlowMetric; url?: string | null; models?: string[] },
): Promise<FlowResult> {
  const rows = await db
    .select({
      platform: trafficRows.platform,
      page: trafficRows.page,
      sessions: sql<number>`sum(${trafficRows.sessions})`,
      engagedSessions: sql<number>`sum(${trafficRows.engagedSessions})`,
      convertedSessions: sql<number>`sum(${trafficRows.convertedSessions})`,
      conversions: sql<number>`sum(${trafficRows.conversions})`,
      revenue: sql<number>`sum(${trafficRows.revenue})`,
    })
    .from(trafficRows)
    .where(rangeWhere(projectId, provider, period.from, period.to, opts.models))
    .groupBy(trafficRows.platform, trafficRows.page);
  return buildTrafficFlow(
    rows.map((r) => ({
      platform: r.platform,
      page: r.page,
      sessions: num(r.sessions),
      engagedSessions: num(r.engagedSessions),
      convertedSessions: num(r.convertedSessions),
      conversions: num(r.conversions),
      revenue: num(r.revenue),
    })),
    { metric: opts.metric, url: opts.url },
  );
}

export type TrafficTableRow = {
  key: string;
  label: string;
  platforms: string[];
  sessions: number;
  engagedSessions: number;
  engagementRate: number | null;
  conversions: number;
  conversionRate: number | null;
  revenue: number;
  avgTime: number | null;
  share: number;
};

/** "AI Traffic Analytics" tables: by landing page, by country or by AI platform (engagement). */
export async function getTrafficTable(
  projectId: string,
  provider: TrafficProvider,
  period: AnalyticsPeriod,
  opts: { by: "urls" | "location" | "engagement"; models?: string[]; limit?: number },
): Promise<TrafficTableRow[]> {
  const dim = opts.by === "urls" ? trafficRows.page : opts.by === "location" ? trafficRows.country : trafficRows.platform;
  const rows = await db
    .select({
      key: dim,
      platforms: sql<string[]>`array_agg(distinct ${trafficRows.platform})`,
      sessions: sql<number>`sum(${trafficRows.sessions})`,
      engagedSessions: sql<number>`sum(${trafficRows.engagedSessions})`,
      convertedSessions: sql<number>`sum(${trafficRows.convertedSessions})`,
      conversions: sql<number>`sum(${trafficRows.conversions})`,
      revenue: sql<number>`sum(${trafficRows.revenue})`,
      engagementSeconds: sql<number>`sum(${trafficRows.engagementSeconds})`,
    })
    .from(trafficRows)
    .where(rangeWhere(projectId, provider, period.from, period.to, opts.models))
    .groupBy(dim)
    .orderBy(sql`sum(${trafficRows.sessions}) desc`)
    .limit(opts.limit ?? 500);
  const total = rows.reduce((a, r) => a + num(r.sessions), 0);
  return rows.map((r) => {
    const sessions = num(r.sessions);
    const platforms = (r.platforms ?? []).filter(Boolean);
    const label =
      opts.by === "engagement" ? (getAiPlatform(r.key)?.name ?? r.key) : opts.by === "urls" ? r.key || "(unknown page)" : r.key || "Unknown";
    return {
      key: r.key || "__unknown__",
      label,
      platforms,
      sessions,
      engagedSessions: num(r.engagedSessions),
      engagementRate: sessions ? (num(r.engagedSessions) / sessions) * 100 : null,
      conversions: num(r.conversions),
      conversionRate: sessions ? (num(r.convertedSessions) / sessions) * 100 : null,
      revenue: num(r.revenue),
      avgTime: sessions ? num(r.engagementSeconds) / sessions : null,
      share: total ? (sessions / total) * 100 : 0,
    };
  });
}

/** Distinct AI platforms seen for the provider (for the models filter). */
export async function getTrafficPlatforms(projectId: string, provider: TrafficProvider): Promise<string[]> {
  const rows = await db
    .selectDistinct({ platform: trafficRows.platform })
    .from(trafficRows)
    .where(and(eq(trafficRows.projectId, projectId), eq(trafficRows.provider, provider)));
  return rows.map((r) => r.platform);
}
