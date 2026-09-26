import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projects, seoRankConfigs, seoRankKeywords, seoRankRuns, seoRankSnapshots, seoRankTasks } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { assertBudget, BudgetExceededError } from "@/server/usage";
import { SeoError, systemSeoContext, type SeoContext } from "./context";
import { dfsGetTask, dfsLive, dfsTaskPost, isDataForSeoConfigured } from "./dfs";
import {
  beginRankCheckRun,
  failRunIfActive,
  getDueRankConfigs,
  RANK_CHECK_JOB,
  RANK_COLLECT_JOB,
  staleReasonForRun,
  type RankConfig,
  type RankRun,
} from "./rank-tracking";
import {
  computeNextCheckAt,
  costPerSerpAtDepth,
  devicesCount,
  devicesList,
  estimateRankCheckCost,
  isScheduledInterval,
  KEYWORDS_PER_BATCH,
  MAX_TASKS_PER_POST,
  QUEUED_POLL_INTERVALS_MIN,
  SCHEDULED_TASK_UNIT_BUDGET,
  TASK_GET_CONCURRENCY,
  TASK_GETS_PER_COLLECT,
  TICK_DEADLINE_MS,
} from "./lib/rank-tracking";
import {
  buildRankCheckResult,
  buildRankCheckTask,
  buildRankCheckTaskPostBody,
  isNoResultsMessage,
  rankTaskTag,
  SERP_LIVE_PATH,
  SERP_TASK_POST_PATH,
  SERP_TASKS_READY_PATH,
  serpTaskGetPath,
  TASK_IN_PROGRESS_STATUS_CODES,
  type Device,
  type RankCheckResult,
  type SerpLiveItem,
} from "./lib/serp";
import { fetchKeywordMetricsForList } from "./keywords";
import { resolveKeywordDataLanguage } from "./lib/locations";

/** One job invocation works for at most this long, then re-enqueues itself (keeps jobs well below the worker timeout). */
const SLICE_MS = 4 * 60_000;

type KeywordEntry = { id: string; keyword: string };
type Pair = { keywordId: string; keyword: string; device: Device };

async function loadRun(runId: string): Promise<RankRun | null> {
  const [run] = await db.select().from(seoRankRuns).where(eq(seoRankRuns.id, runId)).limit(1);
  return run ?? null;
}

async function loadRunContext(run: RankRun): Promise<{ config: RankConfig; ctx: SeoContext } | null> {
  const [row] = await db
    .select({ config: seoRankConfigs, project: projects })
    .from(seoRankConfigs)
    .innerJoin(projects, eq(projects.id, seoRankConfigs.projectId))
    .where(eq(seoRankConfigs.id, run.configId))
    .limit(1);
  if (!row) return null;
  return { config: row.config, ctx: systemSeoContext(row.project) };
}

async function updateRun(runId: string, set: Partial<typeof seoRankRuns.$inferInsert>) {
  await db.update(seoRankRuns).set(set).where(eq(seoRankRuns.id, runId));
}

async function setRunErrorIfEmpty(runId: string, message: string) {
  await db.update(seoRankRuns).set({ errorMessage: message }).where(and(eq(seoRankRuns.id, runId), isNull(seoRankRuns.errorMessage)));
}

async function addRunCost(runId: string, usd: number) {
  if (usd > 0) await db.update(seoRankRuns).set({ costUsd: sql`${seoRankRuns.costUsd} + ${usd}` }).where(eq(seoRankRuns.id, runId));
}

async function insertSnapshots(runId: string, results: (RankCheckResult & { device: Device })[]) {
  if (!results.length) return;
  await db
    .insert(seoRankSnapshots)
    .values(
      results.map((r) => ({
        runId,
        trackingKeywordId: r.keywordId,
        keyword: r.keyword,
        device: r.device,
        position: r.position,
        url: r.url,
        serpFeatures: r.serpFeatures,
      })),
    )
    .onConflictDoNothing();
}

async function refreshProgress(runId: string) {
  const [{ n } = { n: 0 }] = (await db.execute(
    sql`SELECT count(DISTINCT tracking_keyword_id)::int AS n FROM ${seoRankSnapshots} WHERE run_id = ${runId}`,
  )) as unknown as { n: number }[];
  await updateRun(runId, { keywordsChecked: Number(n) });
}

