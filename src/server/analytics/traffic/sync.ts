import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/server/db/client";
import { trafficDaily, trafficRows, type TrafficProvider } from "@/server/db/schema";
import type { JobContext } from "@/server/jobs/types";
import { getIntegration, markIntegrationSync } from "@/server/integrations/store";
import {
  getGoogleAccessToken,
  googleApiErrorMessage,
  GoogleNotConfiguredError,
  GoogleNotConnectedError,
  GoogleReconnectRequiredError,
} from "@/server/integrations/google/oauth";
import { ga4RunReportAll } from "@/server/integrations/google/ga4";
import { getMatomoCredentials, matomoCall, MatomoError, type MatomoCredentials, type MatomoVisit } from "@/server/integrations/matomo";
import {
  getPiwikCredentials,
  piwikCellId,
  piwikCellLabel,
  piwikQuery,
  PiwikError,
  type PiwikColumn,
  type PiwikCredentials,
} from "@/server/integrations/piwik";
import { IntegrationHttpError } from "@/server/integrations/http";
import { aiReferrerDomains, classifyAiSource, GA4_AI_SOURCE_REGEX, PIWIK_AI_SOURCE_REGEX } from "../ai-platforms";
import {
  dateWindows,
  ga4Date,
  ga4RowToTraffic,
  matomoVisitToRow,
  normalizeCountry,
  normalizeLandingPage,
  todayInTimeZone,
  TrafficAggregator as Aggregator,
  type NormalizedTrafficRow,
} from "./normalize";
import { addDays, daysBetween } from "../period";
import { integrationTarget, lockSyncTarget, SyncTargetChangedError, TRAFFIC_RETENTION_DAYS } from "../scheduling";

export type TrafficSyncPayload = { projectId: string; provider: TrafficProvider; full?: boolean };

type AggRow = NormalizedTrafficRow;

type DailyTotal = { date: string; sessions: number; conversions: number; revenue: number };

class SyncCancelledError extends Error {}

async function replaceRange(
  projectId: string,
  provider: TrafficProvider,
  target: string,
  from: string,
  to: string,
  rows: AggRow[],
  totals: DailyTotal[],
) {
  await db.transaction(async (tx) => {
    // Serializes concurrent syncs and aborts when the property/site changed or was disconnected meanwhile.
    await lockSyncTarget(tx, projectId, provider, target);
    await tx
      .delete(trafficRows)
      .where(and(eq(trafficRows.projectId, projectId), eq(trafficRows.provider, provider), gte(trafficRows.date, from), lte(trafficRows.date, to)));
    await tx
      .delete(trafficDaily)
      .where(and(eq(trafficDaily.projectId, projectId), eq(trafficDaily.provider, provider), gte(trafficDaily.date, from), lte(trafficDaily.date, to)));
    for (let i = 0; i < rows.length; i += 1000) {
      await tx.insert(trafficRows).values(
        rows.slice(i, i + 1000).map((r) => ({
          projectId,
          provider,
          date: r.date,
          platform: r.platform,
          page: r.page,
          country: r.country,
          sessions: Math.round(r.sessions),
          engagedSessions: Math.round(r.engagedSessions),
          convertedSessions: r.convertedSessions,
          conversions: r.conversions,
          revenue: r.revenue,
          engagementSeconds: r.engagementSeconds,
          users: Math.round(r.users),
        })),
      );
    }
    const dedup = new Map<string, DailyTotal>();
    for (const t of totals) if (t.date >= from && t.date <= to) dedup.set(t.date, t);
    const list = [...dedup.values()];
    for (let i = 0; i < list.length; i += 1000) {
      await tx.insert(trafficDaily).values(
        list.slice(i, i + 1000).map((t) => ({
          projectId,
          provider,
          date: t.date,
          sessions: Math.round(t.sessions),
          conversions: t.conversions,
          revenue: t.revenue,
        })),
      );
    }
  });
}

type SyncRange = { from: string; to: string };

function resolveRange(opts: { full?: boolean; syncedThrough: unknown; today: string }): SyncRange | null {
  const yesterday = addDays(opts.today, -1);
  const floor = addDays(opts.today, -TRAFFIC_RETENTION_DAYS);
  const through = typeof opts.syncedThrough === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.syncedThrough) ? opts.syncedThrough : null;
  let from = opts.full || !through ? floor : addDays(through, -3);
  if (from < floor) from = floor;
  if (from > yesterday) from = yesterday;
  return { from, to: yesterday };
}

/* ───────────────────────────── GA4 ───────────────────────────── */

