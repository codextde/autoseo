import "server-only";
// Job handlers + schedules for the "ai" module (use defineJob / defineSchedule from ../define).
import { eq } from "drizzle-orm";
import { defineJob, defineSchedule } from "../define";
import { enqueueJob } from "../queue";
import { db } from "@/server/db/client";
import { aiAnswers } from "@/server/db/schema";
import { processAnswerTask, runDueProjects, startTrackingRun, type RunTrigger } from "@/server/ai/tracking/runs";
import { analyzeAnswer } from "@/server/ai/analysis";
import { bootstrapProject } from "@/server/ai/bootstrap";

/** Hourly: start tracking runs for projects whose frequency (daily / weekly / monthly) is due. */
defineSchedule({
  name: "ai.tracking.schedule",
  cron: "7 * * * *",
  tick: async () => {
    await enqueueJob("ai.tracking.tick", {}, { dedupeKey: "ai.tracking.tick", maxAttempts: 1 });
  },
});

defineJob<Record<string, never>>({
  type: "ai.tracking.tick",
  concurrency: 1,
  retryable: false,
  run: async () => runDueProjects(),
});

/** Manual / API runs (the UI usually calls startTrackingRun directly). */
defineJob<{ projectId: string; trigger?: RunTrigger; promptIds?: string[]; userId?: string | null }>({
  type: "ai.run_project",
  concurrency: 2,
  retryable: false,
  run: async (p) => startTrackingRun({ projectId: p.projectId, trigger: p.trigger ?? "manual", promptIds: p.promptIds, userId: p.userId ?? null }),
});

/** One prompt × one engine. Billed external call → never retried by the queue (one internal retry for transient errors). */
defineJob<{ runId?: string | null; promptId: string; engine: string }>({
  type: "ai.answer",
  concurrency: 4,
  retryable: false,
  timeoutMs: 12 * 60_000,
  run: async (p, ctx) => {
    const result = await processAnswerTask(p);
    ctx.log("answered", p.engine, result);
    return result;
  },
});

/** Deterministic analysis + LLM extraction for one stored answer. */
defineJob<{ answerId: string; llm?: boolean }>({
  type: "ai.analyze",
  concurrency: 2,
  // Local agent first (up to Admin → agent timeout), then API fallback.
  timeoutMs: 20 * 60_000,
  run: async (p) => {
    const [exists] = await db.select({ id: aiAnswers.id }).from(aiAnswers).where(eq(aiAnswers.id, p.answerId)).limit(1);
    if (!exists) return { skipped: "answer_deleted" };
    return analyzeAnswer(p.answerId, { llm: p.llm });
  },
});

/** Background project setup after createProject (brand profile, competitors, prompts, first run). */
defineJob<{ projectId: string; userId?: string | null }>({
  type: "ai.project_bootstrap",
  concurrency: 2,
  retryable: false,
  timeoutMs: 30 * 60_000,
  run: async (p, ctx) => {
    const steps = await bootstrapProject(p.projectId, { userId: p.userId ?? null });
    await ctx.progress({ steps });
    return { steps };
  },
});
