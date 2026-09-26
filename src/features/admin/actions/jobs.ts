"use server";

import { z } from "zod";
import { actionAdmin, ActionError, runAction } from "@/server/auth/guards";
import { cancelJob } from "@/server/jobs/queue";
import { getJobDetail, JOB_STATUSES, listJobs, retryJob } from "@/server/admin/jobs";
import { logAudit } from "@/server/audit";

const listSchema = z.object({
  status: z.enum([...JOB_STATUSES, "all"]).optional(),
  type: z.string().trim().max(120).nullable().optional(),
  q: z.string().trim().max(200).nullable().optional(),
  page: z.number().int().min(0).max(100_000).optional(),
  pageSize: z.number().int().min(10).max(200).optional(),
});

export async function listJobsAction(input: z.input<typeof listSchema>) {
  return runAction(async () => {
    await actionAdmin();
    return listJobs(listSchema.parse(input));
  });
}

const idSchema = z.string().trim().min(3).max(64).regex(/^[a-z]+_[a-z0-9]+$/i, "Invalid job id");

export async function getJobDetailAction(id: string) {
  return runAction(async () => {
    await actionAdmin();
    const job = await getJobDetail(idSchema.parse(id));
    if (!job) throw new ActionError("Job not found.", "not_found");
    return job;
  });
}

export async function retryJobAction(id: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const jobId = idSchema.parse(id);
    const ok = await retryJob(jobId);
    if (!ok) throw new ActionError("Only failed or cancelled jobs can be retried.", "conflict");
    await logAudit("job.retried", { actor: ctx.user, targetType: "job", targetId: jobId });
    return true;
  });
}

export async function cancelJobAction(id: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const jobId = idSchema.parse(id);
    const job = await getJobDetail(jobId);
    if (!job) throw new ActionError("Job not found.", "not_found");
    if (job.status !== "queued" && job.status !== "running") throw new ActionError("Only queued or running jobs can be cancelled.", "conflict");
    await cancelJob(jobId);
    await logAudit("job.cancelled", { actor: ctx.user, targetType: "job", targetId: jobId, meta: { type: job.type } });
    return true;
  });
}