async function syncGa4(projectId: string, target: string, config: Record<string, unknown>, range: SyncRange, ctx?: JobContext) {
  const propertyId = typeof config.propertyId === "string" ? config.propertyId : "";
  if (!propertyId) throw new Error("Select a Google Analytics property first.");
  const windows = dateWindows(range.from, range.to, 90);
  let rowsSaved = 0;
  let aiSessions = 0;
  for (const [i, w] of windows.entries()) {
    if (ctx && (await ctx.isCancelled())) throw new SyncCancelledError();
    await ctx?.progress({ provider: "google_analytics", step: "fetch", window: i + 1, windows: windows.length, from: w.from, to: w.to });
    const token = await getGoogleAccessToken(projectId, "ga4");
    const ai = await ga4RunReportAll(
      token,
      propertyId,
      {
        dateRanges: [{ startDate: w.from, endDate: w.to }],
        dimensions: ["date", "sessionSource", "landingPage", "countryId"],
        metrics: ["sessions", "engagedSessions", "keyEvents", "sessionKeyEventRate", "totalRevenue", "userEngagementDuration", "totalUsers"],
        dimensionFilter: {
          filter: { fieldName: "sessionSource", stringFilter: { matchType: "PARTIAL_REGEXP", value: GA4_AI_SOURCE_REGEX, caseSensitive: false } },
        },
        limit: 100_000,
      },
      250_000,
    );
    const agg = new Aggregator();
    for (const r of ai.rows) {
      const row = ga4RowToTraffic(r);
      if (row) agg.add(row);
    }
    const totalsReport = await ga4RunReportAll(token, propertyId, {
      dateRanges: [{ startDate: w.from, endDate: w.to }],
      dimensions: ["date"],
      metrics: ["sessions", "keyEvents", "totalRevenue"],
      limit: 1000,
    });
    const totals: DailyTotal[] = totalsReport.rows.map((r) => ({
      date: ga4Date(r.date),
      sessions: Number(r.sessions ?? 0) || 0,
      conversions: Number(r.keyEvents ?? 0) || 0,
      revenue: Number(r.totalRevenue ?? 0) || 0,
    }));
    const rows = agg.rows();
    await replaceRange(projectId, "google_analytics", target, w.from, w.to, rows, totals);
    rowsSaved += rows.length;
    aiSessions += rows.reduce((a, r) => a + r.sessions, 0);
  }
  return { rows: rowsSaved, aiSessions };
}

/* ───────────────────────────── Matomo ───────────────────────────── */

function matomoSegment(): string {
  // OR-combined (",") referrer URL contains (=@) conditions; values are URL-encoded per Matomo's segment spec.
  return aiReferrerDomains()
    .map((d) => `referrerUrl=@${encodeURIComponent(d)}`)
    .join(",");
}

async function syncMatomo(projectId: string, target: string, creds: MatomoCredentials, range: SyncRange, ctx?: JobContext) {
  const windows = dateWindows(range.from, range.to, 31);
  const segment = matomoSegment();
  let rowsSaved = 0;
  let aiSessions = 0;
  for (const [i, w] of windows.entries()) {
    if (ctx && (await ctx.isCancelled())) throw new SyncCancelledError();
    await ctx?.progress({ provider: "matomo", step: "fetch", window: i + 1, windows: windows.length, from: w.from, to: w.to });
    const agg = new Aggregator();
    const pageSize = 1000;
    for (let offset = 0; offset < 50_000; offset += pageSize) {
      const visits = await matomoCall<MatomoVisit[]>(
        creds,
        "Live.getLastVisitsDetails",
        { idSite: creds.siteId, period: "range", date: `${w.from},${w.to}`, segment, filter_limit: pageSize, filter_offset: offset },
        120_000,
      );
      if (!Array.isArray(visits) || !visits.length) break;
      for (const v of visits) {
        const row = matomoVisitToRow(v);
        if (row && row.date >= w.from && row.date <= w.to) agg.add(row);
      }
      if (visits.length < pageSize) break;
    }
    const [summary, goals] = await Promise.all([
      matomoCall<Record<string, { nb_visits?: number } | unknown[]>>(creds, "VisitsSummary.get", {
        idSite: creds.siteId,
        period: "day",
        date: `${w.from},${w.to}`,
      }),
      matomoCall<Record<string, { nb_conversions?: number; revenue?: number } | unknown[]>>(creds, "Goals.get", {
        idSite: creds.siteId,
        period: "day",
        date: `${w.from},${w.to}`,
      }).catch(() => ({}) as Record<string, unknown[]>),
    ]);
    const totals: DailyTotal[] = Object.entries(summary ?? {}).map(([date, v]) => {
      const g = (goals as Record<string, unknown>)[date];
      const gv = g && !Array.isArray(g) ? (g as { nb_conversions?: number; revenue?: number }) : {};
      return {
        date,
        sessions: !Array.isArray(v) ? Number((v as { nb_visits?: number }).nb_visits ?? 0) || 0 : 0,
        conversions: Number(gv.nb_conversions ?? 0) || 0,
        revenue: Number(gv.revenue ?? 0) || 0,
      };
    });
    const rows = agg.rows();
    await replaceRange(projectId, "matomo", target, w.from, w.to, rows, totals);
    rowsSaved += rows.length;
    aiSessions += rows.reduce((a, r) => a + r.sessions, 0);
  }
  return { rows: rowsSaved, aiSessions };
}

