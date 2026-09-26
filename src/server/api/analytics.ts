import "server-only";
import { z } from "zod";
import { addDays, isValidDate, resolveAnalyticsPeriod, type AnalyticsPeriod } from "@/server/analytics/period";
import {
  getScConnections,
  getScLocations,
  getScOverview,
  getScPages,
  getScQueries,
  getStrikingDistance,
  hasScData,
  type ScSource,
} from "@/server/analytics/search-console/queries";
import { QUERY_INTENTS } from "@/server/analytics/search-console/classify";
import {
  Ga4ReportError,
  getGa4AudienceBreakdown,
  getGa4EcommercePerformance,
  getGa4KeyEvents,
  getGa4MeasurementHealth,
  getGa4OrganicLandingPages,
  getGa4OrganicOverview,
  getGa4PagePerformance,
  getGa4SiteSearch,
  getGa4TrafficAcquisition,
  getSearchOpportunities,
} from "@/server/analytics/ga4";
import { ApiError, type ApiErrorCode } from "./errors";

/**
 * Search Console + GA4 adapters shared by REST v1 and the MCP tools. Search Console data comes from
 * the synced `analytics_sc_*` tables (Google via OAuth sync, Bing via API key); GA4 reports and the
 * GSC × GA4 opportunity join call the Google APIs live.
 */

/* ───────────────────────────── Errors ───────────────────────────── */

const GA4_CODES: Record<Ga4ReportError["code"], ApiErrorCode> = {
  validation_error: "validation_error",
  ga4_not_connected: "not_connected",
  ga4_reconnect_required: "not_connected",
  ga4_property_inaccessible: "not_connected",
  ga4_report_incompatible: "validation_error",
  ga4_quota_exhausted: "rate_limited",
  ga4_upstream_unavailable: "upstream_error",
  ga4_malformed_response: "upstream_error",
};

/** Maps GA4 report errors (not covered by the central error map) to API errors. */
export function ga4ApiError(err: Ga4ReportError, projectId: string): ApiError {
  const hint =
    err.code === "ga4_not_connected" || err.code === "ga4_reconnect_required" || err.code === "ga4_property_inaccessible"
      ? ` Connect Google Analytics in the project's Integrations page (/p/${projectId}/integrations).`
      : "";
  return new ApiError(GA4_CODES[err.code] ?? "upstream_error", `${err.message}${hint}`, {
    ga4Code: err.code,
    retryAfterSeconds: err.retryAfterSeconds ?? null,
    actionUrl: err.actionUrl ?? null,
  });
}

/** Runs a GA4 report and converts Ga4ReportError into ApiError. */
export async function runGa4<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Ga4ReportError) throw ga4ApiError(err, projectId);
    throw err;
  }
}

/* ───────────────────────────── GA4 reports (open-seo tools) ───────────────────────────── */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const ga4Common = {
  startDate: DATE.optional().describe("Start date (YYYY-MM-DD, property time zone). Pass both dates or neither (default: last 28 complete days)."),
  endDate: DATE.optional().describe("End date (YYYY-MM-DD); clamped to the last complete day."),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
};
const channel = z.enum(["organic_search", "all"]).default("organic_search").describe("organic_search (default) or all channels.");
/** REST routes convert "true"/"false" query strings to booleans before validation. */
const boolParam = z.boolean();

export type Ga4ReportKey =
  | "organic-landing-pages"
  | "page-performance"
  | "key-events"
  | "organic-overview"
  | "traffic-acquisition"
  | "ecommerce-performance"
  | "site-search"
  | "audience-breakdown"
  | "measurement-health";

/**
 * GA4 report registry: REST slug → MCP tool name, description, input schema and service call.
 * Inputs accept both JSON (MCP) and query-string (REST) values.
 */
