import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { jobs, seoRankConfigs, seoRankKeywords, seoRankRuns, seoRankSnapshots } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { assertCanRun, SeoError, type SeoContext } from "./context";
import { assertSerpLocationNameAccepted, dfsGetTask } from "./dfs";
import { cacheGet, cacheSet, CACHE_TTL } from "./cache";
import { getDomainKeywordSuggestions } from "./domain";
import {
  COMPARE_PERIOD_DAYS,
  computeNextCheckAt,
  DEFAULT_SERP_DEPTH,
  devicesCount,
  estimateRankCheckCost,
  estimateScheduledRankCheckCost,
  isScheduledInterval,
  MAX_CONFIGS_PER_PROJECT,
  MAX_KEYWORDS_PER_CONFIG,
  MAX_TRACKED_KEYWORD_LENGTH,
  normalizeTrackedKeywords,
  normalizeTrackerDomain,
  RANK_CHECK_STARTUP_GRACE_MS,
  type ComparePeriod,
  type RankDevices,
  type ScheduleInterval,
} from "./lib/rank-tracking";
import { getIsoCountryCode, isLabsLocationCode, isSupportedLanguageCode, resolveMarket } from "./lib/locations";
import { rankSerpLocations, slimLocationRegistry, type SerpLocation } from "./lib/serp-locations";
import { isValidDomainHost } from "./lib/research-scope";

export const RANK_CHECK_JOB = "seo.rank-check";
export const RANK_COLLECT_JOB = "seo.rank-collect";
export const RANK_METRICS_JOB = "seo.rank-metrics";

export type RankConfig = typeof seoRankConfigs.$inferSelect;
export type RankRun = typeof seoRankRuns.$inferSelect;
export type RankKeyword = typeof seoRankKeywords.$inferSelect;

/* ───────────────────────────── Configs ───────────────────────────── */

export async function getConfig(ctx: Pick<SeoContext, "projectId">, configId: string): Promise<RankConfig> {
  const [config] = await db
    .select()
    .from(seoRankConfigs)
    .where(and(eq(seoRankConfigs.id, configId), eq(seoRankConfigs.projectId, ctx.projectId)))
    .limit(1);
  if (!config) throw new SeoError("NOT_FOUND", "Rank tracking config not found");
  return config;
}

export async function listRankConfigs(ctx: SeoContext) {
  return db
    .select()
    .from(seoRankConfigs)
    .where(and(eq(seoRankConfigs.projectId, ctx.projectId), eq(seoRankConfigs.isActive, true)))
    .orderBy(desc(seoRankConfigs.createdAt));
}

export type RankConfigSummary = RankConfig & { keywordCount: number; lastRunStatus: RankRun["status"] | null; lastRunCompletedAt: Date | null };

/** Active configs + keyword count + latest run (by max startedAt). */
export async function listRankConfigSummaries(ctx: SeoContext): Promise<RankConfigSummary[]> {
  const configs = await listRankConfigs(ctx);
  if (!configs.length) return [];
  const ids = configs.map((c) => c.id);
  const counts = await db
    .select({ configId: seoRankKeywords.configId, n: count() })
    .from(seoRankKeywords)
    .where(inArray(seoRankKeywords.configId, ids))
    .groupBy(seoRankKeywords.configId);
  const latestRuns = await db
    .selectDistinctOn([seoRankRuns.configId], { configId: seoRankRuns.configId, status: seoRankRuns.status, completedAt: seoRankRuns.completedAt })
    .from(seoRankRuns)
    .where(inArray(seoRankRuns.configId, ids))
    .orderBy(seoRankRuns.configId, desc(seoRankRuns.startedAt));
  const countMap = new Map(counts.map((c) => [c.configId, Number(c.n)]));
  const runMap = new Map(latestRuns.map((r) => [r.configId, r]));
  return configs.map((c) => ({
    ...c,
    keywordCount: countMap.get(c.id) ?? 0,
    lastRunStatus: runMap.get(c.id)?.status ?? null,
    lastRunCompletedAt: runMap.get(c.id)?.completedAt ?? null,
  }));
}

const domainField = z
  .string()
  .trim()
  .min(1, "Enter a domain")
  .max(253)
  .transform(normalizeTrackerDomain)
  .refine((d) => d.includes(".") && /^[a-z\d.-]+$/.test(d) && isValidDomainHost(d), "Enter a valid domain like example.com");

