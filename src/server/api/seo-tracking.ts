import "server-only";
import { z } from "zod";
import {
  addTrackingKeywords,
  createLocalRun,
  estimateRankTrackerCost,
  getLocalRun,
  getRankTrackingResults,
  isDataForSeoConfigured,
  listRankConfigSummaries,
  SeoError,
  type LocalRun,
  type LocalRunTool,
  type RankConfig,
  type SeoContext,
} from "@/server/seo";
import { SEO_LOCAL_TOOLS } from "@/server/db/schema";
import type { LocalToolInput } from "@/server/seo/local";
import { ApiError } from "./errors";

/**
 * Shared glue for the rank-tracking + local SEO MCP tools and REST endpoints (seo module services
 * do the work; this file adds DataForSEO pre-checks, run polling and stable DTOs).
 */

export const COMPARE_PERIODS = ["1d", "7d", "30d", "90d"] as const;

/** Fails fast (before a run row / job is created) when DataForSEO credentials are missing. */
export async function requireDataForSeo() {
  if (!(await isDataForSeoConfigured())) {
    throw new SeoError("NOT_CONFIGURED", "DataForSEO is not configured. An admin can add credentials in Admin → Data Providers.");
  }
}

/* ───────────────────────────── Rank trackers ───────────────────────────── */

export function trackerView(c: RankConfig, extra: { keywordCount?: number; lastRunStatus?: string | null; lastRunCompletedAt?: Date | null } = {}) {
  return {
    trackerId: c.id,
    domain: c.domain,
    locationCode: c.locationCode,
    languageCode: c.languageCode,
    locationName: c.locationName,
    devices: c.devices,
    serpDepth: c.serpDepth,
    scheduleInterval: c.scheduleInterval,
    nextCheckAt: c.nextCheckAt?.toISOString() ?? null,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
    ...(extra.keywordCount !== undefined ? { keywordCount: extra.keywordCount } : {}),
    ...(extra.lastRunStatus !== undefined ? { lastRunStatus: extra.lastRunStatus } : {}),
    ...(extra.lastRunCompletedAt !== undefined ? { lastRunCompletedAt: extra.lastRunCompletedAt?.toISOString() ?? null } : {}),
  };
}

export async function listTrackers(ctx: SeoContext) {
  return (await listRankConfigSummaries(ctx)).map((c) =>
    trackerView(c, { keywordCount: c.keywordCount, lastRunStatus: c.lastRunStatus, lastRunCompletedAt: c.lastRunCompletedAt }),
  );
}

/** Current positions per keyword + device vs. the comparison period, and the latest run. */
export async function trackerResults(ctx: SeoContext, trackerId: string, comparePeriod: (typeof COMPARE_PERIODS)[number] = "7d") {
  const res = await getRankTrackingResults(ctx, trackerId, comparePeriod);
  const run = res.run
    ? {
        id: res.run.id,
        status: res.run.status,
        trigger: res.run.trigger,
        keywordsChecked: res.run.keywordsChecked,
        keywordsTotal: res.run.keywordsTotal,
        errorMessage: res.run.errorMessage,
        startedAt: res.run.startedAt.toISOString(),
        completedAt: res.run.completedAt?.toISOString() ?? null,
        lastCheckedAt: res.run.lastCheckedAt?.toISOString() ?? null,
        costUsd: res.run.costUsd,
      }
    : null;
  const rows = res.rows.map((r) => ({
    trackingKeywordId: r.trackingKeywordId,
    keyword: r.keyword,
    searchVolume: r.searchVolume,
    keywordDifficulty: r.keywordDifficulty,
    cpc: r.cpc,
    desktop: r.desktop,
    mobile: r.mobile,
  }));
  return { config: trackerView(res.config), comparePeriod, rows, run };
}