/* ───────────────────────────── Piwik PRO ───────────────────────────── */

async function piwikAll(creds: PiwikCredentials, columns: PiwikColumn[], from: string, to: string, filters?: Parameters<typeof piwikQuery>[1]["filters"]) {
  const out: Awaited<ReturnType<typeof piwikQuery>>["rows"] = [];
  const limit = 10_000;
  for (let offset = 0; offset < 200_000; offset += limit) {
    const res = await piwikQuery(creds, { columns, date_from: from, date_to: to, filters, limit, offset });
    out.push(...res.rows);
    if (res.rows.length < limit || out.length >= res.count) break;
  }
  return out;
}

async function syncPiwik(projectId: string, target: string, creds: PiwikCredentials, range: SyncRange, ctx?: JobContext) {
  const windows = dateWindows(range.from, range.to, 90);
  const filters = {
    operator: "and" as const,
    conditions: [{ column_id: "source", condition: { operator: "matches", value: PIWIK_AI_SOURCE_REGEX } }],
  };
  const baseColumns: PiwikColumn[] = [
    { column_id: "timestamp", transformation_id: "to_date" },
    { column_id: "source" },
    { column_id: "session_entry_url", transformation_id: "to_path" },
    { column_id: "location_country_name" },
    { column_id: "sessions" },
    { column_id: "bounces" },
    { column_id: "session_total_time", transformation_id: "sum" },
    { column_id: "goal_conversions" },
    { column_id: "ecommerce_conversions" },
  ];
  let withRevenue = true;
  let rowsSaved = 0;
  let aiSessions = 0;
  for (const [i, w] of windows.entries()) {
    if (ctx && (await ctx.isCancelled())) throw new SyncCancelledError();
    await ctx?.progress({ provider: "piwik_pro", step: "fetch", window: i + 1, windows: windows.length, from: w.from, to: w.to });
    let rows;
    try {
      rows = await piwikAll(creds, withRevenue ? [...baseColumns, { column_id: "revenue", transformation_id: "sum" }] : baseColumns, w.from, w.to, filters);
    } catch (err) {
      if (!withRevenue || !(err instanceof PiwikError)) throw err;
      // Some accounts reject event-scoped revenue next to session-scoped dimensions — retry without it.
      withRevenue = false;
      rows = await piwikAll(creds, baseColumns, w.from, w.to, filters);
    }
    const agg = new Aggregator();
    for (const r of rows) {
      const source = piwikCellLabel(r[1]);
      const platform = classifyAiSource(source);
      if (!platform) continue;
      const sessions = Number(r[4] ?? 0) || 0;
      const bounces = Number(r[5] ?? 0) || 0;
      const goals = Number(r[7] ?? 0) || 0;
      const orders = Number(r[8] ?? 0) || 0;
      agg.add({
        date: piwikCellLabel(r[0]).slice(0, 10),
        platform,
        page: normalizeLandingPage(piwikCellLabel(r[2])),
        country: normalizeCountry(piwikCellId(r[3])),
        sessions,
        engagedSessions: Math.max(0, sessions - bounces),
        convertedSessions: Math.min(sessions, goals + orders),
        conversions: goals + orders,
        revenue: withRevenue ? Number(r[9] ?? 0) || 0 : 0,
        engagementSeconds: Number(r[6] ?? 0) || 0,
        users: sessions,
      });
    }
    const totalColumns: PiwikColumn[] = [
      { column_id: "timestamp", transformation_id: "to_date" },
      { column_id: "sessions" },
      { column_id: "goal_conversions" },
      { column_id: "ecommerce_conversions" },
    ];
    let totalRows;
    let totalsRevenue = withRevenue;
    try {
      totalRows = await piwikAll(creds, totalsRevenue ? [...totalColumns, { column_id: "revenue", transformation_id: "sum" }] : totalColumns, w.from, w.to);
    } catch (err) {
      if (!totalsRevenue || !(err instanceof PiwikError)) throw err;
      totalsRevenue = false;
      totalRows = await piwikAll(creds, totalColumns, w.from, w.to);
    }
    const totals: DailyTotal[] = totalRows.map((r) => ({
      date: piwikCellLabel(r[0]).slice(0, 10),
      sessions: Number(r[1] ?? 0) || 0,
      conversions: (Number(r[2] ?? 0) || 0) + (Number(r[3] ?? 0) || 0),
      revenue: totalsRevenue ? Number(r[4] ?? 0) || 0 : 0,
    }));
    const aggRows = agg.rows().filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
    await replaceRange(projectId, "piwik_pro", target, w.from, w.to, aggRows, totals.filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date)));
    rowsSaved += aggRows.length;
    aiSessions += aggRows.reduce((a, r) => a + r.sessions, 0);
  }
  return { rows: rowsSaved, aiSessions };
}