export const createRankConfigInput = z.object({
  domain: domainField,
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().min(2).max(8).optional(),
  locationName: z.string().trim().min(1).max(300).nullable().optional(),
  devices: z.enum(["both", "desktop", "mobile"]).default("both"),
  serpDepth: z.number().int().min(10).max(100).multipleOf(10).default(DEFAULT_SERP_DEPTH),
  scheduleInterval: z.enum(["daily", "weekly", "monthly", "manual"]).default("weekly"),
});

/**
 * Validates local location names against the free DataForSEO sandbox; reactivates an archived duplicate
 * (keeps history); max 500 configs per project.
 */
export async function createRankConfig(ctx: SeoContext, raw: z.input<typeof createRankConfigInput>): Promise<RankConfig> {
  assertCanRun(ctx, "configure rank tracking");
  const input = createRankConfigInput.parse(raw);
  const market = resolveMarket(input, ctx.market);
  if (!isSupportedLanguageCode(market.languageCode)) throw new SeoError("VALIDATION_ERROR", `Unsupported language '${market.languageCode}'.`);
  const locationName = input.locationName ?? null;
  const nextCheckAt = isScheduledInterval(input.scheduleInterval) ? computeNextCheckAt(input.scheduleInterval) : null;
  if (locationName) {
    await assertSerpLocationNameAccepted({ locationName, languageCode: market.languageCode, countryCode: getIsoCountryCode(market.locationCode) });
  }
  const [existing] = await db
    .select()
    .from(seoRankConfigs)
    .where(
      and(
        eq(seoRankConfigs.projectId, ctx.projectId),
        eq(seoRankConfigs.domain, input.domain),
        eq(seoRankConfigs.locationCode, market.locationCode),
        locationName ? eq(seoRankConfigs.locationName, locationName) : isNull(seoRankConfigs.locationName),
      ),
    )
    .limit(1);
  if (existing?.isActive) {
    throw new SeoError(
      "CONFLICT",
      locationName ? "This domain + city combination is already being tracked" : "This domain + country combination is already being tracked",
    );
  }
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(seoRankConfigs).where(eq(seoRankConfigs.projectId, ctx.projectId));
  if (Number(n) >= MAX_CONFIGS_PER_PROJECT) throw new SeoError("VALIDATION_ERROR", `Maximum ${MAX_CONFIGS_PER_PROJECT} tracked domains per project`);
  if (existing) {
    const [row] = await db
      .update(seoRankConfigs)
      .set({
        isActive: true,
        languageCode: market.languageCode,
        devices: input.devices,
        serpDepth: input.serpDepth,
        scheduleInterval: input.scheduleInterval,
        nextCheckAt,
        lastSkipReason: null,
      })
      .where(eq(seoRankConfigs.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await db
    .insert(seoRankConfigs)
    .values({
      projectId: ctx.projectId,
      domain: input.domain,
      ...market,
      locationName,
      devices: input.devices,
      serpDepth: input.serpDepth,
      scheduleInterval: input.scheduleInterval,
      nextCheckAt,
      createdBy: ctx.userId,
    })
    .returning();
  return row!;
}

export const updateRankConfigInput = z.object({
  configId: z.string().min(1),
  domain: domainField.optional(),
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().min(2).max(8).optional(),
  locationName: z.string().trim().min(1).max(300).nullable().optional(),
  devices: z.enum(["both", "desktop", "mobile"]).optional(),
  serpDepth: z.number().int().min(10).max(100).multipleOf(10).optional(),
  scheduleInterval: z.enum(["daily", "weekly", "monthly", "manual"]).optional(),
  isActive: z.boolean().optional(),
});

export async function updateRankConfig(ctx: SeoContext, raw: z.input<typeof updateRankConfigInput>): Promise<RankConfig> {
  assertCanRun(ctx, "configure rank tracking");
  const input = updateRankConfigInput.parse(raw);
  const existing = await getConfig(ctx, input.configId);
  const marketChanged = input.locationName !== undefined || input.locationCode !== undefined || input.languageCode !== undefined;
  if (marketChanged) {
    const locationName = input.locationName === undefined ? existing.locationName : input.locationName;
    if (locationName) {
      await assertSerpLocationNameAccepted({
        locationName,
        languageCode: input.languageCode ?? existing.languageCode,
        countryCode: getIsoCountryCode(input.locationCode ?? existing.locationCode),
      });
    }
  }
  const set: Partial<typeof seoRankConfigs.$inferInsert> = {};
  if (input.domain !== undefined) set.domain = input.domain;
  if (input.locationCode !== undefined) set.locationCode = input.locationCode;
  if (input.languageCode !== undefined) set.languageCode = input.languageCode;
  if (input.locationName !== undefined) set.locationName = input.locationName;
  if (input.devices !== undefined) set.devices = input.devices;
  if (input.serpDepth !== undefined) set.serpDepth = input.serpDepth;
  if (input.isActive !== undefined) set.isActive = input.isActive;
  if (input.scheduleInterval !== undefined) {
    set.scheduleInterval = input.scheduleInterval;
    set.nextCheckAt = isScheduledInterval(input.scheduleInterval) ? computeNextCheckAt(input.scheduleInterval) : null;
  }
  try {
    const [row] = await db.update(seoRankConfigs).set(set).where(and(eq(seoRankConfigs.id, existing.id), eq(seoRankConfigs.projectId, ctx.projectId))).returning();
    return row!;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505")
      throw new SeoError("CONFLICT", "This domain + location combination is already being tracked");
    throw err;
  }
}

/** Archive = isActive false (scheduled checks stop, history preserved). */
export async function archiveRankConfig(ctx: SeoContext, configId: string) {
  return updateRankConfig(ctx, { configId, isActive: false });
}

/* ───────────────────────────── Keywords ───────────────────────────── */

export async function getConfigKeywords(configId: string): Promise<RankKeyword[]> {
  return db.select().from(seoRankKeywords).where(eq(seoRankKeywords.configId, configId)).orderBy(asc(seoRankKeywords.createdAt));
}

export const addTrackingKeywordsInput = z.object({
  configId: z.string().min(1),
  keywords: z.array(z.string().max(MAX_TRACKED_KEYWORD_LENGTH, `Keywords must be ${MAX_TRACKED_KEYWORD_LENGTH} characters or fewer`)).min(1).max(2000),
  matchCase: z.boolean().default(false),
  /** UI: trigger a live subset check + metrics refresh for the new keywords (open-seo behaviour). */
  autoCheck: z.boolean().default(true),
  /** MCP: approve the recurring scheduled cost (USD per check) before adding. */
  maxScheduledCheckCostUsd: z.number().nonnegative().optional(),
});

export async function addTrackingKeywords(ctx: SeoContext, raw: z.input<typeof addTrackingKeywordsInput>) {
  assertCanRun(ctx, "add tracked keywords");
  const input = addTrackingKeywordsInput.parse(raw);
  const config = await getConfig(ctx, input.configId);
  const existing = await getConfigKeywords(config.id);
  if (existing.length >= MAX_KEYWORDS_PER_CONFIG) {
    throw new SeoError("VALIDATION_ERROR", `Maximum ${MAX_KEYWORDS_PER_CONFIG} keywords per domain. Currently tracking ${existing.length}.`);
  }
  const keywords = normalizeTrackedKeywords(input.keywords, existing.map((k) => k.keyword), input.matchCase, MAX_KEYWORDS_PER_CONFIG - existing.length);
  const scheduledEstimate =
    keywords.length && isScheduledInterval(config.scheduleInterval)
      ? estimateScheduledRankCheckCost(existing.length + keywords.length, config.devices, config.serpDepth, config.scheduleInterval)
      : undefined;
  if (input.maxScheduledCheckCostUsd != null && scheduledEstimate && scheduledEstimate.costUsd > input.maxScheduledCheckCostUsd) {
    throw new SeoError(
      "VALIDATION_ERROR",
      `Adding these keywords would make each ${scheduledEstimate.scheduleInterval} scheduled check cost ~$${scheduledEstimate.costUsd.toFixed(4)} (~$${scheduledEstimate.monthlyCostUsd.toFixed(2)}/month), above the approved $${input.maxScheduledCheckCostUsd}.`,
    );
  }
  const addedIds: string[] = [];
  for (let i = 0; i < keywords.length; i += 200) {
    const rows = await db
      .insert(seoRankKeywords)
      .values(keywords.slice(i, i + 200).map((keyword) => ({ configId: config.id, keyword, matchCase: input.matchCase })))
      .onConflictDoNothing()
      .returning({ id: seoRankKeywords.id });
    addedIds.push(...rows.map((r) => r.id));
  }
  let checkTriggered = false;
  let metricsJobId: string | null = null;
  if (addedIds.length && input.autoCheck) {
    try {
      const r = await triggerRankCheck(ctx, { configId: config.id, keywordIds: addedIds });
      checkTriggered = r.ok;
    } catch (err) {
      console.warn("[seo] auto subset check failed", err instanceof Error ? err.message : err);
    }
    try {
      metricsJobId = (await enqueueTrackingKeywordMetricsRefresh(ctx, config.id)).jobId;
    } catch (err) {
      console.warn("[seo] metrics refresh enqueue failed", err instanceof Error ? err.message : err);
    }
  }
  return { added: addedIds.length, addedIds, scheduledEstimate, checkTriggered, metricsJobId };
}

export async function removeTrackingKeywords(ctx: SeoContext, input: { configId: string; keywordIds: string[] }) {
  assertCanRun(ctx, "remove tracked keywords");
  const config = await getConfig(ctx, input.configId);
  const ids = [...new Set(z.array(z.string()).min(1).max(2000).parse(input.keywordIds))];
  const removed: string[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .delete(seoRankKeywords)
      .where(and(eq(seoRankKeywords.configId, config.id), inArray(seoRankKeywords.id, ids.slice(i, i + 500))))
      .returning({ id: seoRankKeywords.id });
    removed.push(...rows.map((r) => r.id));
  }
  return { removed: removed.length, removedIds: removed };
}

/* ───────────────────────────── Cost estimation ───────────────────────────── */

export async function estimateRankTrackerCost(ctx: SeoContext, configId: string, additionalKeywordCount = 0) {
  const config = await getConfig(ctx, configId);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(seoRankKeywords).where(eq(seoRankKeywords.configId, configId));
  const existingKeywordCount = Number(n);
  const keywordCount = Math.max(existingKeywordCount, Math.min(MAX_KEYWORDS_PER_CONFIG, existingKeywordCount + additionalKeywordCount));
  const { costUsd } = estimateRankCheckCost(keywordCount, config.devices, config.serpDepth, "live");
  return {
    costUsd,
    keywordCount,
    devicesCount: devicesCount(config.devices),
    totalChecks: keywordCount * devicesCount(config.devices),
    method: "live" as const,
    existingKeywordCount,
    additionalKeywordCount: keywordCount - existingKeywordCount,
    scheduledEstimate: isScheduledInterval(config.scheduleInterval)
      ? estimateScheduledRankCheckCost(keywordCount, config.devices, config.serpDepth, config.scheduleInterval)
      : undefined,
  };
}

/* ───────────────────────────── Runs (coordination) ───────────────────────────── */

const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

/** A run is stale when its current job is gone/finished and the startup grace passed (job id = workflow id analogue). */
export async function staleReasonForRun(run: RankRun): Promise<string | null> {
  if (run.status !== "pending" && run.status !== "running") return null;
  const job = run.jobId ? (await db.select({ status: jobs.status, lastError: jobs.lastError }).from(jobs).where(eq(jobs.id, run.jobId)).limit(1))[0] : undefined;
  if (job && ACTIVE_JOB_STATUSES.has(job.status)) return null;
  const age = Date.now() - new Date(run.startedAt).getTime();
  if (age < RANK_CHECK_STARTUP_GRACE_MS) return null;
  if (!job) return "Background job was not found";
  if (job.status === "failed") return job.lastError ?? "Background job failed";
  if (job.status === "cancelled") return "Background job was cancelled";
  return "Background job finished without finalizing the run";
}

export async function failRunIfActive(runId: string, reason: string) {
  await db
    .update(seoRankRuns)
    .set({ status: "failed", errorMessage: reason, completedAt: new Date() })
    .where(and(eq(seoRankRuns.id, runId), inArray(seoRankRuns.status, ["pending", "running"])));
}

export type RankCheckTriggerResult = { ok: true; runId: string } | { ok: false; reason: "already_running"; blockingRunId: string | null };

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * Inserts the run row (partial unique index = one active run per config); a blocked insert inspects the blocker,
 * fails it when stale and retries once, else reports already_running. The job id is stored on the run.
 */
export async function beginRankCheckRun(input: {
  config: RankConfig;
  trigger: "manual" | "scheduled";
  keywordIds?: string[];
  keywordsTotal: number;
  userId: string | null;
  workspaceId: string;
}): Promise<RankCheckTriggerResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let run: RankRun | undefined;
    try {
      [run] = await db
        .insert(seoRankRuns)
        .values({
          configId: input.config.id,
          projectId: input.config.projectId,
          trigger: input.trigger,
          method: input.trigger === "scheduled" ? "queued" : "live",
          keywordsTotal: input.keywordsTotal,
          isSubsetRun: (input.keywordIds?.length ?? 0) > 0,
          keywordIds: input.keywordIds?.length ? input.keywordIds : null,
        })
        .returning();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    if (run) {
      try {
        const job = await enqueueJob(
          RANK_CHECK_JOB,
          { runId: run.id },
          { projectId: input.config.projectId, workspaceId: input.workspaceId, createdBy: input.userId, maxAttempts: 1, priority: input.trigger === "manual" ? 50 : 100 },
        );
        await db.update(seoRankRuns).set({ jobId: job?.id ?? null }).where(eq(seoRankRuns.id, run.id));
      } catch (err) {
        await failRunIfActive(run.id, "Failed to start rank check job");
        throw err;
      }
      return { ok: true, runId: run.id };
    }
    const [blocker] = await db
      .select()
      .from(seoRankRuns)
      .where(and(eq(seoRankRuns.configId, input.config.id), inArray(seoRankRuns.status, ["pending", "running"])))
      .limit(1);
    if (!blocker) continue;
    if (attempt === 0) {
      const stale = await staleReasonForRun(blocker);
      if (stale) {
        await failRunIfActive(blocker.id, stale);
        continue;
      }
    }
    return { ok: false, reason: "already_running", blockingRunId: blocker.id };
  }
  const [final] = await db
    .select({ id: seoRankRuns.id })
    .from(seoRankRuns)
    .where(and(eq(seoRankRuns.configId, input.config.id), inArray(seoRankRuns.status, ["pending", "running"])))
    .limit(1);
  return { ok: false, reason: "already_running", blockingRunId: final?.id ?? null };
}

export const triggerRankCheckInput = z.object({
  configId: z.string().min(1),
  keywordIds: z.array(z.string()).max(2000).optional(),
  /** MCP approval ceiling (USD, live estimate). */
  maxCostUsd: z.number().nonnegative().optional(),
});

/** Manual check → live SERP endpoint (instant); returns already_running when a run is in flight. */
export async function triggerRankCheck(ctx: SeoContext, raw: z.input<typeof triggerRankCheckInput>): Promise<RankCheckTriggerResult> {
  assertCanRun(ctx, "run rank checks");
  const input = triggerRankCheckInput.parse(raw);
  const config = await getConfig(ctx, input.configId);
  if (!config.isActive) throw new SeoError("VALIDATION_ERROR", "This domain is archived.");
  const keywords = await getConfigKeywords(config.id);
  if (!keywords.length) throw new SeoError("VALIDATION_ERROR", "No keywords to track. Add keywords to this domain first.");
  const count = input.keywordIds?.length ? keywords.filter((k) => input.keywordIds!.includes(k.id)).length : keywords.length;
  if (input.maxCostUsd != null) {
    const { costUsd } = estimateRankCheckCost(count, config.devices, config.serpDepth, "live");
    if (costUsd > input.maxCostUsd) {
      throw new SeoError("VALIDATION_ERROR", `The current rank check costs ~$${costUsd.toFixed(4)}, above the approved maximum of $${input.maxCostUsd}.`);
    }
  }
  return beginRankCheckRun({ config, trigger: "manual", keywordIds: input.keywordIds, keywordsTotal: count, userId: ctx.userId, workspaceId: ctx.workspaceId });
}

export type RankRunView = {
  id: string;
  status: RankRun["status"];
  trigger: RankRun["trigger"];
  method: RankRun["method"];
  phase: string;
  /** Queued runs: collection round (0-5, ≈15 min window). */
  collectRound: number;
  keywordsTotal: number;
  keywordsChecked: number;
  isSubsetRun: boolean;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  costUsd: number;
  maybeStale: boolean;
  staleReason: string | null;
};

function toRunView(run: RankRun, staleReason: string | null): RankRunView {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    method: run.method,
    phase: run.phase,
    collectRound: run.collectRound,
    keywordsTotal: run.keywordsTotal,
    keywordsChecked: run.keywordsChecked,
    isSubsetRun: run.isSubsetRun,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    costUsd: run.costUsd,
    maybeStale: staleReason != null,
    staleReason,
  };
}

/** Reports staleness without mutating (the next begin marks a stale blocker failed). */
export async function getLatestRankRun(ctx: SeoContext, configId: string): Promise<RankRunView | null> {
  await getConfig(ctx, configId);
  const [run] = await db.select().from(seoRankRuns).where(eq(seoRankRuns.configId, configId)).orderBy(desc(seoRankRuns.startedAt)).limit(1);
  if (!run) return null;
  return toRunView(run, await staleReasonForRun(run));
}

/* ───────────────────────────── Reads ───────────────────────────── */

type SnapshotRow = {
  tracking_keyword_id: string;
  device: "desktop" | "mobile";
  position: number | null;
  url: string | null;
  serp_features: string[] | null;
  checked_at: Date | string;
};

async function snapshotsPerKeywordDevice(configId: string, opts: { before?: Date; order: "latest" | "earliest"; keywordIds?: string[] }) {
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (s.tracking_keyword_id, s.device)
      s.tracking_keyword_id, s.device, s.position, s.url, s.serp_features, s.checked_at
    FROM ${seoRankSnapshots} s
    JOIN ${seoRankRuns} r ON r.id = s.run_id
    WHERE r.config_id = ${configId} AND r.status = 'completed'
      ${opts.before ? sql`AND s.checked_at <= ${opts.before.toISOString()}::timestamptz` : sql``}
      ${opts.keywordIds?.length ? sql`AND s.tracking_keyword_id IN (${sql.join(opts.keywordIds.map((id) => sql`${id}`), sql`, `)})` : sql``}
    ORDER BY s.tracking_keyword_id, s.device, s.checked_at ${opts.order === "latest" ? sql`DESC` : sql`ASC`}`);
  return rows as unknown as SnapshotRow[];
}

export type RankDeviceResult = { position: number | null; previousPosition: number | null; rankingUrl: string | null; serpFeatures: string[] };
export type RankTrackingRow = {
  trackingKeywordId: string;
  keyword: string;
  matchCase: boolean;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  cpc: number | null;
  metricsFetchedAt: Date | null;
  desktop: RankDeviceResult;
  mobile: RankDeviceResult;
};

/**
 * Latest snapshot per keyword+device (completed runs incl. subset runs); previous = latest snapshot before
 * now − period, falling back to the earliest snapshot. Rows for every active keyword.
 */
export async function getRankTrackingResults(ctx: SeoContext, configId: string, comparePeriod: ComparePeriod = "7d") {
  const config = await getConfig(ctx, configId);
  const target = new Date(Date.now() - COMPARE_PERIOD_DAYS[comparePeriod] * 86_400_000);
  const [keywords, current, comparison, latestRun] = await Promise.all([
    getConfigKeywords(config.id),
    snapshotsPerKeywordDevice(config.id, { order: "latest" }),
    snapshotsPerKeywordDevice(config.id, { order: "latest", before: target }),
    db.select().from(seoRankRuns).where(eq(seoRankRuns.configId, config.id)).orderBy(desc(seoRankRuns.startedAt)).limit(1),
  ]);
  const previous = new Map<string, number | null>();
  for (const s of comparison) previous.set(`${s.tracking_keyword_id}:${s.device}`, s.position);
  const missing = [...new Set(current.filter((s) => !previous.has(`${s.tracking_keyword_id}:${s.device}`)).map((s) => s.tracking_keyword_id))];
  if (missing.length) {
    for (let i = 0; i < missing.length; i += 500) {
      const earliest = await snapshotsPerKeywordDevice(config.id, { order: "earliest", keywordIds: missing.slice(i, i + 500) });
      for (const s of earliest) {
        const k = `${s.tracking_keyword_id}:${s.device}`;
        if (!previous.has(k)) previous.set(k, s.position);
      }
    }
  }
  const empty = (prev: number | null): RankDeviceResult => ({ position: null, previousPosition: prev, rankingUrl: null, serpFeatures: [] });
  const rows = new Map<string, RankTrackingRow>(
    keywords.map((k) => [
      k.id,
      {
        trackingKeywordId: k.id,
        keyword: k.keyword,
        matchCase: k.matchCase,
        searchVolume: k.searchVolume,
        keywordDifficulty: k.keywordDifficulty,
        cpc: k.cpc,
        metricsFetchedAt: k.metricsFetchedAt,
        desktop: empty(previous.get(`${k.id}:desktop`) ?? null),
        mobile: empty(previous.get(`${k.id}:mobile`) ?? null),
      },
    ]),
  );
  let lastCheckedAt: Date | null = null;
  for (const s of current) {
    const row = rows.get(s.tracking_keyword_id);
    if (!row) continue;
    row[s.device] = {
      position: s.position,
      previousPosition: previous.get(`${s.tracking_keyword_id}:${s.device}`) ?? null,
      rankingUrl: s.url,
      serpFeatures: Array.isArray(s.serp_features) ? s.serp_features : [],
    };
    const at = new Date(s.checked_at);
    if (!lastCheckedAt || at > lastCheckedAt) lastCheckedAt = at;
  }
  const run = latestRun[0];
  return {
    config,
    rows: [...rows.values()],
    run: run ? { ...toRunView(run, null), lastCheckedAt } : null,
  };
}

/** Flat position series across completed runs (oldest first); null = not found within depth. */
export async function getRankKeywordHistory(ctx: SeoContext, input: { configId: string; trackingKeywordId: string; sinceDays?: number }) {
  const config = await getConfig(ctx, input.configId);
  const since = new Date(Date.now() - Math.min(730, input.sinceDays ?? 365) * 86_400_000);
  return db
    .select({ device: seoRankSnapshots.device, checkedAt: seoRankSnapshots.checkedAt, position: seoRankSnapshots.position })
    .from(seoRankSnapshots)
    .innerJoin(seoRankRuns, eq(seoRankRuns.id, seoRankSnapshots.runId))
    .where(
      and(
        eq(seoRankRuns.configId, config.id),
        eq(seoRankRuns.status, "completed"),
        eq(seoRankSnapshots.trackingKeywordId, input.trackingKeywordId),
        gte(seoRankSnapshots.checkedAt, since),
      ),
    )
    .orderBy(asc(seoRankSnapshots.checkedAt));
}

/** Position distribution per completed full run for one device (x = run startedAt). */
export async function getRankConfigTrend(ctx: SeoContext, input: { configId: string; device: "desktop" | "mobile"; sinceDays?: number }) {
  const config = await getConfig(ctx, input.configId);
  const since = new Date(Date.now() - Math.min(730, input.sinceDays ?? 730) * 86_400_000);
  const rows = await db
    .select({
      runId: seoRankSnapshots.runId,
      checkedAt: seoRankRuns.startedAt,
      total: sql<number>`count(*)::int`,
      top3: sql<number>`sum(case when ${seoRankSnapshots.position} between 1 and 3 then 1 else 0 end)::int`,
      top4to10: sql<number>`sum(case when ${seoRankSnapshots.position} between 4 and 10 then 1 else 0 end)::int`,
      top11to20: sql<number>`sum(case when ${seoRankSnapshots.position} between 11 and 20 then 1 else 0 end)::int`,
    })
    .from(seoRankSnapshots)
    .innerJoin(seoRankRuns, eq(seoRankSnapshots.runId, seoRankRuns.id))
    .where(
      and(
        eq(seoRankRuns.configId, config.id),
        eq(seoRankRuns.status, "completed"),
        eq(seoRankRuns.isSubsetRun, false),
        eq(seoRankSnapshots.device, input.device),
        gte(seoRankSnapshots.checkedAt, since),
      ),
    )
    .groupBy(seoRankSnapshots.runId, seoRankRuns.startedAt)
    .orderBy(asc(seoRankRuns.startedAt));
  return rows.map((r) => {
    const total = Number(r.total);
    const top3 = Number(r.top3);
    const top4to10 = Number(r.top4to10);
    const top11to20 = Number(r.top11to20);
    return { runId: r.runId, checkedAt: r.checkedAt, total, top3, top4to10, top11to20, notRanking: total - top3 - top4to10 - top11to20 };
  });
}

/** Last `runLimit` (≤26) completed full runs × keyword positions for the history matrix. */
export async function getRankPositionMatrix(ctx: SeoContext, input: { configId: string; device: "desktop" | "mobile"; runLimit?: number }) {
  const config = await getConfig(ctx, input.configId);
  const limit = Math.min(26, Math.max(1, input.runLimit ?? 12));
  const runs = await db
    .select({ id: seoRankRuns.id, startedAt: seoRankRuns.startedAt })
    .from(seoRankRuns)
    .where(and(eq(seoRankRuns.configId, config.id), eq(seoRankRuns.status, "completed"), eq(seoRankRuns.isSubsetRun, false)))
    .orderBy(desc(seoRankRuns.startedAt))
    .limit(limit);
  if (!runs.length) return { runs: [], cells: [] };
  const cells = await db
    .select({ runId: seoRankSnapshots.runId, trackingKeywordId: seoRankSnapshots.trackingKeywordId, position: seoRankSnapshots.position })
    .from(seoRankSnapshots)
    .where(and(inArray(seoRankSnapshots.runId, runs.map((r) => r.id)), eq(seoRankSnapshots.device, input.device)));
  return { runs: [...runs].reverse(), cells };
}

/* ───────────────────────────── Keyword metrics refresh (job) ───────────────────────────── */

export async function enqueueTrackingKeywordMetricsRefresh(ctx: SeoContext, configId: string) {
  assertCanRun(ctx, "refresh keyword metrics");
  const config = await getConfig(ctx, configId);
  const dedupeKey = `${RANK_METRICS_JOB}:${config.id}`;
  const job = await enqueueJob(
    RANK_METRICS_JOB,
    { configId: config.id, projectId: ctx.projectId, userId: ctx.userId },
    { dedupeKey, projectId: ctx.projectId, workspaceId: ctx.workspaceId, createdBy: ctx.userId, maxAttempts: 1 },
  );
  if (job) return { jobId: job.id, alreadyRunning: false };
  const [active] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.dedupeKey, dedupeKey)).limit(1);
  return { jobId: active?.id ?? null, alreadyRunning: true };
}

/* ───────────────────────────── Keyword suggestions (Labs countries only) ───────────────────────────── */

export async function getTrackerKeywordSuggestions(ctx: SeoContext, configId: string) {
  const config = await getConfig(ctx, configId);
  if (!isLabsLocationCode(config.locationCode)) return { available: false as const, keywords: [] };
  const keywords = await getDomainKeywordSuggestions(ctx, { domain: config.domain, locationCode: config.locationCode });
  return { available: true as const, keywords };
}

/* ───────────────────────────── SERP locations (local targeting) ───────────────────────────── */

const memo = new Map<string, { at: number; list: SerpLocation[] }>();
const inflight = new Map<string, Promise<SerpLocation[]>>();
const MEMO_MS = 60 * 60_000;

/** Free `GET /v3/serp/google/locations/{iso}` filtered to City/County/Municipality/DMA Region/Region; cached 30 days. */
export async function getSerpLocationsForCountry(ctx: Pick<SeoContext, "projectId">, countryCode: string): Promise<SerpLocation[]> {
  const iso = countryCode.toLowerCase();
  if (!/^[a-z]{2}$/.test(iso)) throw new SeoError("VALIDATION_ERROR", "Invalid country code");
  const hot = memo.get(iso);
  if (hot && Date.now() - hot.at < MEMO_MS) return hot.list;
  const cached = await cacheGet<SerpLocation[]>(`serp-locations:${iso}`);
  if (cached) {
    memo.set(iso, { at: Date.now(), list: cached.value });
    return cached.value;
  }
  const pending = inflight.get(iso);
  if (pending) return pending;
  const fill = (async () => {
    const task = await dfsGetTask<{ location_code?: number; location_name?: string; location_type?: string | null }>(
      ctx,
      `/v3/serp/google/locations/${encodeURIComponent(iso)}`,
      "rank_tracking",
    );
    if (task.status_code !== 20000) throw new SeoError("UPSTREAM", task.status_message || "Could not load locations");
    const list = slimLocationRegistry(task.result ?? []);
    await cacheSet(`serp-locations:${iso}`, "serp-locations", null, list, CACHE_TTL.serpLocations);
    memo.set(iso, { at: Date.now(), list });
    return list;
  })().finally(() => inflight.delete(iso));
  inflight.set(iso, fill);
  return fill;
}

export async function searchSerpLocations(ctx: Pick<SeoContext, "projectId">, input: { query: string; countryCode: string }) {
  const q = z.string().trim().min(1).max(100).parse(input.query);
  const list = await getSerpLocationsForCountry(ctx, input.countryCode);
  return rankSerpLocations(q, list, input.countryCode);
}

/** Warm the registry when the user switches targeting to Local. */
export async function prewarmSerpLocations(ctx: Pick<SeoContext, "projectId">, countryCode: string) {
  await getSerpLocationsForCountry(ctx, countryCode);
  return { ok: true };
}

/* ───────────────────────────── Due configs (scheduler) ───────────────────────────── */

export async function getDueRankConfigs(now: Date, limit = 500) {
  return db
    .select()
    .from(seoRankConfigs)
    .where(
      and(
        eq(seoRankConfigs.isActive, true),
        sql`${seoRankConfigs.scheduleInterval} <> 'manual'`,
        lte(seoRankConfigs.nextCheckAt, now),
        sql`exists (select 1 from projects p where p.id = ${seoRankConfigs.projectId} and p.archived = false)`,
      ),
    )
    .orderBy(asc(seoRankConfigs.nextCheckAt), asc(seoRankConfigs.id))
    .limit(limit);
}

export type { RankDevices, ScheduleInterval };
