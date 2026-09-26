import "server-only";
/**
 * Google Analytics 4 report services (open-seo §10 parity). Every report is a fixed definition —
 * callers pick a report kind/breakdown, never arbitrary dimensions/metrics. Reused by the traffic
 * page, the REST API and MCP tools (see `GA4_REPORTS`).
 */
import { PROVIDERS } from "@/lib/integrations-catalog";
import { getIntegration } from "@/server/integrations/store";
import { IntegrationHttpError } from "@/server/integrations/http";
import {
  getGoogleAccessToken,
  GoogleNotConfiguredError,
  GoogleNotConnectedError,
  GoogleReconnectRequiredError,
  extractGoogleError,
} from "@/server/integrations/google/oauth";
import {
  ga4GetEnhancedMeasurement,
  ga4ListCustomDefinitions,
  ga4ListDataStreams,
  ga4ListKeyEvents,
  ga4RunReport,
  Ga4MalformedResponseError,
  type Ga4Filter,
  type Ga4Quota,
  type Ga4Report,
  type Ga4ReportMetadata,
  type Ga4ReportRequest,
} from "@/server/integrations/google/ga4";
import { addDays, daysBetween } from "../period";
import { todayInTimeZone } from "../traffic/normalize";

/* ───────────────────────────── Errors ───────────────────────────── */

export type Ga4ErrorCode =
  | "validation_error"
  | "ga4_not_connected"
  | "ga4_reconnect_required"
  | "ga4_property_inaccessible"
  | "ga4_report_incompatible"
  | "ga4_quota_exhausted"
  | "ga4_upstream_unavailable"
  | "ga4_malformed_response";

export class Ga4ReportError extends Error {
  constructor(
    public code: Ga4ErrorCode,
    message: string,
    public retryAfterSeconds?: number,
    public actionUrl?: string,
  ) {
    super(message);
  }
  toJSON() {
    return {
      status: "error" as const,
      error: { code: this.code, message: this.message, retryAfterSeconds: this.retryAfterSeconds, actionUrl: this.actionUrl },
    };
  }
}

function settingsUrl(projectId: string) {
  return `/p/${projectId}/analytics/traffic?tab=settings`;
}

function mapError(err: unknown, projectId: string): Ga4ReportError {
  if (err instanceof Ga4ReportError) return err;
  if (err instanceof GoogleNotConnectedError || err instanceof GoogleNotConfiguredError)
    return new Ga4ReportError("ga4_not_connected", err.message, undefined, settingsUrl(projectId));
  if (err instanceof GoogleReconnectRequiredError)
    return new Ga4ReportError("ga4_reconnect_required", err.message, undefined, settingsUrl(projectId));
  if (err instanceof Ga4MalformedResponseError) return new Ga4ReportError("ga4_malformed_response", err.message);
  if (err instanceof IntegrationHttpError) {
    const upstream = extractGoogleError(err.body);
    if (err.status === 401)
      return new Ga4ReportError("ga4_reconnect_required", "Google Analytics denied access — please reconnect.", undefined, settingsUrl(projectId));
    if (err.status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(err.body))
      return new Ga4ReportError("ga4_upstream_unavailable", "The Google Analytics Data API is not enabled for the OAuth client's Google Cloud project.");
    if (err.status === 403 || err.status === 404)
      return new Ga4ReportError("ga4_property_inaccessible", `The GA4 property is not accessible.${upstream ? ` ${upstream}` : ""}`, undefined, settingsUrl(projectId));
    if (err.status === 400) return new Ga4ReportError("ga4_report_incompatible", `Google Analytics rejected the report.${upstream ? ` ${upstream}` : ""}`);
    if (err.status === 429) {
      const m = err.body.match(/retry[^\d]{0,20}(\d+)\s*s/i);
      const retry = m ? Math.min(86_400, Number(m[1])) : 3600;
      return new Ga4ReportError("ga4_quota_exhausted", "Google Analytics quota exhausted — try again later.", retry);
    }
    return new Ga4ReportError("ga4_upstream_unavailable", `Google Analytics is unavailable (${err.status || "network"}).`);
  }
  return new Ga4ReportError("ga4_upstream_unavailable", err instanceof Error ? err.message : String(err));
}

/* ───────────────────────────── Connection & dates ───────────────────────────── */