export const GA4_REPORT_DEFS = {
  "organic-landing-pages": {
    tool: "get_google_analytics_organic_landing_pages",
    title: "GA4 organic landing pages",
    description:
      "Organic-search landing pages from Google Analytics 4 with sessions, active users, engaged sessions, engagement rate, key events, key-event rate, transactions and revenue. Default: last 28 complete days.",
    input: z.object({ ...ga4Common }),
    run: (projectId: string, i: Record<string, unknown>) => getGa4OrganicLandingPages({ projectId, ...(i as object) }),
  },
  "page-performance": {
    tool: "get_google_analytics_page_performance",
    title: "GA4 page performance",
    description:
      "Page views, active users, engagement duration and key events per page path from GA4; optional per-day breakdown (includeDate) and channel (organic_search or all).",
    input: z.object({ ...ga4Common, includeDate: boolParam.default(false), channel }),
    run: (projectId: string, i: Record<string, unknown>) => getGa4PagePerformance({ projectId, ...(i as object) }),
  },
  "key-events": {
    tool: "get_google_analytics_key_events",
    title: "GA4 key events",
    description:
      "Key events (conversions) from GA4 by event name, or by event and landing page; organic or all channels; optional previous-period comparison (event breakdown only).",
    input: z.object({
      ...ga4Common,
      breakdown: z.enum(["event", "event_and_landing_page"]).default("event"),
      channel,
      comparePreviousPeriod: boolParam.default(false),
    }),
    run: (projectId: string, i: Record<string, unknown>) => getGa4KeyEvents({ projectId, ...(i as object) }),
  },
  "organic-overview": {
    tool: "get_google_analytics_organic_overview",
    title: "GA4 organic overview",
    description:
      "Organic search totals from GA4 (sessions, users, engagement, key events, transactions, revenue) for the period vs the equal-length previous period, with a daily or weekly trend and anomaly diagnostics.",
    input: z.object({ startDate: ga4Common.startDate, endDate: ga4Common.endDate, trend: z.enum(["daily", "weekly"]).default("daily") }),
    run: (projectId: string, i: Record<string, unknown>) => getGa4OrganicOverview({ projectId, ...(i as object) }),
  },
  "traffic-acquisition": {
    tool: "get_google_analytics_traffic_acquisition",
    title: "GA4 traffic acquisition",
    description:
      "Sessions, users, engagement, key events and revenue by default channel group, source/medium (with attribution diagnostics) or campaign from GA4; optional previous-period comparison (channel_group only).",
    input: z.object({
      ...ga4Common,
      breakdown: z.enum(["channel_group", "source_medium", "campaign"]).default("channel_group"),
      comparePreviousPeriod: boolParam.default(false),
    }),
    run: (projectId: string, i: Record<string, unknown>) => getGa4TrafficAcquisition({ projectId, ...(i as object) }),
  },
  "ecommerce-performance": {
    tool: "get_google_analytics_ecommerce_performance",
    title: "GA4 ecommerce performance",
    description:
      "Ecommerce performance from GA4 by item or landing page (item views, add-to-carts, purchases, item revenue) with ecommerce-activity detection; organic or all channels.",
    input: z.object({
      ...ga4Common,
      breakdown: z.enum(["item", "landing_page"]).default("item"),
      onlyWithTransactions: boolParam.default(false),
      channel,
    }),
    run: (projectId: string, i: Record<string, unknown>) => getGa4EcommercePerformance({ projectId, ...(i as object) }),
  },
  "site-search": {
    tool: "get_google_analytics_site_search",
    title: "GA4 site search",
    description: "On-site search terms from GA4 (view_search_results events) with event count, users, sessions and engagement — all channels.",
    input: z.object({ ...ga4Common }),
    run: (projectId: string, i: Record<string, unknown>) => getGa4SiteSearch({ projectId, ...(i as object) }),
  },
  "audience-breakdown": {
    tool: "get_google_analytics_audience_breakdown",
    title: "GA4 audience breakdown",
    description:
      "Active users, sessions, engagement rate and key events from GA4 by device, country or new vs returning; organic or all channels; optional comparison (device / new_vs_returning). No demographics.",
    input: z.object({
      ...ga4Common,
      breakdown: z.enum(["device", "country", "new_vs_returning"]).default("device"),
      channel,
      comparePreviousPeriod: boolParam.default(false),
    }),
    run: (projectId: string, i: Record<string, unknown>) => getGa4AudienceBreakdown({ projectId, ...(i as object) }),
  },
  "measurement-health": {
    tool: "get_google_analytics_measurement_health",
    title: "GA4 measurement health",
    description:
      "GA4 setup check: data streams, measurement IDs, enhanced measurement (incl. site search), configured key events and custom definitions, with a list of measurement issues.",
    input: z.object({}),
    run: (projectId: string) => getGa4MeasurementHealth({ projectId }),
  },
} satisfies Record<Ga4ReportKey, { tool: string; title: string; description: string; input: z.ZodObject; run: (projectId: string, i: Record<string, unknown>) => Promise<unknown> }>;

