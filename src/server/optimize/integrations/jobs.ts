import "server-only";
// Jobs for optimize/integrations (registered via src/server/jobs/handlers/optimize.ts).
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { integrations, projects } from "@/server/db/schema";
import { defineJob, defineSchedule } from "@/server/jobs/define";
import { enqueueJob } from "@/server/jobs/queue";
import { deliverTaskEvent, publishContentToCms, pushTasksToPm, syncExternalStatuses } from "./index";
import { PM_PROVIDERS } from "./registry";
import type { WebhookEvent } from "./providers/webhook";

type PushPayload = { projectId: string; taskIds: string[]; provider: string; userId?: string | null };

defineJob<PushPayload>({
  type: "optimize.pm.push",
  concurrency: 2,
  // Retries don't duplicate issues: pushTasksToPm skips tasks already linked to the provider.
  async run(payload, ctx) {
    const results = await pushTasksToPm(payload.projectId, payload.taskIds, payload.provider, payload.userId ?? null);
    const failed = results.filter((r) => !r.ok);
    await ctx.progress({ pushed: results.length - failed.length, failed: failed.length });
    if (failed.length && failed.length === results.length) throw new Error(failed[0]?.error ?? "Push failed");
    return { pushed: results.length - failed.length, failed: failed.map((f) => ({ taskId: f.taskId, error: f.error })) };
  },
});

defineJob<{ projectId: string; event: WebhookEvent; taskIds: string[] }>({
  type: "optimize.webhook.deliver",
  concurrency: 3,
  timeoutMs: 60_000,
  async run(payload) {
    return deliverTaskEvent(payload.projectId, payload.event, payload.taskIds);
  },
});

defineJob<{ projectId: string }>({
  type: "optimize.pm.sync.project",
  concurrency: 2,
  timeoutMs: 10 * 60_000,
  async run(payload) {
    return syncExternalStatuses(payload.projectId);
  },
});

defineJob<{ projectId: string; contentId: string; provider: string; draft: boolean; userId?: string | null }>({
  type: "optimize.cms.publish",
  concurrency: 2,
  async run(payload) {
    return publishContentToCms(payload.projectId, payload.contentId, payload.provider, { draft: payload.draft }, payload.userId ?? null);
  },
});

/** Hourly: pull issue status back from PM tools for every project with a PM integration. */
defineSchedule({
  name: "optimize.pm.sync",
  cron: "17 * * * *",
  async tick() {
    const syncable = PM_PROVIDERS.filter((p) => p.supportsStatusSync).map((p) => p.key);
    const rows = await db
      .selectDistinct({ projectId: integrations.projectId })
      .from(integrations)
      .innerJoin(projects, eq(projects.id, integrations.projectId))
      .where(and(inArray(integrations.provider, syncable), inArray(integrations.status, ["connected", "error"]), eq(projects.archived, false)));
    for (const r of rows) {
      await enqueueJob(
        "optimize.pm.sync.project",
        { projectId: r.projectId },
        { projectId: r.projectId, dedupeKey: `optimize.pm.sync:${r.projectId}`, maxAttempts: 1, priority: 150 },
      );
    }
  },
});