/* ───────────────────────────── Entry point ───────────────────────────── */

function friendlyError(err: unknown, provider: TrafficProvider): { message: string; retry: boolean } {
  if (err instanceof GoogleReconnectRequiredError || err instanceof GoogleNotConfiguredError || err instanceof GoogleNotConnectedError)
    return { message: err.message, retry: false };
  if (provider === "google_analytics") {
    const message = googleApiErrorMessage(err, "ga4");
    const status = err instanceof IntegrationHttpError ? err.status : 0;
    return { message, retry: status === 0 || status === 429 || status >= 500 };
  }
  if (err instanceof MatomoError || err instanceof PiwikError) return { message: err.message, retry: false };
  if (err instanceof IntegrationHttpError) {
    return {
      message: err.status === 401 || err.status === 403 ? "The credentials were rejected — check them in Settings." : err.message,
      retry: err.status === 0 || err.status === 429 || err.status >= 500,
    };
  }
  return { message: err instanceof Error ? err.message : String(err), retry: true };
}

/** Imports AI-referred sessions (and all-traffic totals) for a project from GA4, Matomo or Piwik PRO. */
export async function syncTraffic(payload: TrafficSyncPayload, ctx?: JobContext): Promise<unknown> {
  const { projectId, provider } = payload;
  const row = await getIntegration(projectId, provider);
  if (!row) return { skipped: "not_connected" };
  if (row.status === "pending") return { skipped: "pending" };
  const target = integrationTarget(provider, row.config);
  const started = Date.now();
  try {
    const cfg = row.config ?? {};
    const today = provider === "google_analytics" ? todayInTimeZone(typeof cfg.timeZone === "string" ? cfg.timeZone : null) : new Date().toISOString().slice(0, 10);
    const range = resolveRange({ full: payload.full, syncedThrough: cfg.syncedThrough, today });
    if (!range) return { skipped: "up_to_date" };
    let result: { rows: number; aiSessions: number };
    if (provider === "google_analytics") {
      result = await syncGa4(projectId, target, cfg, range, ctx);
    } else if (provider === "matomo") {
      const creds = await getMatomoCredentials(projectId);
      if (!creds) throw new MatomoError("Matomo credentials are incomplete — edit them in Settings.");
      result = await syncMatomo(projectId, target, creds, range, ctx);
    } else {
      const creds = await getPiwikCredentials(projectId);
      if (!creds) throw new PiwikError("Piwik PRO credentials are incomplete — edit them in Settings.");
      result = await syncPiwik(projectId, target, creds, range, ctx);
    }
    await markIntegrationSync(
      projectId,
      provider,
      { ok: true, config: { syncedThrough: range.to, lastSyncDays: daysBetween(range.from, range.to) + 1 } },
      target,
    );
    return { ...result, from: range.from, to: range.to, ms: Date.now() - started };
  } catch (err) {
    // Cancelled or re-targeted mid-way: leave `syncedThrough` untouched so the gap is fetched next time.
    if (err instanceof SyncCancelledError) return { cancelled: true };
    if (err instanceof SyncTargetChangedError) return { skipped: "target_changed" };
    const { message, retry } = friendlyError(err, provider);
    await markIntegrationSync(projectId, provider, { ok: false, error: message }, target);
    if (!retry) return { error: message };
    throw new Error(message);
  }
}