async function enqueueContinuation(run: RankRun, type: string, delayMs = 0) {
  const job = await enqueueJob(type, { runId: run.id }, { runAt: new Date(Date.now() + delayMs), projectId: run.projectId, maxAttempts: type === RANK_COLLECT_JOB ? 3 : 1 });
  await updateRun(run.id, { jobId: job?.id ?? null });
}

/* ───────────────────────────── Live checks ───────────────────────────── */

async function checkPairsLive(ctx: SeoContext, run: RankRun, config: RankConfig, pairs: Pair[]): Promise<number> {
  const settled = await Promise.allSettled(
    pairs.map(async (p) => {
      const task = await dfsLive<{ items?: SerpLiveItem[] | null }>(
        ctx,
        SERP_LIVE_PATH,
        buildRankCheckTask({
          keyword: p.keyword,
          locationCode: config.locationCode,
          languageCode: config.languageCode,
          locationName: config.locationName,
          device: p.device,
          targetDomain: config.domain,
          depth: config.serpDepth,
        }),
        // Billed → no 5xx retries; "No Search Results" (40501) is a valid empty SERP.
        { feature: "rank_tracking", treatNoResultsAsEmpty: true, retry5xx: false, estimatedCostUsd: costPerSerpAtDepth(config.serpDepth, "live") },
      );
      await addRunCost(run.id, task.cost);
      return { ...buildRankCheckResult({ keywordId: p.keywordId, keyword: p.keyword, targetDomain: config.domain }, task.result[0]?.items ?? []), device: p.device };
    }),
  );
  const results: (RankCheckResult & { device: Device })[] = [];
  let firstError: string | null = null;
  settled.forEach((o, i) => {
    if (o.status === "fulfilled") results.push(o.value);
    else {
      const msg = o.reason instanceof Error ? o.reason.message : String(o.reason);
      firstError ??= msg;
      console.warn(`[rank-check] ${run.id} live call failed keyword="${pairs[i]!.keyword}" device=${pairs[i]!.device}: ${msg}`);
      if (o.reason instanceof SeoError && ["NOT_CONFIGURED", "AUTH_FAILED", "INSUFFICIENT_FUNDS", "BUDGET"].includes(o.reason.code)) {
        throw o.reason;
      }
    }
  });
  if (firstError) await setRunErrorIfEmpty(run.id, firstError);
  await insertSnapshots(run.id, results);
  return results.length;
}

async function runKeywords(run: RankRun): Promise<KeywordEntry[]> {
  const rows = await db
    .select({ id: seoRankKeywords.id, keyword: seoRankKeywords.keyword })
    .from(seoRankKeywords)
    .where(eq(seoRankKeywords.configId, run.configId))
    .orderBy(asc(seoRankKeywords.createdAt), asc(seoRankKeywords.id));
  if (run.keywordIds?.length) {
    const ids = new Set(run.keywordIds);
    return rows.filter((r) => ids.has(r.id));
  }
  return rows;
}

function expand(keywords: KeywordEntry[], devices: RankConfig["devices"]): Pair[] {
  return keywords.flatMap((k) => devicesList(devices).map((device) => ({ keywordId: k.id, keyword: k.keyword, device })));
}

/* ───────────────────────────── Phases ───────────────────────────── */

async function phasePrepare(run: RankRun, config: RankConfig): Promise<RankRun | null> {
  if (!config.isActive) {
    await failRunIfActive(run.id, "Config has been archived");
    return null;
  }
  const keywords = await runKeywords(run);
  if (!keywords.length) {
    await failRunIfActive(run.id, "No keywords to track");
    return null;
  }
  const { costUsd } = estimateRankCheckCost(keywords.length, config.devices, config.serpDepth, run.method);
  await assertBudget(costUsd);
  const next = { status: "running" as const, keywordsTotal: keywords.length, phase: run.method === "queued" ? "post" : "live" };
  await updateRun(run.id, next);
  return { ...run, ...next };
}