type Ga4Conn = {
  projectId: string;
  propertyId: string;
  propertyDisplayName: string;
  timeZone: string;
  currencyCode: string;
  token: string;
};

async function getConn(projectId: string): Promise<Ga4Conn> {
  const row = await getIntegration(projectId, PROVIDERS.ga4);
  const cfg = (row?.config ?? {}) as Record<string, unknown>;
  const propertyId = typeof cfg.propertyId === "string" ? cfg.propertyId : "";
  if (!row || !propertyId || row.status === "pending")
    throw new Ga4ReportError("ga4_not_connected", "Google Analytics is not connected for this project.", undefined, settingsUrl(projectId));
  let token: string;
  try {
    token = await getGoogleAccessToken(projectId, "ga4");
  } catch (err) {
    throw mapError(err, projectId);
  }
  return {
    projectId,
    propertyId,
    propertyDisplayName: typeof cfg.propertyName === "string" ? cfg.propertyName : propertyId,
    timeZone: typeof cfg.timeZone === "string" ? cfg.timeZone : "UTC",
    currencyCode: typeof cfg.currency === "string" ? cfg.currency : "USD",
    token,
  };
}

export type DateRange = { startDate: string; endDate: string };
export type ResolvedRange = DateRange & { warnings: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(s: string) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Default: the last 28 complete days in the property's time zone; explicit end dates are clamped. */
export function resolveGa4DateRange(timeZone: string, startDate?: string, endDate?: string, defaultDays = 28): ResolvedRange {
  const lastComplete = addDays(todayInTimeZone(timeZone), -1);
  if (!!startDate !== !!endDate) throw new Ga4ReportError("validation_error", "Provide both startDate and endDate, or neither.");
  if (!startDate || !endDate) return { startDate: addDays(lastComplete, -(defaultDays - 1)), endDate: lastComplete, warnings: [] };
  if (!isRealDate(startDate) || !isRealDate(endDate)) throw new Ga4ReportError("validation_error", "Dates must be valid YYYY-MM-DD dates.");
  if (startDate > endDate) throw new Ga4ReportError("validation_error", "startDate must be on or before endDate.");
  const warnings: string[] = [];
  let end = endDate;
  if (end > lastComplete) {
    end = lastComplete;
    warnings.push("end_date_clamped");
  }
  const start = startDate > end ? end : startDate;
  return { startDate: start, endDate: end, warnings };
}

/** Same inclusive length, ending the day before `range.startDate`. */
export function previousPeriod(range: DateRange): DateRange {
  const len = daysBetween(range.startDate, range.endDate);
  const endDate = addDays(range.startDate, -1);
  return { startDate: addDays(endDate, -len), endDate };
}

/* ───────────────────────────── Envelope ───────────────────────────── */

export type Ga4Channel = "organic_search" | "all";
export type Ga4Row = Record<string, string | number | null>;

export type MetricComparison = { current: number | null; previous: number | null; absoluteChange: number | null; percentChange: number | null };
export type ComparisonRow = { dimensions: Record<string, string>; metrics: Record<string, MetricComparison> };

export type Ga4Diagnostic = { code: string; severity: "warning" | "info"; message: string; details?: Record<string, unknown> };

export type Ga4ReportEnvelope = {
  status: "ok";
  source: { provider: "google_analytics"; propertyId: string; propertyDisplayName: string };
  request: {
    requestedDateRange: Partial<DateRange>;
    resolvedDateRange: DateRange;
    propertyTimeZone: string;
    currencyCode: string;
    channel: Ga4Channel;
    reportKind: string;
    breakdown: string | null;
    dimensions: string[];
    metrics: string[];
    flags: Record<string, boolean>;
    limit: number;
    offset: number;
  };
  rowCount: number;
  totalRowCount: number;
  rows: Ga4Row[];
  pageInfo: { offset: number; limit: number; hasMore: boolean; nextOffset: number | null };
  reportMetadata: Ga4ReportMetadata;
  quota: Ga4Quota | null;
  warnings: string[];
  diagnostics?: Ga4Diagnostic[];
  ecommerceActivity?: { status: "detected" | "none" | "unknown"; evidence: Record<string, number>; reason: string };
  siteSearchActivity?: { status: "detected" | "none" | "unknown"; searchTermCount: number; searchEventCount: number };
  comparison?: {
    previousDateRange: DateRange;
    rows: ComparisonRow[];
    coverage: {
      complete: boolean;
      current: { fetchedRowCount: number; totalRowCount: number };
      previous: { fetchedRowCount: number; totalRowCount: number };
    };
  };
};

export type CommonInput = { projectId: string; startDate?: string; endDate?: string; limit?: number; offset?: number };

const ORGANIC: Ga4Filter = {
  filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: "Organic Search" } },
};

