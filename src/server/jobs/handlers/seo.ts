import "server-only";
// Job handlers + schedules for the "seo" module (keyword metrics refreshes, rank checks, local SEO tools).
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { defineJob, defineSchedule } from "../define";
import { systemSeoContext } from "@/server/seo/context";
import { purgeExpiredCache } from "@/server/seo/cache";
import { refreshSavedKeywordMetrics, SAVED_METRICS_JOB } from "@/server/seo/saved-keywords";
import { RANK_CHECK_JOB, RANK_COLLECT_JOB, RANK_METRICS_JOB } from "@/server/seo/rank-tracking";
import { collectQueuedRound, executeRankCheck, refreshTrackingKeywordMetrics, runScheduledRankChecks } from "@/server/seo/rank-engine";
import { collectLocalTask, executeLocalRun, LOCAL_COLLECT_JOB, LOCAL_RUN_JOB } from "@/server/seo/local";

/** Saved keywords → Labs keyword_overview / Google Ads search_volume (batches ≤700). Billed → no retries. */
defineJob<{ projectId: string; userId?: string | null }>({
  type: SAVED_METRICS_JOB,
  retryable: false,
  concurrency: 2,
  timeoutMs: 10 * 60_000,
  run: async (payload) => {
    const [project] = await db.select().from(projects).where(eq(projects.id, payload.projectId)).limit(1);
    if (!project) return { skipped: "project not found" };
    return refreshSavedKeywordMetrics(systemSeoContext(project, payload.userId ?? null));
  },
});

/** Rank check run: prepare → live batches | task_post → finalize. Slices itself (≤4 min per invocation). Billed → no retries. */
defineJob<{ runId: string }>({
  type: RANK_CHECK_JOB,
  retryable: false,
  concurrency: 3,
  timeoutMs: 10 * 60_000,
  run: async (payload) => executeRankCheck(payload.runId),
});

/** Queued rank-check collection round (tasks_ready + task_get are free → safe to retry). */
defineJob<{ runId: string }>({
  type: RANK_COLLECT_JOB,
  retryable: true,
  concurrency: 3,
  timeoutMs: 8 * 60_000,
  run: async (payload) => collectQueuedRound(payload.runId),
});

/** Tracked keyword volume / KD / CPC refresh (local configs merge Ads city volume + Labs KD). */
defineJob<{ configId: string; userId?: string | null }>({
  type: RANK_METRICS_JOB,
  retryable: false,
  concurrency: 2,
  timeoutMs: 10 * 60_000,
  run: async (payload) => refreshTrackingKeywordMetrics(payload.configId, payload.userId ?? null),
});

/** Local SEO tool execution (business search, local SERP, rank grid, profile, Q&A; reviews/posts post a task). */
defineJob<{ runId: string }>({
  type: LOCAL_RUN_JOB,
  retryable: false,
  concurrency: 3,
  timeoutMs: 10 * 60_000,
  run: async (payload) => executeLocalRun(payload.runId),
});

/** Collect queued reviews / posts (free task_get). */
defineJob<{ runId: string }>({
  type: LOCAL_COLLECT_JOB,
  retryable: true,
  concurrency: 4,
  timeoutMs: 2 * 60_000,
  run: async (payload) => collectLocalTask(payload.runId),
});

/** Scheduled rank checks (queued task_post path) + stale-run reconciliation. */
defineSchedule({ name: "seo.rank-scheduler", cron: "*/5 * * * *", tick: async () => void (await runScheduledRankChecks()) });

/** Drop expired DataForSEO cache rows daily. */
defineSchedule({
  name: "seo.cache-purge",
  cron: "23 3 * * *",
  tick: async () => {
    const n = await purgeExpiredCache();
    if (n) console.info(`[seo] purged ${n} expired cache entries`);
  },
});