/** Batches of 10 keywords × devices. Cursor is claimed BEFORE a batch runs so a crash never re-bills it. */
async function phaseLive(ctx: SeoContext, run: RankRun, config: RankConfig, deadline: number): Promise<"done" | "continue"> {
  const keywords = await runKeywords(run);
  let stats = { ...(run.stats ?? {}) };
  let cursor = stats.liveCursor ?? 0;
  while (cursor < keywords.length) {
    if (Date.now() > deadline) return "continue";
    const batch = keywords.slice(cursor, cursor + KEYWORDS_PER_BATCH);
    cursor += batch.length;
    stats = { ...stats, liveCursor: cursor };
    await updateRun(run.id, { stats });
    await checkPairsLive(ctx, run, config, expand(batch, config.devices));
    await updateRun(run.id, { keywordsChecked: Math.min(cursor, keywords.length) });
  }
  return "done";
}

/** task_post in chunks of ≤100 pairs; rows are claimed before posting; rejected / failed chunks → live fallback. */
async function phasePost(ctx: SeoContext, run: RankRun, config: RankConfig) {
  const keywords = await runKeywords(run);
  const pairs = expand(keywords, config.devices);
  const existing = await db
    .select({ trackingKeywordId: seoRankTasks.trackingKeywordId, device: seoRankTasks.device })
    .from(seoRankTasks)
    .where(eq(seoRankTasks.runId, run.id));
  const done = new Set(existing.map((e) => rankTaskTag(e.trackingKeywordId, e.device)));
  const todo = pairs.filter((p) => !done.has(rankTaskTag(p.keywordId, p.device)));
  let queued = 0;
  for (let i = 0; i < todo.length; i += MAX_TASKS_PER_POST) {
    const chunk = todo.slice(i, i + MAX_TASKS_PER_POST);
    await db
      .insert(seoRankTasks)
      .values(chunk.map((p) => ({ runId: run.id, trackingKeywordId: p.keywordId, keyword: p.keyword, device: p.device, status: "pending" as const })))
      .onConflictDoNothing();
    try {
      const { costUsd } = estimateRankCheckCost(chunk.length, "desktop", config.serpDepth, "queued");
      const res = await dfsTaskPost(
        ctx,
        SERP_TASK_POST_PATH,
        buildRankCheckTaskPostBody({
          tasks: chunk.map((p) => ({ keyword: p.keyword, keywordId: p.keywordId, device: p.device })),
          locationCode: config.locationCode,
          languageCode: config.languageCode,
          locationName: config.locationName,
          depth: config.serpDepth,
          targetDomain: config.domain,
        }),
        "rank_tracking",
        costUsd,
      );
      await addRunCost(run.id, res.cost);
      if (res.statusCode !== 20000) throw new Error(res.statusMessage || "DataForSEO task_post failed");
      const accepted = new Map<string, string>();
      for (const entry of res.tasks) {
        const tag = typeof entry.data?.tag === "string" ? entry.data.tag : null;
        if (entry.status_code === 20100 && entry.id && tag) accepted.set(tag, entry.id);
        else console.warn(`[rank-check] ${run.id} task_post rejected entry (${entry.status_code}): ${entry.status_message}`);
      }
      for (const p of chunk) {
        const id = accepted.get(rankTaskTag(p.keywordId, p.device));
        await db
          .update(seoRankTasks)
          .set(id ? { taskId: id } : { status: "fallback", message: "Rejected by task_post" })
          .where(and(eq(seoRankTasks.runId, run.id), eq(seoRankTasks.trackingKeywordId, p.keywordId), eq(seoRankTasks.device, p.device)));
        if (id) queued++;
      }
    } catch (err) {
      if (err instanceof SeoError && ["NOT_CONFIGURED", "AUTH_FAILED", "INSUFFICIENT_FUNDS", "BUDGET"].includes(err.code)) throw err;
      // Never re-post a billed chunk: its pairs go to the live fallback.
      console.warn(`[rank-check] ${run.id} task_post chunk failed:`, err instanceof Error ? err.message : err);
      await setRunErrorIfEmpty(run.id, err instanceof Error ? err.message : String(err));
      await db
        .update(seoRankTasks)
        .set({ status: "fallback", message: "task_post failed" })
        .where(
          and(
            eq(seoRankTasks.runId, run.id),
            isNull(seoRankTasks.taskId),
            eq(seoRankTasks.status, "pending"),
            inArray(
              seoRankTasks.trackingKeywordId,
              chunk.map((p) => p.keywordId),
            ),
          ),
        );
    }
  }
  const stats = { ...(run.stats ?? {}), queueTasks: (run.stats?.queueTasks ?? 0) + queued };
  await updateRun(run.id, { phase: "collect", collectRound: 0, stats });
  await enqueueContinuation({ ...run, stats }, RANK_COLLECT_JOB, QUEUED_POLL_INTERVALS_MIN[0] * 60_000);
}

