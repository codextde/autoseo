import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { defineJob, defineSchedule } from "@/server/jobs/define";
import { enqueueJob } from "@/server/jobs/queue";
import { generateTasks, type GenerationTrigger } from "./generator";
import { TASKS_WRITE_JOB, writePendingTasks } from "./writer";

export const TASKS_GENERATE_JOB = "optimize.tasks.generate";

/** Queues a task analysis for a project (deduplicated while one is queued/running). */
export async function enqueueTaskGeneration(projectId: string, trigger: GenerationTrigger, userId?: string | null) {
  return enqueueJob(
    TASKS_GENERATE_JOB,
    { projectId, trigger },
    { dedupeKey: `${TASKS_GENERATE_JOB}:${projectId}`, projectId, createdBy: userId ?? null, priority: trigger === "manual" ? 50 : 120, maxAttempts: 2 },
  );
}

defineJob<{ projectId: string; trigger?: GenerationTrigger }>({
  type: TASKS_GENERATE_JOB,
  concurrency: 2,
  timeoutMs: 20 * 60_000,
  async run(payload, ctx) {
    const [exists] = (await db.execute(sql`select 1 as ok from projects where id = ${payload.projectId} and not archived`)) as unknown as Array<{ ok: number }>;
    if (!exists) return { skipped: "project not found or archived" };
    await ctx.progress({ step: "analyzing" });
    return generateTasks(payload.projectId, payload.trigger ?? "manual");
  },
});

defineJob<{ projectId: string; taskIds: string[] }>({
  type: TASKS_WRITE_JOB,
  concurrency: 1,
  timeoutMs: 30 * 60_000,
  retryable: false,
  async run(payload) {
    return writePendingTasks(payload.projectId, payload.taskIds ?? []);
  },
});

/** Daily re-analysis of every active project. */
defineSchedule({
  name: "optimize.tasks.daily",
  cron: "15 6 * * *",
  async tick() {
    const rows = (await db.execute(sql`select id from projects where not archived`)) as unknown as Array<{ id: string }>;
    for (const r of rows) await enqueueTaskGeneration(r.id, "schedule");
  },
});

/** Re-analysis after tracking runs: projects whose latest AI run finished after the last task analysis. */
defineSchedule({
  name: "optimize.tasks.after-tracking",
  cron: "*/15 * * * *",
  async tick() {
    const rows = (await db.execute(sql`
      select r.project_id as id
      from ai_runs r join projects p on p.id = r.project_id and not p.archived
      where r.status in ('completed', 'partial') and r.finished_at is not null
      group by r.project_id
      having max(r.finished_at) > coalesce(
        (select max(o.started_at) from optimize_runs o where o.project_id = r.project_id and o.kind = 'tasks'),
        'epoch'::timestamptz)`)) as unknown as Array<{ id: string }>;
    for (const r of rows) await enqueueTaskGeneration(r.id, "tracking");
  },
});
