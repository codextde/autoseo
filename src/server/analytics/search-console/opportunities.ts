import "server-only";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { getIntegration } from "@/server/integrations/store";
import { getGoogleAccessToken, googleApiErrorMessage } from "@/server/integrations/google/oauth";
import { gscQuery } from "@/server/integrations/google/gsc";
import { ga4RunReport, type Ga4ReportMetadata } from "@/server/integrations/google/ga4";
import { addDays } from "../period";
import { normalizePageKey, scoreOpportunities } from "./classify";

/**
 * Search Opportunity service (open-seo `get_search_opportunities`): joins GSC pages ranking at
 * positions 4–20 with GA4 organic landing-page performance and scores them by demand (impressions),
 * business value (key-event rate, engagement-rate fallback) and reachability (distance to top).
 */

export type OpportunityGa4 = {
  sessions: number;
  activeUsers: number;
  engagedSessions: number;
  engagementRate: number | null;
  keyEvents: number | null;
  sessionKeyEventRate: number | null;
  transactions: number | null;
  purchaseRevenue: number | null;
};

export type SearchOpportunityRow = {
  page: string;
  normalizedPage: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  joinStatus: "joined" | "gsc_only";
  ga4: OpportunityGa4 | null;
  score: number | null;
  scoreComponents: { demand: number; businessValue: number; reachability: number } | null;
};

export type SearchOpportunitiesOk = {
  status: "ok";
  source: { searchConsoleSiteUrl: string; googleAnalyticsPropertyId: string; googleAnalyticsPropertyDisplayName: string | null };
  request: { dateRange: { startDate: string; endDate: string }; limit: number; searchConsoleTimeZone: string; googleAnalyticsTimeZone: string };
  rowCount: number;
  totalCandidateRows: number;
  rows: SearchOpportunityRow[];
  scoring: { formula: string; businessValueMetric: "sessionKeyEventRate" | "engagementRate"; engagementFallback: boolean; scoreDataLimited: boolean };
  coverage: { gscRowsConsidered: number; ga4RowsConsidered: number; matchedRows: number; unmatchedGscRows: number; unmatchedGa4Rows: number };
  truncated: { gsc: boolean; ga4: boolean; candidates: boolean };
  warnings: { code: string; message: string }[];
  reportMetadata: Ga4ReportMetadata;
};