function andFilters(...filters: (Ga4Filter | undefined)[]): Ga4Filter | undefined {
  const list = filters.filter(Boolean) as Ga4Filter[];
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  return { andGroup: { expressions: list } };
}

function clampPaging(limit?: number, offset?: number) {
  const l = Math.round(limit ?? 100);
  const o = Math.round(offset ?? 0);
  if (!Number.isFinite(l) || l < 1 || l > 1000) throw new Ga4ReportError("validation_error", "limit must be between 1 and 1000.");
  if (!Number.isFinite(o) || o < 0) throw new Ga4ReportError("validation_error", "offset must be ≥ 0.");
  return { limit: l, offset: o };
}

type Definition = {
  kind: string;
  breakdown: string | null;
  dimensions: string[];
  metrics: string[];
  orderBys: Ga4ReportRequest["orderBys"];
  dimensionFilter?: Ga4Filter;
  metricFilter?: Ga4Filter;
  channel: Ga4Channel;
  complete: boolean;
  flags?: Record<string, boolean>;
};

type Fetched = { report: Ga4Report; rows: Ga4Row[]; complete: boolean; fetched: number };

async function fetchDefinition(conn: Ga4Conn, def: Definition, range: DateRange, paging: { limit: number; offset: number }): Promise<Fetched> {
  const base: Ga4ReportRequest = {
    dateRanges: [range],
    dimensions: def.dimensions,
    metrics: def.metrics,
    dimensionFilter: def.dimensionFilter,
    metricFilter: def.metricFilter,
    orderBys: def.orderBys,
  };
  try {
    if (def.complete) {
      const buffer = await ga4RunReport(conn.token, conn.propertyId, { ...base, limit: 1000, offset: 0 });
      let rows = buffer.rows.slice(paging.offset, paging.offset + paging.limit);
      if (paging.offset + paging.limit > 1000 && buffer.rowCount > 1000) {
        const page = await ga4RunReport(conn.token, conn.propertyId, { ...base, limit: paging.limit, offset: paging.offset });
        rows = page.rows;
      }
      return { report: buffer, rows, complete: buffer.rowCount <= buffer.rows.length, fetched: buffer.rows.length };
    }
    const report = await ga4RunReport(conn.token, conn.propertyId, { ...base, limit: paging.limit, offset: paging.offset });
    return { report, rows: report.rows, complete: report.rowCount <= report.rows.length + paging.offset && paging.offset === 0, fetched: report.rows.length };
  } catch (err) {
    throw mapError(err, conn.projectId);
  }
}

function envelope(
  conn: Ga4Conn,
  def: Definition,
  requested: Partial<DateRange>,
  range: ResolvedRange,
  paging: { limit: number; offset: number },
  fetched: Fetched,
): Ga4ReportEnvelope {
  const total = fetched.report.rowCount;
  const hasMore = paging.offset + fetched.rows.length < total;
  return {
    status: "ok",
    source: { provider: "google_analytics", propertyId: conn.propertyId, propertyDisplayName: conn.propertyDisplayName },
    request: {
      requestedDateRange: requested,
      resolvedDateRange: { startDate: range.startDate, endDate: range.endDate },
      propertyTimeZone: conn.timeZone,
      currencyCode: fetched.report.metadata.currencyCode ?? conn.currencyCode,
      channel: def.channel,
      reportKind: def.kind,
      breakdown: def.breakdown,
      dimensions: def.dimensions,
      metrics: def.metrics,
      flags: def.flags ?? {},
      limit: paging.limit,
      offset: paging.offset,
    },
    rowCount: fetched.rows.length,
    totalRowCount: total,
    rows: fetched.rows,
    pageInfo: { offset: paging.offset, limit: paging.limit, hasMore, nextOffset: hasMore ? paging.offset + fetched.rows.length : null },
    reportMetadata: fetched.report.metadata,
    quota: fetched.report.quota,
    warnings: [...range.warnings],
  };
}

