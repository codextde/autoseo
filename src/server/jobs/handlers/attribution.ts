import "server-only";
// Job handlers + schedules for the "attribution" module (use defineJob / defineSchedule from ../define).
import { and, isNotNull, lt } from "drizzle-orm";
import { defineJob, defineSchedule } from "../define";
import { enqueueJob } from "../queue";
import { db } from "@/server/db/client";
import { attributionWebhookLogs } from "@/server/db/schema";
import { reprocessWorkflow } from "@/server/attribution/webhook";
import { isImportProvider, runSourceImport } from "@/server/attribution/imports";
import { listImportSources } from "@/server/attribution/sources";

/** Replays payloads that arrived before a field-mapping workflow was mapped. */
defineJob<{ projectId: string; workflowId: string }>({
  type: "attribution.reprocess-workflow",
  concurrency: 2,
  timeoutMs: 10 * 60_000,
  retryable: false,
  run: async (payload, ctx) => {
    const result = await reprocessWorkflow(payload.projectId, payload.workflowId);
    ctx.log("reprocessed", result);
    return result;
  },
});

/** Pulls survey responses from Fairing / KnoCommerce / Zigpoll / SurveyMonkey. */
defineJob<{ sourceId: string }>({
  type: "attribution.import",
  concurrency: 2,
  timeoutMs: 20 * 60_000,
  run: async (payload) => runSourceImport(payload.sourceId),
});

/** Retention: pending (encrypted) payloads 7 days, webhook logs 30 days. */
defineJob({
  type: "attribution.cleanup",
  concurrency: 1,
  run: async () => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const monthAgo = new Date(Date.now() - 30 * 86_400_000);
    await db
      .update(attributionWebhookLogs)
      .set({ pendingPayload: null, message: "Pending payload expired (not mapped within 7 days)" })
      .where(and(isNotNull(attributionWebhookLogs.pendingPayload), lt(attributionWebhookLogs.createdAt, weekAgo)));
    await db.delete(attributionWebhookLogs).where(lt(attributionWebhookLogs.createdAt, monthAgo));
    return { ok: true };
  },
});

defineSchedule({
  name: "attribution.import-tick",
  cron: "17 * * * *",
  tick: async () => {
    const rows = await listImportSources(["fairing", "knocommerce", "zigpoll", "surveymonkey"]);
    for (const r of rows) {
      if (!isImportProvider(r.provider)) continue;
      await enqueueJob("attribution.import", { sourceId: r.id }, { projectId: r.projectId, dedupeKey: `attr-import:${r.id}` });
    }
  },
});

defineSchedule({
  name: "attribution.cleanup",
  cron: "41 3 * * *",
  tick: async () => {
    await enqueueJob("attribution.cleanup", {}, { dedupeKey: "attr-cleanup" });
  },
});