type TaskOutcome = { status: "pending" } | { status: "failed"; message: string } | { status: "completed"; items: SerpLiveItem[] };

async function fetchTaskOutcome(ctx: SeoContext, taskId: string): Promise<TaskOutcome> {
  const task = await dfsGetTask<{ items?: SerpLiveItem[] | null }>(ctx, serpTaskGetPath(taskId), "rank_tracking");
  if (TASK_IN_PROGRESS_STATUS_CODES.has(task.status_code)) return { status: "pending" };
  if (task.status_code !== 20000) {
    if (isNoResultsMessage(task.status_message)) return { status: "completed", items: [] };
    return { status: "failed", message: task.status_message || `DataForSEO task failed (${task.status_code})` };
  }
  return { status: "completed", items: task.result?.[0]?.items ?? [] };
}

/** tasks_ready (free) narrows which pending tasks are worth a task_get; falls back to task_get on all when unavailable. */
async function readyTaskIds(ctx: SeoContext): Promise<Set<string> | null> {
  try {
    const task = await dfsGetTask<{ id?: string }>(ctx, SERP_TASKS_READY_PATH, "rank_tracking");
    const ids = (task.result ?? []).map((r) => r?.id).filter((id): id is string => Boolean(id));
    // tasks_ready returns ≤1000 entries; when capped we can't trust absence.
    return ids.length >= 1000 ? null : new Set(ids);
  } catch (err) {
    console.warn("[rank-check] tasks_ready failed", err instanceof Error ? err.message : err);
    return null;
  }
}

/** One collect round (free task_gets). Schedules the next round, or routes stragglers to the live fallback. */
export async function collectQueuedRound(runId: string) {
  const run = await loadRun(runId);
  if (!run || run.status === "completed" || run.status === "failed" || run.phase !== "collect") return { skipped: true };
  const loaded = await loadRunContext(run);
  if (!loaded) return failRunIfActive(run.id, "Config not found");
  const { ctx, config } = loaded;
  const round = run.collectRound;
  const finalRound = round >= QUEUED_POLL_INTERVALS_MIN.length - 1;
  const pending = await db
    .select()
    .from(seoRankTasks)
    .where(and(eq(seoRankTasks.runId, run.id), eq(seoRankTasks.status, "pending"), sql`${seoRankTasks.taskId} IS NOT NULL`))
    .orderBy(asc(seoRankTasks.id))
    .limit(TASK_GETS_PER_COLLECT);
  const ready = finalRound ? null : await readyTaskIds(ctx);
  const toFetch = ready ? pending.filter((t) => ready.has(t.taskId!)) : pending;
  let collected = 0;
  for (let i = 0; i < toFetch.length; i += TASK_GET_CONCURRENCY) {
    const chunk = toFetch.slice(i, i + TASK_GET_CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map((t) => fetchTaskOutcome(ctx, t.taskId!)));
    const results: (RankCheckResult & { device: Device })[] = [];
    for (let j = 0; j < chunk.length; j++) {
      const t = chunk[j]!;
      const o = settled[j]!;
      if (o.status === "rejected" || o.value.status === "pending") continue;
      if (o.value.status === "failed") {
        await setRunErrorIfEmpty(run.id, o.value.message);
        await db.update(seoRankTasks).set({ status: "fallback", message: o.value.message }).where(eq(seoRankTasks.id, t.id));
        continue;
      }
      results.push({
        ...buildRankCheckResult({ keywordId: t.trackingKeywordId, keyword: t.keyword, targetDomain: config.domain }, o.value.items),
        device: t.device,
      });
      await db.update(seoRankTasks).set({ status: "completed" }).where(eq(seoRankTasks.id, t.id));
    }
    await insertSnapshots(run.id, results);
    collected += results.length;
  }
  if (collected) await refreshProgress(run.id);
  const stats = { ...(run.stats ?? {}), queueCollected: (run.stats?.queueCollected ?? 0) + collected };
  const [{ n: stillPending } = { n: 0 }] = (await db.execute(
    sql`SELECT count(*)::int AS n FROM ${seoRankTasks} WHERE run_id = ${run.id} AND status = 'pending' AND task_id IS NOT NULL`,
  )) as unknown as { n: number }[];
  if (Number(stillPending) > 0 && !finalRound) {
    const nextRound = round + 1;
    await updateRun(run.id, { collectRound: nextRound, stats });
    await enqueueContinuation(run, RANK_COLLECT_JOB, QUEUED_POLL_INTERVALS_MIN[nextRound]! * 60_000);
    return { collected, pending: Number(stillPending), nextRound };
  }
  // Window closed (≈15 min): everything unfinished — plus claimed-but-never-posted rows — goes to the live fallback.
  await db
    .update(seoRankTasks)
    .set({ status: "fallback", message: "Not collected within the polling window" })
    .where(and(eq(seoRankTasks.runId, run.id), eq(seoRankTasks.status, "pending")));
  await updateRun(run.id, { phase: "fallback", stats });
  await enqueueContinuation(run, RANK_CHECK_JOB);
  return { collected, fallback: true };
}