/** Joins current/previous rows by their dimension tuple (union of both periods). */
export function compareRows(dims: string[], metrics: string[], current: Ga4Row[], previous: Ga4Row[]): ComparisonRow[] {
  const key = (r: Ga4Row) => dims.map((d) => String(r[d] ?? "")).join("\u0000");
  const cur = new Map(current.map((r) => [key(r), r]));
  const prev = new Map(previous.map((r) => [key(r), r]));
  const keys = [...new Set([...cur.keys(), ...prev.keys()])];
  return keys.map((k) => {
    const c = cur.get(k);
    const p = prev.get(k);
    const src = c ?? p!;
    const dimensions = Object.fromEntries(dims.map((d) => [d, String(src[d] ?? "")]));
    const m: Record<string, MetricComparison> = {};
    for (const name of metrics) {
      const cv = c ? (c[name] as number | null) : 0;
      const pv = p ? (p[name] as number | null) : 0;
      const abs = cv != null && pv != null ? cv - pv : null;
      m[name] = { current: cv, previous: pv, absoluteChange: abs, percentChange: pv && cv != null ? ((cv - pv) / pv) * 100 : null };
    }
    return { dimensions, metrics: m };
  });
}

async function withComparison(conn: Ga4Conn, def: Definition, range: ResolvedRange, env: Ga4ReportEnvelope, current: Fetched) {
  const prevRange = previousPeriod(range);
  const previous = await fetchDefinition(conn, { ...def, complete: true }, prevRange, { limit: 1000, offset: 0 });
  const complete = current.complete && previous.complete;
  env.comparison = {
    previousDateRange: prevRange,
    rows: compareRows(def.dimensions, def.metrics, current.report.rows, previous.report.rows),
    coverage: {
      complete,
      current: { fetchedRowCount: current.fetched, totalRowCount: current.report.rowCount },
      previous: { fetchedRowCount: previous.fetched, totalRowCount: previous.report.rowCount },
    },
  };
  if (!complete) env.warnings.push("comparison_incomplete");
  return env;
}

async function run(
  input: CommonInput,
  build: (conn: Ga4Conn) => Definition,
  extras?: (env: Ga4ReportEnvelope, fetched: Fetched, conn: Ga4Conn, def: Definition, range: ResolvedRange) => Promise<void> | void,
): Promise<Ga4ReportEnvelope> {
  const paging = clampPaging(input.limit, input.offset);
  const conn = await getConn(input.projectId);
  const range = resolveGa4DateRange(conn.timeZone, input.startDate, input.endDate);
  const def = build(conn);
  const fetched = await fetchDefinition(conn, def, range, paging);
  const env = envelope(conn, def, { startDate: input.startDate, endDate: input.endDate }, range, paging, fetched);
  if (extras) await extras(env, fetched, conn, def, range);
  return env;
}

/* ───────────────────────────── 1. Organic landing pages ───────────────────────────── */

export function getGa4OrganicLandingPages(input: CommonInput) {
  return run(input, () => ({
    kind: "landing_pages",
    breakdown: null,
    dimensions: ["hostName", "landingPage"],
    metrics: ["sessions", "activeUsers", "engagedSessions", "engagementRate", "keyEvents", "sessionKeyEventRate", "transactions", "purchaseRevenue"],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    dimensionFilter: ORGANIC,
    channel: "organic_search",
    complete: false,
  }));
}

/* ───────────────────────────── 2. Page performance ───────────────────────────── */

export function getGa4PagePerformance(input: CommonInput & { includeDate?: boolean; channel?: Ga4Channel }) {
  const channel = input.channel ?? "organic_search";
  return run(input, () => ({
    kind: "page_performance",
    breakdown: null,
    dimensions: input.includeDate ? ["hostName", "pagePath", "date"] : ["hostName", "pagePath"],
    metrics: ["screenPageViews", "activeUsers", "userEngagementDuration", "keyEvents"],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    dimensionFilter: channel === "organic_search" ? ORGANIC : undefined,
    channel,
    complete: false,
    flags: { includeDate: !!input.includeDate },
  }));
}

