"use server";

import { z } from "zod";
import { actionProject, runAction } from "@/server/auth/guards";
import { enqueueJob } from "@/server/jobs/queue";

/** Queues a refresh of the published crawler IP range lists (used for bot verification). */
export async function refreshIpRangesAction(projectId: string) {
  return runAction(async () => {
    await actionProject(z.string().min(3).max(64).parse(projectId), "settings.manage");
    const job = await enqueueJob("analytics.bots.ip-ranges", {}, { dedupeKey: "analytics.bots.ip-ranges", priority: 20 });
    return { queued: !!job };
  });
}
