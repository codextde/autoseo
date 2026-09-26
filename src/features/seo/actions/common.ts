"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { clearSearchHistory, listSearchHistory, removeSearchHistory } from "@/server/seo";
import { seoAction } from "../server/action-helpers";

const feature = z.enum(["keywords", "domain", "backlinks"]);

export async function listSearchHistoryAction(projectId: string, f: string) {
  return seoAction(projectId, undefined, (ctx) => listSearchHistory(ctx, feature.parse(f)));
}

export async function removeSearchHistoryAction(projectId: string, ids: string[]) {
  return seoAction(projectId, undefined, async (ctx) => {
    await removeSearchHistory(ctx, z.array(z.string()).max(50).parse(ids));
    return { ok: true };
  });
}

export async function clearSearchHistoryAction(projectId: string, f: string) {
  return seoAction(projectId, undefined, async (ctx) => {
    await clearSearchHistory(ctx, feature.parse(f));
    return { ok: true };
  });
}

/** Poll a background job of this project (metrics refreshes etc.). */
export async function getJobStatusAction(projectId: string, jobId: string) {
  return seoAction(projectId, undefined, async (ctx) => {
    const [job] = await db
      .select({ id: jobs.id, status: jobs.status, result: jobs.result, lastError: jobs.lastError, progress: jobs.progress, type: jobs.type })
      .from(jobs)
      .where(and(eq(jobs.id, z.string().parse(jobId)), eq(jobs.projectId, ctx.projectId)))
      .limit(1);
    return job ?? null;
  });
}