/* ───────────────────────────── 3. Key events ───────────────────────────── */

export function getGa4KeyEvents(
  input: CommonInput & { breakdown?: "event" | "event_and_landing_page"; channel?: Ga4Channel; comparePreviousPeriod?: boolean },
) {
  const breakdown = input.breakdown ?? "event";
  const channel = input.channel ?? "organic_search";
  if (input.comparePreviousPeriod && breakdown !== "event")
    throw new Ga4ReportError("validation_error", "comparePreviousPeriod is only supported for the event breakdown.");
  return run(
    input,
    () => ({
      kind: "key_events",
      breakdown,
      dimensions: breakdown === "event" ? ["eventName"] : ["eventName", "hostName", "landingPage"],
      metrics: ["keyEvents", "totalUsers"],
      orderBys: [{ metric: { metricName: "keyEvents" }, desc: true }],
      dimensionFilter: channel === "organic_search" ? ORGANIC : undefined,
      metricFilter: { filter: { fieldName: "keyEvents", numericFilter: { operation: "GREATER_THAN", value: { doubleValue: 0 } } } },
      channel,
      complete: !!input.comparePreviousPeriod,
      flags: { comparePreviousPeriod: !!input.comparePreviousPeriod },
    }),
    async (env, fetched, conn, def, range) => {
      if (input.comparePreviousPeriod) await withComparison(conn, def, range, env, fetched);
    },
  );
}

/* ───────────────────────────── 4. Organic overview ───────────────────────────── */

const OVERVIEW_METRICS = ["sessions", "activeUsers", "engagedSessions", "engagementRate", "keyEvents", "transactions", "purchaseRevenue"];

export async function getGa4OrganicOverview(input: { projectId: string; startDate?: string; endDate?: string; trend?: "daily" | "weekly" }) {
  const conn = await getConn(input.projectId);
  const range = resolveGa4DateRange(conn.timeZone, input.startDate, input.endDate);
  const prev = previousPeriod(range);
  const trendDim = input.trend === "weekly" ? "yearWeek" : "date";
  let current: Ga4Report, previous: Ga4Report, trend: Ga4Report;
  try {
    [current, previous, trend] = await Promise.all([
      ga4RunReport(conn.token, conn.propertyId, { dateRanges: [range], metrics: OVERVIEW_METRICS, dimensionFilter: ORGANIC, limit: 1 }),
      ga4RunReport(conn.token, conn.propertyId, { dateRanges: [prev], metrics: OVERVIEW_METRICS, dimensionFilter: ORGANIC, limit: 1 }),
      ga4RunReport(conn.token, conn.propertyId, {
        dateRanges: [range],
        dimensions: [trendDim],
        metrics: OVERVIEW_METRICS,
        dimensionFilter: ORGANIC,
        orderBys: [{ dimension: { dimensionName: trendDim }, desc: false }],
        limit: 1000,
      }),
    ]);
  } catch (err) {
    throw mapError(err, input.projectId);
  }
  const cur = current.rows[0] ?? {};
  const pre = previous.rows[0] ?? {};
  const comparison = Object.fromEntries(
    OVERVIEW_METRICS.map((m) => {
      const c = (cur[m] as number | null | undefined) ?? 0;
      const p = (pre[m] as number | null | undefined) ?? 0;
      return [m, { current: c, previous: p, absoluteChange: c != null && p != null ? c - p : null, percentChange: p ? ((c! - p) / p) * 100 : null }];
    }),
  ) as Record<string, MetricComparison>;
  const hasLimitedData = current.metadata.hasLimitedData || previous.metadata.hasLimitedData || trend.metadata.hasLimitedData;
  const diagnostics: Ga4Diagnostic[] = [];
  const kc = comparison.keyEvents;
  if (!hasLimitedData && kc && (kc.previous ?? 0) >= 5 && kc.percentChange != null && kc.percentChange <= -50) {
    diagnostics.push({
      code: "key_events_sharp_decline",
      severity: "warning",
      message: `Organic key events dropped ${Math.abs(kc.percentChange).toFixed(0)}% versus the previous period — check tracking and key-event configuration.`,
    });
  }
  const warnings = [...range.warnings];
  if (trend.rowCount > trend.rows.length) warnings.push("trend_truncated");
  return {
    status: "ok" as const,
    source: { provider: "google_analytics" as const, propertyId: conn.propertyId, propertyDisplayName: conn.propertyDisplayName },
    request: { resolvedDateRange: { startDate: range.startDate, endDate: range.endDate }, previousDateRange: prev, trend: input.trend ?? "daily", propertyTimeZone: conn.timeZone },
    current: cur,
    previous: pre,
    comparison,
    trend: trend.rows.map((r) => ({
      ...r,
      [trendDim]: trendDim === "date" && typeof r.date === "string" && /^\d{8}$/.test(r.date) ? `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6)}` : r[trendDim],
    })),
    diagnostics,
    reportMetadata: { hasLimitedData, reports: [current.metadata, previous.metadata, trend.metadata] },
    quota: trend.quota ?? current.quota,
    warnings,
  };
}

