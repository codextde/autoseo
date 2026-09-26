import "server-only";
/**
 * Stuck-audit watchdog (open-seo `reconcileStaleAudits`, every 5 minutes). Audits whose heartbeat is
 * older than 10 minutes and that have no queued/running job are resumed from their frontier
 * (up to 3 times), then failed with `instance_lost`.
 */
import { and, asc, eq, inArray, lt, or, sql, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { crawlabilityChecks, jobs, siteAudits } from "@/server/db/schema";
import { AUDIT_RUN_JOB, enqueueAuditContinuation } from "./runner";
import { failAudit } from "./finalize";

const STALE_MS = 10 * 60_000;
const MAX_RESUMES = 3;

async function hasActiveJob(type: string, key: "auditId" | "checkId", id: string) {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, type), inArray(jobs.status, ["queued", "running"]), sql`${jobs.payload}->>${key} = ${id}`))
    .limit(1);
  return Boolean(row);
}

export async function reconcileStaleAudits(): Promise<{ resumed: number; failed: number }> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await db
    .select()
    .from(siteAudits)
    .where(
      and(
        inArray(siteAudits.status, ["queued", "running"]),
        or(lt(siteAudits.heartbeatAt, cutoff), and(isNull(siteAudits.heartbeatAt), lt(siteAudits.startedAt, cutoff))),
      ),
    )
    .orderBy(asc(siteAudits.startedAt))
    .limit(100);
  let resumed = 0;
  let failed = 0;
  for (const audit of stale) {
    if (await hasActiveJob(AUDIT_RUN_JOB, "auditId", audit.id)) continue;
    if (audit.resumeCount < MAX_RESUMES) {
      const [row] = await db
        .update(siteAudits)
        .set({ resumeCount: sql`${siteAudits.resumeCount} + 1`, runnerId: null, chunkNo: sql`${siteAudits.chunkNo} + 1`, heartbeatAt: new Date() })
        .where(and(eq(siteAudits.id, audit.id), eq(siteAudits.resumeCount, audit.resumeCount)))
        .returning();
      if (row) {
        await enqueueAuditContinuation(row);
        resumed++;
        console.info(`[audit] watchdog resumed ${audit.id} (phase ${audit.currentPhase})`);
      }
    } else {
      await failAudit(audit.id, new Error("The audit worker stopped responding and could not be resumed."), audit.currentPhase, "instance_lost");
      failed++;
    }
  }
  return { resumed, failed };
}

export async function reconcileStaleCrawlabilityChecks(jobType: string): Promise<number> {
  const cutoff = new Date(Date.now() - 20 * 60_000);
  const stale = await db
    .select({ id: crawlabilityChecks.id })
    .from(crawlabilityChecks)
    .where(and(inArray(crawlabilityChecks.status, ["queued", "running"]), lt(crawlabilityChecks.updatedAt, cutoff)))
    .limit(100);
  let failed = 0;
  for (const c of stale) {
    if (await hasActiveJob(jobType, "checkId", c.id)) continue;
    await db
      .update(crawlabilityChecks)
      .set({ status: "failed", error: "The check worker stopped responding. Please re-run the check.", completedAt: new Date() })
      .where(and(eq(crawlabilityChecks.id, c.id), inArray(crawlabilityChecks.status, ["queued", "running"])));
    failed++;
  }
  return failed;
}