/** Stragglers → live endpoint in batches of 10 tasks (double-billed, fractions of a cent). Claim before calling. */
async function phaseFallback(ctx: SeoContext, run: RankRun, config: RankConfig, deadline: number): Promise<"done" | "continue"> {
  let fallbackTasks = run.stats?.fallbackTasks ?? 0;
  let fallbackChecked = run.stats?.fallbackChecked ?? 0;
  for (;;) {
    if (Date.now() > deadline) return "continue";
    const batch = await db
      .select()
      .from(seoRankTasks)
      .where(and(eq(seoRankTasks.runId, run.id), eq(seoRankTasks.status, "fallback")))
      .orderBy(asc(seoRankTasks.id))
      .limit(KEYWORDS_PER_BATCH);
    if (!batch.length) break;
    await db
      .update(seoRankTasks)
      .set({ status: "failed", message: "Live fallback attempted" })
      .where(inArray(seoRankTasks.id, batch.map((b) => b.id)));
    fallbackTasks += batch.length;
    const written = await checkPairsLive(
      ctx,
      run,
      config,
      batch.map((b) => ({ keywordId: b.trackingKeywordId, keyword: b.keyword, device: b.device })),
    );
    fallbackChecked += written;
    await updateRun(run.id, { stats: { ...(run.stats ?? {}), fallbackTasks, fallbackChecked } });
    await refreshProgress(run.id);
  }
  await updateRun(run.id, { stats: { ...(run.stats ?? {}), fallbackTasks, fallbackChecked } });
  return "done";
}

async function finalize(run: RankRun) {
  const current = await loadRun(run.id);
  if (!current || current.status === "completed" || current.status === "failed") return;
  const [{ n } = { n: 0 }] = (await db.execute(
    sql`SELECT count(DISTINCT tracking_keyword_id)::int AS n FROM ${seoRankSnapshots} WHERE run_id = ${run.id}`,
  )) as unknown as { n: number }[];
  const checked = Number(n);
  const total = current.keywordsTotal || checked;
  const incomplete = total - checked;
  const status = checked === 0 && total > 0 ? "failed" : "completed";
  const keywordError = current.errorMessage;
  const errorMessage =
    status === "failed"
      ? (keywordError ?? "No keywords could be checked.")
      : incomplete > 0
        ? `Checked ${checked} of ${total} keyword(s)${keywordError ? `: ${keywordError}` : ""}`
        : null;
  await updateRun(run.id, { status, keywordsChecked: checked, completedAt: new Date(), errorMessage, phase: "done" });
  if (status === "completed") {
    // nextCheckAt is advanced by the scheduler before starting, never here.
    await db.update(seoRankConfigs).set({ lastCheckedAt: new Date(), lastSkipReason: null }).where(eq(seoRankConfigs.id, run.configId));
  }
  console.info(`[rank-check] ${run.id} ${status} trigger=${run.trigger} method=${run.method} keywords=${checked}/${total}`);
}