/* ───────────────────────────── 5. Traffic acquisition ───────────────────────────── */

const PRIVATE_SOURCE = /^(localhost|127\.|::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

export function sourceMediumDiagnostics(rows: Ga4Row[], complete: boolean, limited: boolean): Ga4Diagnostic[] {
  if (!complete || limited) return [];
  const out: Ga4Diagnostic[] = [];
  const total = rows.reduce((a, r) => a + (Number(r.sessions) || 0), 0);
  const notSet = rows.filter((r) => String(r.sessionSourceMedium ?? "").trim() === "(not set)").reduce((a, r) => a + (Number(r.sessions) || 0), 0);
  if (total > 0 && notSet / total >= 0.05) {
    out.push({
      code: "attribution_not_set_share_high",
      severity: "warning",
      message: `${((notSet / total) * 100).toFixed(1)}% of sessions have source/medium "(not set)".`,
      details: { notSetSessions: notSet, totalSessions: total },
    });
  }
  const internal = rows.filter((r) => PRIVATE_SOURCE.test(String(r.sessionSourceMedium ?? "").split(" / ")[0]!.trim()));
  if (internal.length) {
    out.push({
      code: "internal_referral_traffic_detected",
      severity: "warning",
      message: "Sessions from localhost or private IP sources were recorded — exclude internal traffic in GA4.",
      details: { sources: internal.map((r) => r.sessionSourceMedium).slice(0, 10) },
    });
  }
  const groups = new Map<string, Set<string>>();
  for (const r of rows) {
    const v = String(r.sessionSourceMedium ?? "");
    const k = v.toLowerCase();
    groups.set(k, (groups.get(k) ?? new Set()).add(v));
  }
  const variants = [...groups.values()].filter((s) => s.size > 1).map((s) => [...s]);
  if (variants.length) {
    out.push({
      code: "source_medium_case_variants_detected",
      severity: "info",
      message: "Some source/medium values differ only in upper/lower case — normalize your UTM parameters.",
      details: { variants: variants.slice(0, 10) },
    });
  }
  return out;
}

export function getGa4TrafficAcquisition(
  input: CommonInput & { breakdown?: "channel_group" | "source_medium" | "campaign"; comparePreviousPeriod?: boolean },
) {
  const breakdown = input.breakdown ?? "channel_group";
  if (input.comparePreviousPeriod && breakdown !== "channel_group")
    throw new Ga4ReportError("validation_error", "comparePreviousPeriod is only supported for the channel_group breakdown.");
  const dim = { channel_group: "sessionDefaultChannelGroup", source_medium: "sessionSourceMedium", campaign: "sessionCampaignName" }[breakdown];
  return run(
    input,
    () => ({
      kind: "traffic_acquisition",
      breakdown,
      dimensions: [dim],
      metrics: ["sessions", "activeUsers", "engagedSessions", "engagementRate", "keyEvents", "transactions", "purchaseRevenue"],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      channel: "all",
      complete: breakdown === "source_medium" || !!input.comparePreviousPeriod,
      flags: { comparePreviousPeriod: !!input.comparePreviousPeriod },
    }),
    async (env, fetched, conn, def, range) => {
      if (breakdown === "source_medium") {
        env.diagnostics = sourceMediumDiagnostics(fetched.report.rows, fetched.complete, fetched.report.metadata.hasLimitedData);
      }
      if (input.comparePreviousPeriod) await withComparison(conn, def, range, env, fetched);
    },
  );
}

/* ───────────────────────────── 6. Ecommerce performance ───────────────────────────── */

export function getGa4EcommercePerformance(
  input: CommonInput & { breakdown?: "item" | "landing_page"; onlyWithTransactions?: boolean; channel?: Ga4Channel },
) {
  const breakdown = input.breakdown ?? "item";
  const channel = input.channel ?? "organic_search";
  return run(
    input,
    () =>
      breakdown === "item"
        ? {
            kind: "ecommerce_performance",
            breakdown,
            dimensions: ["itemName", "itemId"],
            metrics: ["itemsViewed", "itemsAddedToCart", "itemsPurchased", "itemRevenue"],
            orderBys: [{ metric: { metricName: "itemRevenue" }, desc: true }],
            dimensionFilter: channel === "organic_search" ? ORGANIC : undefined,
            channel,
            complete: true,
          }
        : {
            kind: "ecommerce_performance",
            breakdown,
            dimensions: ["hostName", "landingPage"],
            metrics: ["sessions", "transactions", "purchaseRevenue"],
            orderBys: [{ metric: { metricName: "purchaseRevenue" }, desc: true }],
            dimensionFilter: channel === "organic_search" ? ORGANIC : undefined,
            metricFilter: input.onlyWithTransactions
              ? { filter: { fieldName: "transactions", numericFilter: { operation: "GREATER_THAN", value: { doubleValue: 0 } } } }
              : undefined,
            channel,
            complete: true,
            flags: { onlyWithTransactions: !!input.onlyWithTransactions },
          },
    (env, fetched) => {
      const rows = fetched.report.rows;
      const sum = (m: string) => rows.reduce((a, r) => a + (Number(r[m]) || 0), 0);
      const evidence: Record<string, number> =
        breakdown === "item"
          ? { itemsViewed: sum("itemsViewed"), itemsAddedToCart: sum("itemsAddedToCart"), itemsPurchased: sum("itemsPurchased"), itemRevenue: sum("itemRevenue") }
          : { transactions: sum("transactions"), purchaseRevenue: sum("purchaseRevenue") };
      const any = Object.values(evidence).some((v) => v > 0);
      const unknown = !fetched.complete || fetched.report.metadata.hasLimitedData;
      const activity: NonNullable<Ga4ReportEnvelope["ecommerceActivity"]> = {
        status: any ? "detected" : unknown ? "unknown" : "none",
        evidence,
        reason: any
          ? "Ecommerce events were recorded in this period."
          : unknown
            ? "Data is incomplete or limited — ecommerce activity could not be determined."
            : "No ecommerce events (view_item, add_to_cart, purchase) were recorded in this period.",
      };
      env.ecommerceActivity = activity;
      if (activity.status === "none") {
        env.diagnostics = [{ code: "no_ecommerce_activity", severity: "info", message: activity.reason }];
      }
    },
  );
}

/* ───────────────────────────── 7. Site search ───────────────────────────── */

export function getGa4SiteSearch(input: CommonInput) {
  return run(
    input,
    () => ({
      kind: "site_search",
      breakdown: null,
      dimensions: ["searchTerm"],
      metrics: ["eventCount", "activeUsers", "sessions", "engagedSessions", "engagementRate"],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "view_search_results" } } },
            { notExpression: { filter: { fieldName: "searchTerm", stringFilter: { matchType: "EXACT", value: "(not set)" } } } },
          ],
        },
      },
      channel: "all",
      complete: true,
    }),
    (env, fetched) => {
      const rows = fetched.report.rows;
      const searchEventCount = rows.reduce((a, r) => a + (Number(r.eventCount) || 0), 0);
      const unknown = !fetched.complete || fetched.report.metadata.hasLimitedData;
      env.siteSearchActivity = {
        status: searchEventCount > 0 ? "detected" : unknown ? "unknown" : "none",
        searchTermCount: fetched.report.rowCount,
        searchEventCount,
      };
      if (env.siteSearchActivity.status === "none") {
        env.diagnostics = [
          {
            code: "no_site_search_activity",
            severity: "info",
            message: "No site search (view_search_results) was recorded — enable site search in GA4 enhanced measurement.",
          },
        ];
      }
    },
  );
}