export type SearchOpportunitiesResult =
  | SearchOpportunitiesOk
  | { status: "gsc_not_connected" | "ga4_not_connected" | "validation_error" | "error"; message: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GSC_TZ = "America/Los_Angeles";

function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const n = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export async function getSearchOpportunities(
  projectId: string,
  opts: { startDate?: string; endDate?: string; limit?: number } = {},
): Promise<SearchOpportunitiesResult> {
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 50)));
  const [gscRow, ga4Row] = await Promise.all([getIntegration(projectId, PROVIDERS.gsc), getIntegration(projectId, PROVIDERS.ga4)]);
  const siteUrl = typeof gscRow?.config.siteUrl === "string" ? gscRow.config.siteUrl : "";
  if (!gscRow || gscRow.status === "pending" || !siteUrl)
    return { status: "gsc_not_connected", message: "Connect Google Search Console and choose a property." };
  const propertyId = typeof ga4Row?.config.propertyId === "string" ? ga4Row.config.propertyId : "";
  if (!ga4Row || ga4Row.status === "pending" || !propertyId)
    return { status: "ga4_not_connected", message: "Connect Google Analytics to score opportunities by business value." };
  const ga4Tz = typeof ga4Row.config.timeZone === "string" && ga4Row.config.timeZone ? ga4Row.config.timeZone : "UTC";

  // Dates: explicit (both or neither) or 28 days ending 3 days ago in the GA4 property time zone.
  let startDate: string;
  let endDate: string;
  if (opts.startDate || opts.endDate) {
    if (!opts.startDate || !opts.endDate || !DATE_RE.test(opts.startDate) || !DATE_RE.test(opts.endDate) || opts.startDate > opts.endDate)
      return { status: "validation_error", message: "Provide both startDate and endDate (YYYY-MM-DD, start ≤ end)." };
    startDate = opts.startDate;
    endDate = opts.endDate;
    const lastComplete = addDays(todayIn(ga4Tz), -1);
    if (endDate > lastComplete) endDate = lastComplete;
  } else {
    endDate = addDays(todayIn(ga4Tz), -3);
    startDate = addDays(endDate, -27);
  }

  let gscRows;
  let ga4;
  try {
    const [gscToken, ga4Token] = await Promise.all([getGoogleAccessToken(projectId, "gsc"), getGoogleAccessToken(projectId, "ga4")]);
    [gscRows, ga4] = await Promise.all([
      gscQuery(gscToken, siteUrl, { startDate, endDate, dimensions: ["page"], rowLimit: 1000, startRow: 0, type: "web", dataState: "final" }),
      ga4RunReport(ga4Token, propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: ["hostName", "landingPage"],
        metrics: ["sessions", "activeUsers", "engagedSessions", "engagementRate", "keyEvents", "sessionKeyEventRate", "transactions", "purchaseRevenue"],
        dimensionFilter: { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: "Organic Search" } } },
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 1000,
        offset: 0,
      }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", message: googleApiErrorMessage(err, /analytics/i.test(msg) ? "ga4" : "gsc") };
  }

  // GA4 landing pages keyed by normalized page (aggregate variants such as trailing slashes).
  type Acc = { sessions: number; activeUsers: number; engagedSessions: number; keyEvents: number | null; rateW: number; transactions: number | null; revenue: number | null };
  const ga4Map = new Map<string, Acc>();
  for (const r of ga4.rows) {
    const key = normalizePageKey(`${String(r.hostName ?? "")}${String(r.landingPage ?? "")}`);
    if (!key || String(r.landingPage ?? "") === "(not set)") continue;
    const sessions = n(r.sessions) ?? 0;
    const acc = ga4Map.get(key) ?? { sessions: 0, activeUsers: 0, engagedSessions: 0, keyEvents: 0, rateW: 0, transactions: 0, revenue: 0 };
    acc.sessions += sessions;
    acc.activeUsers += n(r.activeUsers) ?? 0;
    acc.engagedSessions += n(r.engagedSessions) ?? 0;
    acc.keyEvents = acc.keyEvents == null || r.keyEvents == null ? null : acc.keyEvents + (n(r.keyEvents) ?? 0);
    acc.rateW += (n(r.sessionKeyEventRate) ?? 0) * sessions;
    acc.transactions = acc.transactions == null || r.transactions == null ? null : acc.transactions + (n(r.transactions) ?? 0);
    acc.revenue = acc.revenue == null || r.purchaseRevenue == null ? null : acc.revenue + (n(r.purchaseRevenue) ?? 0);
    ga4Map.set(key, acc);
  }

  const candidates: SearchOpportunityRow[] = [];
  const matchedGa4 = new Set<string>();
  for (const r of gscRows) {
    const page = r.keys?.[0] ?? "";
    const key = normalizePageKey(page);
    if (!key || r.position < 4 || r.position > 20) continue;
    const g = ga4Map.get(key);
    if (g) matchedGa4.add(key);
    candidates.push({
      page,
      normalizedPage: key,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Math.round(r.ctr * 10_000) / 10_000,
      position: Math.round(r.position * 10) / 10,
      joinStatus: g ? "joined" : "gsc_only",
      ga4: g
        ? {
            sessions: g.sessions,
            activeUsers: g.activeUsers,
            engagedSessions: g.engagedSessions,
            engagementRate: g.sessions > 0 ? g.engagedSessions / g.sessions : null,
            keyEvents: g.keyEvents,
            sessionKeyEventRate: g.sessions > 0 ? g.rateW / g.sessions : null,
            transactions: g.transactions,
            purchaseRevenue: g.revenue,
          }
        : null,
      score: null,
      scoreComponents: null,
    });
  }

  const joined = candidates.filter((c) => c.joinStatus === "joined");
  const { scores, engagementFallback } = scoreOpportunities(
    joined.map((c) => ({
      impressions: c.impressions,
      position: c.position,
      sessionKeyEventRate: c.ga4!.sessionKeyEventRate,
      engagementRate: c.ga4!.engagementRate,
      keyEvents: c.ga4!.keyEvents,
    })),
  );
  joined.forEach((c, i) => {
    c.score = scores[i]!.score;
    c.scoreComponents = scores[i]!.components;
  });

  const sorted = [...candidates].sort((a, b) => {
    if (a.score != null && b.score == null) return -1;
    if (a.score == null && b.score != null) return 1;
    if (a.score != null && b.score != null && a.score !== b.score) return b.score - a.score;
    return b.impressions - a.impressions;
  });
  const rows = sorted.slice(0, limit);

  const warnings: { code: string; message: string }[] = [];
  if (ga4Tz !== GSC_TZ)
    warnings.push({
      code: "source_time_zones_differ",
      message: `Search Console reports in ${GSC_TZ}, Google Analytics in ${ga4Tz}; daily boundaries differ slightly.`,
    });
  if (ga4.metadata.hasLimitedData)
    warnings.push({ code: "ga4_limited_data", message: "Google Analytics data is sampled, thresholded or restricted for this range." });
  if (!joined.length && candidates.length)
    warnings.push({ code: "no_matches", message: "No Search Console page matched a Google Analytics landing page — check that both use the same host." });

  return {
    status: "ok",
    source: {
      searchConsoleSiteUrl: siteUrl,
      googleAnalyticsPropertyId: propertyId,
      googleAnalyticsPropertyDisplayName: typeof ga4Row.config.propertyName === "string" ? ga4Row.config.propertyName : null,
    },
    request: { dateRange: { startDate, endDate }, limit, searchConsoleTimeZone: GSC_TZ, googleAnalyticsTimeZone: ga4Tz },
    rowCount: rows.length,
    totalCandidateRows: candidates.length,
    rows,
    scoring: {
      formula: "score = round(100 × (0.5 × demand + 0.3 × businessValue + 0.2 × reachability)); components are percentile ranks",
      businessValueMetric: engagementFallback ? "engagementRate" : "sessionKeyEventRate",
      engagementFallback,
      scoreDataLimited: ga4.metadata.hasLimitedData,
    },
    coverage: {
      gscRowsConsidered: gscRows.length,
      ga4RowsConsidered: ga4.rows.length,
      matchedRows: joined.length,
      unmatchedGscRows: candidates.length - joined.length,
      unmatchedGa4Rows: [...ga4Map.keys()].filter((k) => !matchedGa4.has(k)).length,
    },
    truncated: { gsc: gscRows.length >= 1000, ga4: ga4.rowCount > ga4.rows.length, candidates: candidates.length > limit },
    warnings,
    reportMetadata: ga4.metadata,
  };
}