export const GA4_REPORT_KEYS = Object.keys(GA4_REPORT_DEFS) as Ga4ReportKey[];

/* ───────────────────────────── Search opportunities (GSC × GA4) ───────────────────────────── */

export const searchOpportunitiesInput = z.object({
  startDate: ga4Common.startDate,
  endDate: ga4Common.endDate,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function searchOpportunities(projectId: string, i: z.infer<typeof searchOpportunitiesInput>) {
  const r = await getSearchOpportunities(projectId, { startDate: i.startDate, endDate: i.endDate, limit: i.limit });
  if (r.status === "ok") return r;
  const code: ApiErrorCode =
    r.status === "validation_error" ? "validation_error" : r.status === "error" ? "upstream_error" : "not_connected";
  const hint = r.status === "gsc_not_connected" || r.status === "ga4_not_connected" ? ` Connect it in the project's Integrations page (/p/${projectId}/integrations).` : "";
  throw new ApiError(code, `${r.message}${hint}`, { status: r.status });
}

/* ───────────────────────────── Search Console performance ───────────────────────────── */

export const scPeriodShape = {
  timeframeDays: z.coerce.number().int().min(1).max(486).optional().describe("Look-back window in days (default 28; Search Console lags ~2–3 days)."),
  startDate: DATE.optional().describe("Custom start (YYYY-MM-DD); overrides timeframeDays."),
  endDate: DATE.optional().describe("Custom end (YYYY-MM-DD)."),
  source: z.enum(["google", "bing"]).default("google").describe("google = Google Search Console, bing = Bing Webmaster Tools."),
};

export const scPerformanceInput = z.object({
  ...scPeriodShape,
  dimension: z.enum(["query", "page", "country", "date"]).default("query").describe("Row dimension."),
  search: z.string().trim().max(200).optional().describe("Substring filter on the query (query dimension) or page URL (page dimension)."),
  page: z.string().trim().max(2048).optional().describe("Only queries that led to this exact page URL (query dimension)."),
  view: z.enum(["all", "prompts"]).default("all").describe("prompts = only long, conversational AI-style queries."),
  intents: z.array(z.enum(QUERY_INTENTS as [string, ...string[]])).max(4).optional().describe("Query intent filter: recommend, information, comparison, action."),
  countries: z.array(z.string().length(2)).max(20).optional().describe("ISO country codes (query dimension)."),
  minImpressions: z.coerce.number().int().min(0).optional(),
  minPosition: z.coerce.number().min(0).max(200).optional(),
  maxPosition: z.coerce.number().min(0).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export function resolveScPeriod(i: { timeframeDays?: number; startDate?: string; endDate?: string; source: ScSource }): AnalyticsPeriod {
  const lagDays = i.source === "google" ? 2 : 1;
  if (i.startDate) {
    if (!isValidDate(i.startDate) || (i.endDate && !isValidDate(i.endDate))) throw new ApiError("validation_error", "Dates must be real YYYY-MM-DD dates.");
    return resolveAnalyticsPeriod({ period: "custom", from: i.startDate, to: i.endDate }, { lagDays });
  }
  const days = i.timeframeDays ?? 28;
  const to = addDays(new Date().toISOString().slice(0, 10), -lagDays);
  return resolveAnalyticsPeriod({ period: "custom", from: addDays(to, -(days - 1)), to }, { lagDays });
}

/** Throws not_connected when the source has neither a connection nor synced data. */
async function assertScAvailable(projectId: string, source: ScSource) {
  const [conns, hasData] = await Promise.all([getScConnections(projectId), hasScData(projectId, source)]);
  const conn = conns[source];
  if (!conn.connected && !hasData) {
    throw new ApiError(
      "not_connected",
      `${source === "google" ? "Google Search Console" : "Bing Webmaster Tools"} is not connected for this project. Connect it in the project's Integrations page (/p/${projectId}/integrations) — data syncs daily.`,
      { source, status: conn.status },
    );
  }
  return conn;
}

const round = (v: number | null, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

export async function searchConsolePerformance(projectId: string, i: z.infer<typeof scPerformanceInput>) {
  const conn = await assertScAvailable(projectId, i.source);
  const period = resolveScPeriod(i);
  const overview = await getScOverview(projectId, i.source, period);
  const base = {
    source: i.source,
    site: conn.site,
    lastSyncAt: conn.lastSyncAt,
    syncedThrough: conn.syncedThrough,
    period: { from: period.from, to: period.to, days: period.days, previous: { from: period.prevFrom, to: period.prevTo } },
    totals: {
      clicks: overview.totals.clicks,
      impressions: overview.totals.impressions,
      ctr: round(overview.totals.ctr),
      position: round(overview.totals.position, 1),
    },
    changes: {
      clicksPct: round(overview.deltas.clicks, 1),
      impressionsPct: round(overview.deltas.impressions, 1),
      ctrPoints: round(overview.deltas.ctr),
      positionImprovement: round(overview.deltas.position, 1),
    },
  };
  const posOk = (p: number | null) =>
    (i.minPosition === undefined || (p != null && p >= i.minPosition)) && (i.maxPosition === undefined || (p != null && p <= i.maxPosition));
  let rows: Record<string, unknown>[];
  let truncated = false;
  if (i.dimension === "date") {
    rows = overview.series.map((d) => ({ date: d.date, clicks: d.clicks, impressions: d.impressions }));
  } else if (i.dimension === "page") {
    const r = await getScPages(projectId, i.source, period, { q: i.search });
    truncated = r.truncated;
    rows = r.rows
      .filter((x) => x.impressions >= (i.minImpressions ?? 0) && posOk(x.position))
      .map((x) => ({ page: x.page, clicks: x.clicks, impressions: x.impressions, impressionsChangePct: round(x.deltaPct, 1), position: round(x.position, 1), queries: x.queryCount, aiPromptQueries: x.promptCount }));
  } else if (i.dimension === "country") {
    const r = await getScLocations(projectId, i.source, period, { view: i.view, intents: i.intents ?? [] });
    rows = r.rows
      .filter((x) => x.impressions >= (i.minImpressions ?? 0))
      .map((x) => ({ country: x.country, clicks: x.clicks, impressions: x.impressions, impressionsChangePct: round(x.deltaPct, 1), sharePct: round(x.share, 1), queries: x.queryCount, aiPromptQueries: x.promptCount }));
  } else {
    const r = await getScQueries(projectId, i.source, period, {
      view: i.view,
      intents: i.intents ?? [],
      countries: i.countries ?? [],
      q: i.search,
      page: i.page,
    });
    truncated = r.truncated;
    rows = r.rows
      .filter((x) => x.impressions >= (i.minImpressions ?? 0) && posOk(x.position))
      .map((x) => ({
        query: x.query,
        clicks: x.clicks,
        impressions: x.impressions,
        impressionsChangePct: round(x.deltaPct, 1),
        ctr: round(x.ctr),
        position: round(x.position, 1),
        topCountry: x.topCountry,
        words: x.words,
        isAiPrompt: x.isPrompt,
        intent: x.intent,
        tracked: x.tracked,
      }));
  }
  const total = rows.length;
  return {
    ...base,
    dimension: i.dimension,
    rowCount: Math.min(i.limit, Math.max(0, total - i.offset)),
    totalRowCount: total,
    rows: rows.slice(i.offset, i.offset + i.limit),
    hasMore: i.offset + i.limit < total,
    truncated,
  };
}

export const strikingDistanceInput = z.object({ ...scPeriodShape, limit: z.coerce.number().int().min(1).max(100).default(50) });

/** Queries ranking at positions ~5–20 with impressions (best page per query). */
export async function strikingDistance(projectId: string, i: z.infer<typeof strikingDistanceInput>) {
  await assertScAvailable(projectId, i.source);
  const period = resolveScPeriod(i);
  const rows = await getStrikingDistance(projectId, i.source, period);
  return {
    source: i.source,
    period: { from: period.from, to: period.to, days: period.days },
    rows: rows.slice(0, i.limit).map((r) => ({ ...r, position: round(r.position, 1) })),
    totalRowCount: rows.length,
  };
}