/* ───────────────────────────── 8. Audience breakdown ───────────────────────────── */

export function getGa4AudienceBreakdown(
  input: CommonInput & { breakdown?: "device" | "country" | "new_vs_returning"; channel?: Ga4Channel; comparePreviousPeriod?: boolean },
) {
  const breakdown = input.breakdown ?? "device";
  const channel = input.channel ?? "organic_search";
  if (input.comparePreviousPeriod && breakdown === "country")
    throw new Ga4ReportError("validation_error", "comparePreviousPeriod is supported for the device and new_vs_returning breakdowns.");
  const dim = { device: "deviceCategory", country: "country", new_vs_returning: "newVsReturning" }[breakdown];
  return run(
    input,
    () => ({
      kind: "audience_breakdown",
      breakdown,
      dimensions: [dim],
      metrics: ["activeUsers", "sessions", "engagementRate", "keyEvents"],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      dimensionFilter: andFilters(channel === "organic_search" ? ORGANIC : undefined),
      channel,
      complete: !!input.comparePreviousPeriod,
      flags: { comparePreviousPeriod: !!input.comparePreviousPeriod },
    }),
    async (env, fetched, conn, def, range) => {
      if (input.comparePreviousPeriod) await withComparison(conn, def, range, env, fetched);
    },
  );
}