/** Entry point of the `seo.rank-check` job: advances the run through its phases, slicing long work. */
export async function executeRankCheck(runId: string) {
  let run = await loadRun(runId);
  if (!run || run.status === "completed" || run.status === "failed") return { skipped: true };
  const loaded = await loadRunContext(run);
  if (!loaded) {
    await failRunIfActive(runId, "Config not found");
    return { failed: true };
  }
  const { ctx, config } = loaded;
  const deadline = Date.now() + SLICE_MS;
  try {
    if (run.phase === "prepare") {
      const prepared = await phasePrepare(run, config);
      if (!prepared) return { failed: true };
      run = prepared;
    }
    if (run.phase === "live") {
      if ((await phaseLive(ctx, run, config, deadline)) === "continue") {
        await enqueueContinuation(run, RANK_CHECK_JOB);
        return { continued: true };
      }
      await finalize(run);
      return { done: true };
    }
    if (run.phase === "post") {
      await phasePost(ctx, run, config);
      return { posted: true };
    }
    if (run.phase === "fallback") {
      const fresh = (await loadRun(run.id)) ?? run;
      if ((await phaseFallback(ctx, fresh, config, deadline)) === "continue") {
        await enqueueContinuation(fresh, RANK_CHECK_JOB);
        return { continued: true };
      }
      await finalize(fresh);
      return { done: true };
    }
    if (run.phase === "finalize") {
      await finalize(run);
      return { done: true };
    }
    return { skipped: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await failRunIfActive(runId, message);
    const reason =
      err instanceof BudgetExceededError || (err instanceof SeoError && err.code === "BUDGET")
        ? "budget_exceeded"
        : err instanceof SeoError && err.code === "INSUFFICIENT_FUNDS"
          ? "insufficient_credits"
          : null;
    if (reason) await db.update(seoRankConfigs).set({ lastSkipReason: reason }).where(eq(seoRankConfigs.id, run.configId));
    throw err;
  }
}

/* ───────────────────────────── Keyword metrics refresh (job body) ───────────────────────────── */

export async function refreshTrackingKeywordMetrics(configId: string, userId: string | null = null): Promise<{ updated: number }> {
  const [row] = await db
    .select({ config: seoRankConfigs, project: projects })
    .from(seoRankConfigs)
    .innerJoin(projects, eq(projects.id, seoRankConfigs.projectId))
    .where(eq(seoRankConfigs.id, configId))
    .limit(1);
  if (!row) throw new SeoError("NOT_FOUND", "Rank tracking config not found");
  const ctx = systemSeoContext(row.project, userId);
  const config = row.config;
  const keywords = await db.select().from(seoRankKeywords).where(eq(seoRankKeywords.configId, configId));
  if (!keywords.length) return { updated: 0 };
  const metrics = await fetchKeywordMetricsForList(ctx, {
    // Keyword-data APIs are case-insensitive and echo lowercased keywords.
    keywords: [...new Set(keywords.map((k) => k.keyword.toLowerCase()))],
    locationCode: config.locationCode,
    languageCode: resolveKeywordDataLanguage(config.locationCode, config.languageCode),
    locationName: config.locationName ?? undefined,
    feature: "rank_tracking",
  });
  const byKeyword = new Map(metrics.map((m) => [m.keyword.toLowerCase(), m]));
  let updated = 0;
  const now = new Date();
  for (const k of keywords) {
    const m = byKeyword.get(k.keyword.toLowerCase());
    if (!m) continue;
    await db
      .update(seoRankKeywords)
      .set({
        searchVolume: m.searchVolume != null ? Math.round(m.searchVolume) : null,
        keywordDifficulty: m.keywordDifficulty != null ? Math.round(m.keywordDifficulty) : null,
        cpc: m.cpc,
        metricsFetchedAt: now,
      })
      .where(eq(seoRankKeywords.id, k.id));
    updated++;
  }
  return { updated };
}

/* ───────────────────────────── Scheduler ───────────────────────────── */

/** Compare-and-set on the observed nextCheckAt (no double starts across replicas / overlapping ticks). */
async function claimSlot(configId: string, observed: Date | null, next: Date, skipReason: string | null): Promise<boolean> {
  const rows = await db
    .update(seoRankConfigs)
    .set({ nextCheckAt: next, lastSkipReason: skipReason })
    .where(
      and(
        eq(seoRankConfigs.id, configId),
        eq(seoRankConfigs.isActive, true),
        observed ? eq(seoRankConfigs.nextCheckAt, observed) : isNull(seoRankConfigs.nextCheckAt),
      ),
    )
    .returning({ id: seoRankConfigs.id });
  return rows.length > 0;
}

/**
 * Every 5 min: due configs (active, non-manual, nextCheckAt ≤ now, project not archived), budget of 1000 task
 * units per tick (first start always admitted), 3-min deadline. Scheduled runs use the queued (task_post) path.
 * Also fails stale active runs so their config slot is released.
 */
export async function runScheduledRankChecks() {
  const started = Date.now();
  const summary = { candidates: 0, started: 0, unitsStarted: 0, skippedNoKeywords: 0, alreadyRunning: 0, staleFailed: 0, errors: 0 };

  const active = await db.select().from(seoRankRuns).where(inArray(seoRankRuns.status, ["pending", "running"])).limit(200);
  for (const run of active) {
    const reason = await staleReasonForRun(run);
    if (reason) {
      await failRunIfActive(run.id, reason);
      summary.staleFailed++;
    }
  }

  const due = await getDueRankConfigs(new Date());
  summary.candidates = due.length;
  const configured = due.length > 0 && (await isDataForSeoConfigured());
  for (const config of due) {
    if (Date.now() - started > TICK_DEADLINE_MS) break;
    if (!isScheduledInterval(config.scheduleInterval)) continue;
    const observed = config.nextCheckAt;
    const next = computeNextCheckAt(config.scheduleInterval, observed);
    try {
      const [{ n } = { n: 0 }] = (await db.execute(
        sql`SELECT count(*)::int AS n FROM ${seoRankKeywords} WHERE config_id = ${config.id}`,
      )) as unknown as { n: number }[];
      const keywordCount = Number(n);
      if (keywordCount === 0) {
        if (await claimSlot(config.id, observed, next, "no_keywords")) summary.skippedNoKeywords++;
        continue;
      }
      if (!configured) {
        // Advance the slot without starting a run that could only fail.
        await claimSlot(config.id, observed, next, "not_configured");
        continue;
      }
      const units = keywordCount * devicesCount(config.devices);
      if (summary.started > 0 && summary.unitsStarted + units > SCHEDULED_TASK_UNIT_BUDGET) break;
      if (!(await claimSlot(config.id, observed, next, null))) continue;
      const [project] = await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, config.projectId)).limit(1);
      const result = await beginRankCheckRun({
        config,
        trigger: "scheduled",
        keywordsTotal: keywordCount,
        userId: null,
        workspaceId: project?.workspaceId ?? "",
      });
      if (!result.ok) {
        // Restore the previous slot (reverse CAS) so the next tick retries.
        await db
          .update(seoRankConfigs)
          .set({ nextCheckAt: observed })
          .where(and(eq(seoRankConfigs.id, config.id), eq(seoRankConfigs.nextCheckAt, next)));
        summary.alreadyRunning++;
        continue;
      }
      summary.started++;
      summary.unitsStarted += units;
    } catch (err) {
      summary.errors++;
      console.error(`[rank-scheduler] config ${config.id} failed`, err);
    }
  }
  if (summary.candidates || summary.staleFailed) console.info("[rank-scheduler]", JSON.stringify(summary));
  return summary;
}
