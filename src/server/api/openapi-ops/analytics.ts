import "server-only";
import type { OpenApiOperation } from "../openapi-helpers";
import { inspectionsQuery, inspectUrlInput } from "../inspection";
import {
  GA4_REPORT_DEFS,
  GA4_REPORT_KEYS,
  scPerformanceInput,
  searchOpportunitiesInput,
  strikingDistanceInput,
} from "../analytics";

/*
 * Local JSON-schema helpers: importing `S` from ../openapi would create an import cycle
 * (openapi.ts imports this file at module load, before `S` is initialised).
 */
type Json = Record<string, unknown>;
const obj = (properties: Json, extra: Json = {}): Json => ({ type: "object", properties, ...extra });
const arr = (items: Json): Json => ({ type: "array", items });
const str: Json = { type: "string" };
const strN: Json = { type: ["string", "null"] };
const int: Json = { type: "integer" };
const num: Json = { type: ["number", "null"] };
const bool: Json = { type: "boolean" };

const ga4Envelope = {
  description:
    "GA4 report rows (dimension + metric columns). meta carries source, request (resolved date range, dimensions, metrics), totalRowCount, pageInfo, reportMetadata, quota, warnings, diagnostics and comparison when requested.",
  type: "array",
  items: { type: "object" },
};

/** REST v1 operations of this domain (merged into /api/v1/openapi.json). */
export const analyticsOperations: OpenApiOperation[] = [
  {
    method: "post",
    path: "/projects/{projectId}/search-console/inspect",
    operationId: "inspectUrl",
    summary: "Inspect URL (Search Console)",
    description:
      "Google URL Inspection for one page of the project's Search Console property: index verdict, coverage, robots/indexing state, last crawl, Google vs declared canonical, sitemaps, mobile usability, rich results. Results from the last 24 h are reused (`cached: true`); a live inspection uses the property's Google quota (2,000/day) and needs the seo.run or settings.manage permission. Quota errors return 429 `rate_limited`.",
    tag: "Search Console",
    scope: "read",
    body: inspectUrlInput,
    data: obj({
      id: str,
      url: str,
      siteUrl: str,
      cached: { type: "boolean" },
      inspectedAt: { type: "string", format: "date-time" },
      quota: obj({ used: num, limit: num, remaining: num }),
      result: { type: "object", description: "verdict, coverageState, robotsTxtState, indexingState, lastCrawlTime, pageFetchState, googleCanonical, userCanonical, canonicalMismatch, crawledAs, sitemaps, referringUrls, mobileUsability, richResults, amp, inspectionResultLink" },
    }),
  },
  {
    method: "get",
    path: "/projects/{projectId}/search-console/inspections",
    operationId: "listUrlInspections",
    summary: "Recent URL inspections",
    description: "Recent inspections (newest first, including failed attempts) and today's quota usage.",
    tag: "Search Console",
    scope: "read",
    query: inspectionsQuery,
    data: arr(obj({ id: str, url: str, verdict: { type: ["string", "null"] }, coverageState: { type: ["string", "null"] }, error: { type: ["string", "null"] }, inspectedAt: str })),
    meta: { quota: { type: ["object", "null"] } },
  },
  {
    method: "get",
    path: "/projects/{projectId}/search-console",
    operationId: "getSearchConsolePerformance",
    summary: "Search Console performance",
    description:
      "Totals (clicks, impressions, CTR, position) vs the previous period and rows by query, page, country or date from the synced Google Search Console (or Bing Webmaster) data. 409 not_connected when the source isn't connected. Array params (intents, countries) may repeat or be comma-separated.",
    tag: "Search Console",
    scope: "read",
    query: scPerformanceInput,
    data: arr({ type: "object", description: "Rows of the chosen dimension" }),
    meta: {
      source: str,
      site: strN,
      period: obj({ from: str, to: str, days: int }),
      totals: obj({ clicks: num, impressions: num, ctr: num, position: num }),
      changes: obj({ clicksPct: num, impressionsPct: num, ctrPoints: num, positionImprovement: num }),
      totalRowCount: int,
      truncated: bool,
    },
  },
  {
    method: "get",
    path: "/projects/{projectId}/search-console/striking-distance",
    operationId: "getStrikingDistanceQueries",
    summary: "Striking-distance queries",
    description: "Queries whose best page ranks at positions 5–20, by impressions.",
    tag: "Search Console",
    scope: "read",
    query: strikingDistanceInput,
    data: arr(obj({ query: str, page: str, impressions: num, clicks: num, position: num, isPrompt: bool, tracked: bool })),
    meta: { source: str, period: obj({ from: str, to: str, days: int }), totalRowCount: int },
  },
  {
    method: "get",
    path: "/projects/{projectId}/search-console/opportunities",
    operationId: "getSearchOpportunities",
    summary: "Search opportunities (GSC × GA4)",
    description:
      "Pages ranking 4–20 in Search Console joined with GA4 organic landing pages, scored 0–100 by demand, business value and reachability. Requires Search Console and Google Analytics connected.",
    tag: "Search Console",
    scope: "read",
    query: searchOpportunitiesInput,
    data: arr(
      obj({
        page: str,
        clicks: num,
        impressions: num,
        ctr: num,
        position: num,
        joinStatus: { type: "string", enum: ["joined", "gsc_only"] },
        ga4: { type: ["object", "null"] },
        score: num,
        scoreComponents: { type: ["object", "null"] },
      }),
    ),
    meta: { source: { type: "object" }, request: { type: "object" }, scoring: { type: "object" }, coverage: { type: "object" }, warnings: arr({ type: "object" }) },
  },
  ...GA4_REPORT_KEYS.map(
    (key): OpenApiOperation => ({
      method: "get",
      path: `/projects/{projectId}/analytics/ga4/${key}`,
      operationId: `getGa4${key.replace(/(^|-)(\w)/g, (_m, _d, c: string) => c.toUpperCase())}`,
      summary: GA4_REPORT_DEFS[key].title,
      description: `${GA4_REPORT_DEFS[key].description} Requires Google Analytics connected (409 not_connected otherwise; 429 when the GA4 quota is exhausted).`,
      tag: "Google Analytics",
      scope: "read",
      query: GA4_REPORT_DEFS[key].input,
      data: key === "organic-overview" || key === "measurement-health" ? { type: "object" } : ga4Envelope,
    }),
  ),
];
