import "server-only";
import { z } from "zod";
import { Ga4ReportError } from "@/server/analytics/ga4";
import {
  GA4_REPORT_DEFS,
  GA4_REPORT_KEYS,
  scPerformanceInput,
  searchConsolePerformance,
  searchOpportunities,
  searchOpportunitiesInput,
  strikingDistance,
  strikingDistanceInput,
} from "@/server/api/analytics";
import { inspectUrlForApi, inspectUrlInput } from "@/server/api/inspection";
import { defineTool, type McpToolContext, type McpToolResult } from "../types";
import { mdTable, projectIdInput, toolProject } from "../helpers";

const RO_LIVE = { readOnlyHint: true, openWorldHint: true } as const;

/** Drops REST defaults so MCP callers see the same defaults in descriptions without zod coercion quirks. */
const scShape = scPerformanceInput.shape;

function withoutProjectId(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([k]) => k !== "projectId"));
}

function num(v: unknown) {
  return typeof v === "number" ? (Number.isInteger(v) ? v : Math.round(v * 100) / 100) : v;
}

/** open-seo style soft error for GA4 (tool succeeds with a structured error payload). */
function ga4SoftError(err: Ga4ReportError, baseUrl: string, projectId: string): McpToolResult {
  const actionUrl = err.actionUrl ? `${baseUrl}${err.actionUrl}` : `${baseUrl}/p/${projectId}/integrations`;
  return {
    text: `Google Analytics error (${err.code}): ${err.message}${
      err.code === "ga4_not_connected" || err.code === "ga4_reconnect_required" || err.code === "ga4_property_inaccessible"
        ? ` Connect Google Analytics here: ${actionUrl}`
        : err.retryAfterSeconds
          ? ` Retry after ${err.retryAfterSeconds}s.`
          : ""
    }`,
    data: { projectId, status: "error", error: { code: err.code, message: err.message, retryAfterSeconds: err.retryAfterSeconds ?? null, actionUrl } },
    isError: true,
  };
}

type Envelope = {
  rows?: Record<string, unknown>[];
  totalRowCount?: number;
  request?: { resolvedDateRange?: { startDate: string; endDate: string }; dimensions?: string[]; metrics?: string[] };
  source?: { propertyDisplayName?: string };
  warnings?: string[];
  diagnostics?: { message: string }[];
};

function describeEnvelope(title: string, r: Envelope): string {
  const range = r.request?.resolvedDateRange;
  const cols = [...(r.request?.dimensions ?? []), ...(r.request?.metrics ?? [])].slice(0, 9);
  const head = `${title} — ${r.source?.propertyDisplayName ?? "GA4"}${range ? `, ${range.startDate} → ${range.endDate}` : ""} · ${r.rows?.length ?? 0} of ${r.totalRowCount ?? 0} rows`;
  const table = cols.length && r.rows ? `\n\n${mdTable(r.rows, cols.map((c) => [c, (row: Record<string, unknown>) => num(row[c])] as [string, (row: Record<string, unknown>) => unknown]), 25)}` : "";
  const notes = [...(r.warnings ?? []), ...(r.diagnostics ?? []).map((d) => d.message)];
  return `${head}${table}${notes.length ? `\n\nNotes: ${notes.join(" · ")}` : ""}`;
}

async function runGa4Tool(ctx: McpToolContext, projectId: string, title: string, fn: () => Promise<unknown>): Promise<McpToolResult> {
  try {
    const r = (await fn()) as Envelope & Record<string, unknown>;
    return { text: describeEnvelope(title, r), data: { projectId, ...r, url: `${ctx.baseUrl}/p/${projectId}/analytics/traffic` } };
  } catch (err) {
    if (err instanceof Ga4ReportError) return ga4SoftError(err, ctx.baseUrl, projectId);
    throw err;
  }
}