/* ───────────────────────────── 9. Measurement health ───────────────────────────── */

export type MeasurementIssue = { code: string; severity: "warning" | "info"; message: string };

export async function getGa4MeasurementHealth(input: { projectId: string }) {
  const conn = await getConn(input.projectId);
  try {
    const [streams, keyEvents, custom] = await Promise.all([
      ga4ListDataStreams(conn.token, conn.propertyId),
      ga4ListKeyEvents(conn.token, conn.propertyId),
      ga4ListCustomDefinitions(conn.token, conn.propertyId),
    ]);
    const web = streams.filter((s) => s.type === "WEB_DATA_STREAM");
    const webStreams = await Promise.all(
      web.map(async (s) => ({
        streamId: s.name.split("/").pop() ?? s.name,
        displayName: s.displayName ?? "",
        measurementId: s.webStreamData?.measurementId ?? null,
        defaultUri: s.webStreamData?.defaultUri ?? null,
        createTime: s.createTime ?? null,
        updateTime: s.updateTime ?? null,
        enhancedMeasurement: await ga4GetEnhancedMeasurement(conn.token, s.name),
      })),
    );
    const issues: MeasurementIssue[] = [];
    if (!webStreams.length) issues.push({ code: "no_web_stream", severity: "warning", message: "The property has no web data stream." });
    else {
      const known = webStreams.filter((s) => s.enhancedMeasurement);
      if (known.length && known.every((s) => s.enhancedMeasurement?.streamEnabled === false))
        issues.push({ code: "enhanced_measurement_disabled", severity: "warning", message: "Enhanced measurement is disabled on every web stream." });
      if (known.length && !known.some((s) => s.enhancedMeasurement?.streamEnabled && s.enhancedMeasurement?.siteSearchEnabled))
        issues.push({ code: "site_search_measurement_disabled", severity: "info", message: "Site search measurement is not enabled on any web stream." });
    }
    if (!keyEvents.length)
      issues.push({ code: "no_key_events_configured", severity: "warning", message: "No key events are configured — conversions from AI traffic cannot be measured." });
    return {
      status: "ok" as const,
      source: { provider: "google_analytics" as const, propertyId: conn.propertyId, propertyDisplayName: conn.propertyDisplayName },
      summary: {
        dataStreamCount: streams.length,
        webStreamCount: webStreams.length,
        keyEventCount: keyEvents.length,
        customDimensionCount: custom.dimensions.length,
        customMetricCount: custom.metrics.length,
        issueCount: issues.length,
      },
      issues,
      webStreams,
      otherStreams: streams.filter((s) => s.type !== "WEB_DATA_STREAM").map((s) => ({ name: s.name, type: s.type, displayName: s.displayName ?? "" })),
      keyEvents: keyEvents.map((k) => ({ eventName: k.eventName, countingMethod: k.countingMethod ?? null, createTime: k.createTime ?? null })),
      customDefinitions: custom,
    };
  } catch (err) {
    throw mapError(err, input.projectId);
  }
}