export const trackerResultsQuery = z.object({ comparePeriod: z.enum(COMPARE_PERIODS).default("7d").describe("Comparison window for previous positions.") });
export const estimateQuery = z.object({
  additionalKeywordCount: z.coerce.number().int().min(0).max(1000).default(0).describe("Estimate as if this many keywords were added."),
});
export const removeKeywordsBody = z.object({ keywordIds: z.array(z.string().min(1).max(64)).min(1).max(2000).describe("trackingKeywordId values.") });
export const runCheckBody = z.object({
  maxCostUsd: z.number().positive().describe("Approved maximum cost in USD; refused when the live estimate is higher."),
  keywordIds: z.array(z.string().min(1).max(64)).max(2000).optional().describe("Only check these trackingKeywordIds."),
});
export const localRunsQuery = z.object({
  tool: z.enum(SEO_LOCAL_TOOLS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const localRunQuery = z.object({ waitSeconds: z.coerce.number().int().min(0).max(50).default(0).describe("Wait up to N seconds for a pending run.") });
export const categoriesQuery = z.object({
  query: z.string().trim().max(80).optional().describe("Substring filter, e.g. solar."),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const createTrackerBody = z.object({
  domain: z.string().trim().min(1).max(253).optional().describe("Domain to track (default: the project domain)."),
  locationCode: z.number().int().positive().optional().describe("DataForSEO location code (default: project market)."),
  languageCode: z.string().min(2).max(8).optional(),
  locationName: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .optional()
    .describe('Exact DataForSEO city/region name for local tracking, e.g. "Munich,Bavaria,Germany" (from search_serp_locations).'),
  devices: z.enum(["both", "desktop", "mobile"]).default("mobile"),
  serpDepth: z.number().int().min(10).max(100).multipleOf(10).default(40).describe("Results checked per keyword (10–100, step 10)."),
  scheduleInterval: z.enum(["manual", "daily", "weekly", "monthly"]).default("manual").describe("manual = only when run_rank_tracker is called."),
});

export const addKeywordsBody = z.object({
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(2000),
  matchCase: z.boolean().default(false).describe("Track the exact casing (default false: keywords are lowercased)."),
  maxEstimatedScheduledCheckCostUsd: z
    .number()
    .nonnegative()
    .optional()
    .describe("Required for scheduled trackers: approved USD per scheduled check after adding (see estimate_rank_tracker_cost)."),
  runCheckNow: z.boolean().default(false).describe("Immediately run a paid live check for the new keywords (default false)."),
});

/** Adds keywords; scheduled trackers need an explicit approval of the recurring per-check cost. */
export async function addKeywordsWithApproval(ctx: SeoContext, trackerId: string, body: z.infer<typeof addKeywordsBody>) {
  const estimate = await estimateRankTrackerCost(ctx, trackerId, body.keywords.length);
  if (estimate.scheduledEstimate && body.maxEstimatedScheduledCheckCostUsd === undefined) {
    const e = estimate.scheduledEstimate;
    throw new ApiError(
      "validation_error",
      `This tracker runs ${e.scheduleInterval}. After adding, each scheduled check costs ~$${e.costUsd.toFixed(4)} (~$${e.monthlyCostUsd.toFixed(2)}/month). Pass maxEstimatedScheduledCheckCostUsd ≥ ${e.costUsd} to approve.`,
      { scheduledEstimate: e },
    );
  }
  if (body.runCheckNow) await requireDataForSeo();
  const res = await addTrackingKeywords(ctx, {
    configId: trackerId,
    keywords: body.keywords,
    matchCase: body.matchCase,
    autoCheck: body.runCheckNow,
    maxScheduledCheckCostUsd: body.maxEstimatedScheduledCheckCostUsd,
  });
  return { trackerId, requested: body.keywords.length, ...res };
}

/* ───────────────────────────── Local SEO runs ───────────────────────────── */

export const LOCAL_TOOL_SLUGS: Record<string, LocalRunTool> = {
  "business-search": "business_search",
  "local-serp": "local_serp",
  "rank-grid": "rank_grid",
  "business-profile": "business_profile",
  reviews: "reviews",
  questions: "questions",
  posts: "posts",
};

const TERMINAL = new Set(["completed", "failed"]);

export function localRunView(run: LocalRun) {
  return {
    runId: run.id,
    tool: run.tool,
    label: run.label,
    status: run.status,
    error: run.error,
    costUsd: run.costUsd,
    input: run.input,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    result: run.status === "completed" ? (run.result as Record<string, unknown> | null) : null,
  };
}

export type LocalRunView = ReturnType<typeof localRunView>;

/** Polls a run until it finishes or `waitMs` elapses (runs execute on the in-process job worker). */
export async function waitForLocalRun(ctx: SeoContext, runId: string, waitMs: number): Promise<LocalRunView> {
  const deadline = Date.now() + Math.max(0, Math.min(55_000, waitMs));
  let run = await getLocalRun(ctx, runId);
  while (!TERMINAL.has(run.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    run = await getLocalRun(ctx, runId);
  }
  return localRunView(run);
}

/** Starts a paid local SEO run (DataForSEO) and waits briefly for its result. */
export async function startLocalRun<T extends LocalRunTool>(ctx: SeoContext, tool: T, input: LocalToolInput<T>, waitMs: number): Promise<LocalRunView> {
  await requireDataForSeo();
  const run = await createLocalRun(ctx, tool, input);
  return waitForLocalRun(ctx, run.id, waitMs);
}