const ga4Tools = GA4_REPORT_KEYS.map((key) => {
  const def = GA4_REPORT_DEFS[key];
  return defineTool({
    name: def.tool,
    title: def.title,
    description: `${def.description} Free (Google Analytics Data API); requires Google Analytics connected for the project.`,
    input: z.object({ projectId: projectIdInput, ...def.input.shape }),
    scope: "read",
    annotations: RO_LIVE,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId as string | undefined);
      const input = withoutProjectId(args as Record<string, unknown>);
      if (key === "organic-overview") {
        try {
          const r = (await def.run(p.id, input)) as Awaited<ReturnType<(typeof GA4_REPORT_DEFS)["organic-overview"]["run"]>>;
          const rows = Object.entries(r.comparison).map(([metric, c]) => ({ metric, ...c }));
          return {
            text: `Organic overview — ${r.source.propertyDisplayName}, ${r.request.resolvedDateRange.startDate} → ${r.request.resolvedDateRange.endDate} vs ${r.request.previousDateRange.startDate} → ${r.request.previousDateRange.endDate}\n\n${mdTable(rows, [
              ["metric", (x) => x.metric],
              ["current", (x) => num(x.current)],
              ["previous", (x) => num(x.previous)],
              ["change %", (x) => num(x.percentChange)],
            ])}${r.diagnostics.length ? `\n\nDiagnostics: ${r.diagnostics.map((d) => d.message).join(" · ")}` : ""}`,
            data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/analytics/traffic` },
          };
        } catch (err) {
          if (err instanceof Ga4ReportError) return ga4SoftError(err, ctx.baseUrl, p.id);
          throw err;
        }
      }
      if (key === "measurement-health") {
        try {
          const r = (await def.run(p.id, input)) as Awaited<ReturnType<(typeof GA4_REPORT_DEFS)["measurement-health"]["run"]>>;
          return {
            text: `GA4 measurement health — ${r.source.propertyDisplayName}: ${r.summary.webStreamCount} web stream(s), ${r.summary.keyEventCount} key event(s), ${r.summary.customDimensionCount} custom dimension(s), ${r.summary.issueCount} issue(s).\n\n${mdTable(r.issues, [
              ["severity", (i) => i.severity],
              ["issue", (i) => i.code],
              ["message", (i) => i.message],
            ])}`,
            data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/analytics/traffic?tab=settings` },
          };
        } catch (err) {
          if (err instanceof Ga4ReportError) return ga4SoftError(err, ctx.baseUrl, p.id);
          throw err;
        }
      }
      return runGa4Tool(ctx, p.id, def.title, () => def.run(p.id, input));
    },
  });
});

