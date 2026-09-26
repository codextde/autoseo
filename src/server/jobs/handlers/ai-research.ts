import "server-only";
// Job handlers + schedules for the "ai-research" module (Prompt Research, Brand Knowledge,
// Brand Lookup, Prompt Explorer).
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { brandKnowledge, integrations, jobs } from "@/server/db/schema";
import { defineJob, defineSchedule } from "../define";
import { enqueueJob } from "../queue";
import { GENERATE_JOB, runPromptGeneration } from "@/server/ai/research/generate";
import { ENRICH_JOB } from "@/server/ai/research/import";
import { enrichListVolumes } from "@/server/ai/research/enrich";
import { KNOWLEDGE_JOB, runKnowledgeAnalysis, type AnalysisKind } from "@/server/ai/knowledge/analyze";
import { PRODUCT_STREAM_PROVIDER } from "@/server/ai/knowledge/products";
import { BRAND_LOOKUP_JOB, runBrandLookup } from "@/server/ai/lookup/brand-lookup";
import { PROMPT_EXPLORER_JOB, runPromptExplorer } from "@/server/ai/lookup/prompt-explorer";
import type { PromptSetConfig } from "@/features/ai-research/types";

/**
 * Keeps `jobs.locked_at` fresh while a long job runs. The queue's stale-job recovery re-queues
 * running jobs whose lock is older than 15 minutes, which would otherwise duplicate long LLM jobs.
 */
async function withHeartbeat<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    void db
      .update(jobs)
      .set({ lockedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")))
      .catch(() => {});
  }, 60_000);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

defineJob<{ projectId: string; listId: string; config: PromptSetConfig; userId: string | null; auto?: boolean }>({
  type: GENERATE_JOB,
  concurrency: 2,
  timeoutMs: 120 * 60_000,
  retryable: false,
  run: (payload, ctx) => withHeartbeat(ctx.job.id, () => runPromptGeneration(payload, ctx)),
});

defineJob<{ projectId: string; listId: string; userId: string | null }>({
  type: ENRICH_JOB,
  concurrency: 2,
  timeoutMs: 20 * 60_000,
  retryable: false,
  run: (payload, ctx) =>
    withHeartbeat(ctx.job.id, () =>
      enrichListVolumes(payload.projectId, payload.listId, {
        userId: payload.userId,
        onlyMissing: true,
        progress: (message) => ctx.progress({ step: "volumes", message }),
      }),
    ),
});

defineJob<{ projectId: string; kind: AnalysisKind; userId: string | null }>({
  type: KNOWLEDGE_JOB,
  concurrency: 3,
  timeoutMs: 60 * 60_000,
  retryable: false,
  run: (payload, ctx) => withHeartbeat(ctx.job.id, () => runKnowledgeAnalysis(payload, ctx)),
});

defineJob<{ lookupId: string }>({
  type: BRAND_LOOKUP_JOB,
  concurrency: 2,
  timeoutMs: 10 * 60_000,
  retryable: false,
  run: (payload) => runBrandLookup(payload.lookupId),
});

defineJob<{ lookupId: string }>({
  type: PROMPT_EXPLORER_JOB,
  concurrency: 3,
  timeoutMs: 10 * 60_000,
  retryable: false,
  run: (payload, ctx) => withHeartbeat(ctx.job.id, () => runPromptExplorer(payload.lookupId)),
});

/** Daily re-sync of connected product feeds (feed URL source with daily sync enabled). */
defineSchedule({
  name: "ai_research.product_feeds",
  cron: "17 4 * * *",
  tick: async () => {
    const rows = await db
      .select({ projectId: integrations.projectId, config: integrations.config, connectedBy: integrations.connectedBy })
      .from(integrations)
      .where(eq(integrations.provider, PRODUCT_STREAM_PROVIDER));
    for (const r of rows) {
      const cfg = r.config as { source?: string; feedUrl?: string; syncDaily?: boolean };
      if (cfg.source !== "feed" || !cfg.feedUrl || cfg.syncDaily === false) continue;
      // Scheduled syncs don't email anyone (userId null).
      const job = await enqueueJob(
        KNOWLEDGE_JOB,
        { projectId: r.projectId, kind: "products", userId: null },
        { projectId: r.projectId, dedupeKey: `knowledge:${r.projectId}:products`, maxAttempts: 1 },
      );
      if (!job) continue;
      await db
        .insert(brandKnowledge)
        .values({ projectId: r.projectId, kind: "products", status: "running", startedAt: new Date(), jobId: job.id })
        .onConflictDoUpdate({
          target: [brandKnowledge.projectId, brandKnowledge.kind],
          set: { status: "running", startedAt: new Date(), error: null, jobId: job.id },
        });
    }
  },
});

/** Recovers lists/analyses stuck in a running state after a crash (job gone or finished). */
defineSchedule({
  name: "ai_research.recover_stuck",
  cron: "*/10 * * * *",
  tick: async () => {
    await db.execute(sql`
      UPDATE prompt_research_lists l SET status = 'failed', error = 'Generation was interrupted. Please try again.', job_id = NULL
      WHERE l.status = 'generating' AND (l.job_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM jobs j WHERE j.id = l.job_id AND j.status IN ('queued', 'running')))
        AND l.updated_at < now() - interval '5 minutes'`);
    await db.execute(sql`
      UPDATE brand_knowledge k SET status = 'failed', error = 'Analysis was interrupted. Please run it again.'
      WHERE k.status = 'running' AND (k.job_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM jobs j WHERE j.id = k.job_id AND j.status IN ('queued', 'running')))
        AND k.updated_at < now() - interval '5 minutes'`);
    await db.execute(sql`
      UPDATE ai_lookups a SET status = 'failed', error = 'Lookup was interrupted. Please run it again.'
      WHERE a.status IN ('queued', 'running') AND (a.job_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM jobs j WHERE j.id = a.job_id AND j.status IN ('queued', 'running')))
        AND a.created_at < now() - interval '5 minutes'`);
  },
});
