import "server-only";
// Job handlers + schedules for the "audit" module (Site Audit, Lighthouse, Crawlability).
import { and, eq, inArray } from "drizzle-orm";
import { defineJob, defineSchedule } from "../define";
import { db } from "@/server/db/client";
import { siteAudits } from "@/server/db/schema";
import { AUDIT_RUN_JOB, runAuditJob } from "@/server/audit-crawler/runner";
import { reconcileStaleAudits, reconcileStaleCrawlabilityChecks } from "@/server/audit-crawler/watchdog";
import { runDueSchedules } from "@/server/audit-crawler/schedules";
import { startAudit } from "@/server/audit-crawler/service";
import { CRAWLABILITY_JOB, LLMS_TXT_JOB, runAiLlmsTxt, runCrawlabilityCheck, startCrawlabilityCheck } from "@/server/crawlability/service";

/** One chunk of a site audit (≤ 4 min of work, then a continuation job is queued). */
defineJob<{ auditId: string }>({
  type: AUDIT_RUN_JOB,
  concurrency: 3,
  timeoutMs: 12 * 60_000,
  // Retries replay the chunk from Postgres state; billed Lighthouse calls are claimed per row and never re-run.
  retryable: true,
  run: (payload, ctx) => runAuditJob(payload, ctx),
});

defineJob<{ checkId: string }>({
  type: CRAWLABILITY_JOB,
  concurrency: 2,
  timeoutMs: 8 * 60_000,
  retryable: false,
  run: async (payload) => {
    const row = await runCrawlabilityCheck(payload.checkId);
    return { status: row?.status ?? "missing", score: row?.score ?? null };
  },
});

defineJob<{ checkId: string; userId?: string | null }>({
  type: LLMS_TXT_JOB,
  concurrency: 2,
  timeoutMs: 15 * 60_000,
  retryable: false,
  run: async (payload) => {
    await runAiLlmsTxt(payload.checkId, payload.userId ?? null);
    return { ok: true };
  },
});

/** Stuck-audit watchdog (open-seo: every 5 minutes): resumes audits from their frontier or fails them. */
defineSchedule({
  name: "audit.watchdog",
  cron: "*/5 * * * *",
  tick: async () => {
    const r = await reconcileStaleAudits();
    const c = await reconcileStaleCrawlabilityChecks(CRAWLABILITY_JOB);
    if (r.resumed || r.failed || c) console.info(`[audit] watchdog: resumed ${r.resumed}, failed ${r.failed}, crawlability failed ${c}`);
  },
});

/** Scheduled weekly/monthly re-audits and crawlability checks. */
defineSchedule({
  name: "audit.scheduled-runs",
  cron: "7 * * * *",
  tick: async () => {
    await runDueSchedules(async (schedule, project) => {
      if (schedule.kind === "site_audit") {
        const [running] = await db
          .select({ id: siteAudits.id })
          .from(siteAudits)
          .where(and(eq(siteAudits.projectId, project.id), inArray(siteAudits.status, ["queued", "running"])))
          .limit(1);
        if (running) throw new Error("an audit is already running");
        const { auditId } = await startAudit(
          { projectId: project.id, workspaceId: project.workspaceId, userId: schedule.createdBy },
          {
            startUrl: schedule.config.startUrl,
            maxPages: schedule.config.maxPages,
            lighthouse: schedule.config.lighthouse ?? false,
            lighthouseProvider: schedule.config.lighthouseProvider ?? "psi",
            trigger: "scheduled",
            scheduleId: schedule.id,
          },
        );
        return auditId;
      }
      const { checkId } = await startCrawlabilityCheck(
        { projectId: project.id, workspaceId: project.workspaceId, userId: schedule.createdBy },
        { urls: schedule.config.urls, trigger: "scheduled", scheduleId: schedule.id },
      );
      return checkId;
    });
  },
});