/** Search Console (synced data) + GA4 report tools (open-seo parity). */
export const analyticsTools = [
  defineTool({
    name: "get_search_console_performance",
    title: "Search Console performance",
    description:
      "Search performance from Google Search Console (or Bing Webmaster Tools) synced into the app: totals (clicks, impressions, CTR, avg position) vs the previous period, plus rows by query, page, country or date. Filter by query/page text, AI-style prompt queries, intent, country, min impressions and position range (e.g. striking distance: minPosition 5, maxPosition 20, minImpressions 50). Free; data lags ~2–3 days and syncs daily.",
    input: z.object({
      projectId: projectIdInput,
      source: scShape.source,
      dimension: scShape.dimension,
      timeframeDays: z.number().int().min(1).max(486).optional().describe(scShape.timeframeDays.description ?? ""),
      startDate: scShape.startDate,
      endDate: scShape.endDate,
      search: scShape.search,
      page: scShape.page,
      view: scShape.view,
      intents: scShape.intents,
      countries: scShape.countries,
      minImpressions: z.number().int().min(0).optional(),
      minPosition: z.number().min(0).max(200).optional(),
      maxPosition: z.number().min(0).max(200).optional(),
      limit: z.number().int().min(1).max(1000).optional().describe("Rows to return (default 100)."),
      offset: z.number().int().min(0).max(100_000).optional(),
    }),
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await searchConsolePerformance(p.id, scPerformanceInput.parse(withoutProjectId(args)));
      const cols: [string, (row: Record<string, unknown>) => unknown][] =
        r.dimension === "query"
          ? [
              ["query", (x) => x.query],
              ["clicks", (x) => x.clicks],
              ["impressions", (x) => x.impressions],
              ["CTR %", (x) => x.ctr],
              ["position", (x) => x.position],
              ["AI prompt", (x) => x.isAiPrompt],
            ]
          : r.dimension === "page"
            ? [
                ["page", (x) => x.page],
                ["clicks", (x) => x.clicks],
                ["impressions", (x) => x.impressions],
                ["position", (x) => x.position],
                ["queries", (x) => x.queries],
              ]
            : r.dimension === "country"
              ? [
                  ["country", (x) => x.country],
                  ["clicks", (x) => x.clicks],
                  ["impressions", (x) => x.impressions],
                  ["share %", (x) => x.sharePct],
                ]
              : [
                  ["date", (x) => x.date],
                  ["clicks", (x) => x.clicks],
                  ["impressions", (x) => x.impressions],
                ];
      const t = r.totals;
      return {
        text: `${r.source === "google" ? "Google Search Console" : "Bing Webmaster Tools"}${r.site ? ` ${r.site}` : ""} — ${r.period.from} → ${r.period.to}: ${t.clicks} clicks (${r.changes.clicksPct ?? "—"}%), ${t.impressions} impressions (${r.changes.impressionsPct ?? "—"}%), CTR ${t.ctr ?? "—"}%, avg position ${t.position ?? "—"}. ${r.totalRowCount} ${r.dimension} row(s)${r.truncated ? " (truncated)" : ""}.\n\n${mdTable(r.rows, cols, 30)}`,
        data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/analytics/search-console` },
      };
    },
  }),

  defineTool({
    name: "get_search_console_striking_distance",
    title: "Striking-distance keywords",
    description:
      "Queries whose best page ranks at positions 5–20 in Google Search Console (or Bing), sorted by impressions — quick-win keywords to push onto page one. Flags AI-style prompt queries and queries already tracked as prompts. Free.",
    input: z.object({
      projectId: projectIdInput,
      source: strikingDistanceInput.shape.source,
      timeframeDays: z.number().int().min(1).max(486).optional().describe("Look-back window in days (default 28)."),
      startDate: strikingDistanceInput.shape.startDate,
      endDate: strikingDistanceInput.shape.endDate,
      limit: z.number().int().min(1).max(100).optional().describe("Default 50."),
    }),
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await strikingDistance(p.id, strikingDistanceInput.parse(withoutProjectId(args)));
      return {
        text: `${r.totalRowCount} striking-distance quer${r.totalRowCount === 1 ? "y" : "ies"} (${r.period.from} → ${r.period.to}).\n\n${mdTable(r.rows, [
          ["query", (x) => x.query],
          ["page", (x) => x.page],
          ["impressions", (x) => x.impressions],
          ["clicks", (x) => x.clicks],
          ["position", (x) => x.position],
          ["AI prompt", (x) => x.isPrompt],
        ])}`,
        data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/analytics/search-console` },
      };
    },
  }),

  defineTool({
    name: "get_search_opportunities",
    title: "Search opportunities (GSC × GA4)",
    description:
      "Joins Google Search Console pages ranking at positions 4–20 with GA4 organic landing-page performance and scores each page 0–100 by demand (impressions), business value (key-event rate, engagement fallback) and reachability (distance to top). Requires both Search Console and Google Analytics connected. Free (live Google APIs).",
    input: z.object({
      projectId: projectIdInput,
      startDate: searchOpportunitiesInput.shape.startDate,
      endDate: searchOpportunitiesInput.shape.endDate,
      limit: z.number().int().min(1).max(100).optional().describe("Default 50."),
    }),
    scope: "read",
    annotations: RO_LIVE,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await searchOpportunities(p.id, searchOpportunitiesInput.parse({ startDate: args.startDate, endDate: args.endDate, limit: args.limit }));
      return {
        text: `${r.rowCount} opportunit${r.rowCount === 1 ? "y" : "ies"} (${r.request.dateRange.startDate} → ${r.request.dateRange.endDate}; ${r.coverage.matchedRows} pages joined with GA4). ${r.scoring.formula}\n\n${mdTable(r.rows, [
          ["score", (x) => x.score],
          ["page", (x) => x.page],
          ["impressions", (x) => x.impressions],
          ["clicks", (x) => x.clicks],
          ["position", (x) => num(x.position)],
          ["sessions", (x) => x.ga4?.sessions],
          ["key events", (x) => x.ga4?.keyEvents],
        ])}`,
        data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/analytics/search-console` },
      };
    },
  }),

  defineTool({
    name: "inspect_url",
    title: "Inspect URL (Search Console)",
    description:
      "Google Search Console URL Inspection for one page of the project's property: index verdict, coverage state, robots.txt and indexing state, last crawl, Google-selected vs declared canonical (canonicalMismatch), sitemaps, mobile usability, rich results and AMP. Results from the last 24 h are reused (cached: true, no quota); a live inspection uses the property's Google quota (2,000/day, 600/min) and needs the “Run paid SEO research” or “Integrations” permission. Free. Requires Search Console connected.",
    input: z.object({ projectId: projectIdInput, ...inspectUrlInput.shape }),
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await inspectUrlForApi(ctx.principal, p, { url: args.url, force: args.force, languageCode: args.languageCode });
      const x = r.result;
      const lines = [
        `**${r.url}** — verdict ${x.verdict}${x.coverageState ? ` · ${x.coverageState}` : ""}${r.cached ? " (cached result)" : ""}, inspected ${r.inspectedAt}`,
        `- Indexing: ${x.indexingState ?? "unknown"} · robots.txt: ${x.robotsTxtState ?? "unknown"} · page fetch: ${x.pageFetchState ?? "unknown"} · crawled as ${x.crawledAs ?? "unknown"}`,
        `- Last crawl: ${x.lastCrawlTime ?? "never"}`,
        `- Canonical: Google ${x.googleCanonical ?? "—"} · declared ${x.userCanonical ?? "—"}${x.canonicalMismatch ? " (MISMATCH)" : ""}`,
        x.mobileUsability ? `- Mobile usability: ${x.mobileUsability.verdict}${x.mobileUsability.issues.length ? ` (${x.mobileUsability.issues.map((i) => i.message ?? i.issueType).join("; ")})` : ""}` : "",
        x.richResults ? `- Rich results: ${x.richResults.verdict} — ${x.richResults.detectedItems.map((d) => d.richResultType).join(", ") || "none"}` : "",
        `- Quota today: ${r.quota.used}/${r.quota.limit} used`,
        x.inspectionResultLink ? `- Search Console: ${x.inspectionResultLink}` : "",
      ].filter(Boolean);
      return { text: lines.join("\n"), data: { projectId: p.id, ...r, url: r.url, appUrl: `${ctx.baseUrl}/p/${p.id}/analytics/search-console` } };
    },
  }),

  ...ga4Tools,
];
