import "server-only";
// Jobs for optimize/fact-check (registered via src/server/jobs/handlers/optimize.ts).
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { defineJob, defineSchedule } from "@/server/jobs/define";
import { enqueueFactCheck, FC_JOBS, type FcRunPayload } from "./enqueue";
import { processDocument } from "./documents";
import { discoverAssets } from "./discover";
import { runFactCheck } from "./run";

type RunPayload = FcRunPayload;

defineJob<RunPayload>({
  type: FC_JOBS.run,
  concurrency: 1,
  timeoutMs: 45 * 60_000,
  run: async (payload, ctx) => runFactCheck({ ...payload, isCancelled: ctx.isCancelled }),
});

defineJob<{ documentId: string; projectId: string; assetId: string }>({
  type: FC_JOBS.document,
  concurrency: 2,
  timeoutMs: 5 * 60_000,
  retryable: false,
  run: async (payload) => {
    const result = await processDocument(payload.documentId);
    if (!("failed" in result) && !("skipped" in result)) {
      await enqueueFactCheck({ projectId: payload.projectId, assetId: payload.assetId, trigger: "manual" });
    }
    return result;
  },
});

defineJob<{ projectId: string; url: string; userId?: string | null; workspaceId?: string | null }>({
  type: FC_JOBS.discover,
  concurrency: 2,
  timeoutMs: 6 * 60_000,
  retryable: false,
  run: async (payload) => discoverAssets(payload.url, payload),
});

/** Daily re-check of every project with active assets. */
defineSchedule({
  name: "optimize.factcheck.daily",
  cron: "40 5 * * *",
  tick: async () => {
    const rows = (await db.execute(
      sql`SELECT DISTINCT project_id FROM fc_assets WHERE status = 'active'`,
    )) as unknown as Array<{ project_id: string }>;
    for (const r of rows) await enqueueFactCheck({ projectId: r.project_id, trigger: "schedule" });
  },
});

/** After tracking runs: projects whose AI runs finished after the last fact-check run. */
defineSchedule({
  name: "optimize.factcheck.after_tracking",
  cron: "*/20 * * * *",
  tick: async () => {
    const rows = (await db.execute(sql`
      SELECT DISTINCT a.project_id
      FROM fc_assets a
      WHERE a.status = 'active'
        AND EXISTS (
          SELECT 1 FROM ai_runs r
          WHERE r.project_id = a.project_id
            AND r.status IN ('completed', 'partial')
            AND r.finished_at > coalesce(
              (SELECT max(o.started_at) FROM optimize_runs o WHERE o.project_id = a.project_id AND o.kind = 'fact_check'),
              'epoch'::timestamptz)
        )`)) as unknown as Array<{ project_id: string }>;
    for (const r of rows) await enqueueFactCheck({ projectId: r.project_id, trigger: "tracking" });
  },
});
