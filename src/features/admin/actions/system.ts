"use server";

import { eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db/client";
import { feedback } from "@/server/db/schema";
import { actionAdmin, runAction } from "@/server/auth/guards";
import { invalidateSettingsCache } from "@/server/settings";
import { enqueueJob } from "@/server/jobs/queue";
import { clearFaviconCache } from "@/server/admin/system";
import { MAINTENANCE_TASKS } from "@/server/admin/maintenance";
import { logAudit } from "@/server/audit";

export async function clearCachesAction() {
  return runAction(async () => {
    const ctx = await actionAdmin();
    invalidateSettingsCache();
    const favicons = await clearFaviconCache();
    await logAudit("system.caches_cleared", { actor: ctx.user, meta: { favicons } });
    refresh();
    return { favicons };
  });
}

export async function runMaintenanceAction(tasks?: string[]) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const list = z.array(z.enum(MAINTENANCE_TASKS)).optional().parse(tasks);
    const job = await enqueueJob(
      "core.maintenance",
      { tasks: list?.length ? list : [...MAINTENANCE_TASKS], trigger: `manual:${ctx.user.email}` },
      { dedupeKey: "core.maintenance:manual", priority: 50, maxAttempts: 1, createdBy: ctx.user.id },
    );
    await logAudit("system.maintenance_started", { actor: ctx.user, targetType: "job", targetId: job?.id });
    return { jobId: job?.id ?? null, alreadyQueued: !job };
  });
}

const idsSchema = z.array(z.string().regex(/^fdb_[a-z0-9]+$/)).min(1).max(500);

export async function deleteFeedbackAction(ids: string[]) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const list = idsSchema.parse(ids);
    const rows = await db
      .delete(feedback)
      .where(list.length === 1 ? eq(feedback.id, list[0]!) : inArray(feedback.id, list))
      .returning({ id: feedback.id });
    await logAudit("feedback.deleted", { actor: ctx.user, meta: { count: rows.length } });
    refresh();
    return rows.length;
  });
}
