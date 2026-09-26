import "server-only";
/**
 * Recurring site audits / crawlability checks per project (weekly / monthly), with a fixed anchor
 * (no drift) and compare-and-set claiming so replicas never double-start a run.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditSchedules, projects, type AuditScheduleConfig } from "@/server/db/schema";

export type ScheduleKind = "site_audit" | "crawlability";
export type ScheduleFrequency = "weekly" | "monthly";

export function advanceSchedule(from: Date, frequency: ScheduleFrequency): Date {
  const d = new Date(from);
  if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Next slot strictly after `now`, anchored on the previous slot. */
export function nextRunAfter(anchor: Date, frequency: ScheduleFrequency, now = new Date()): Date {
  let next = new Date(anchor);
  let guard = 0;
  while (next <= now && guard++ < 1000) next = advanceSchedule(next, frequency);
  return next;
}

export async function getSchedule(projectId: string, kind: ScheduleKind) {
  const [row] = await db
    .select()
    .from(auditSchedules)
    .where(and(eq(auditSchedules.projectId, projectId), eq(auditSchedules.kind, kind)))
    .limit(1);
  return row ?? null;
}

export async function upsertSchedule(
  projectId: string,
  kind: ScheduleKind,
  input: { enabled: boolean; frequency: ScheduleFrequency; config: AuditScheduleConfig },
  userId: string | null,
) {
  const existing = await getSchedule(projectId, kind);
  // First run: next day at 03:00 UTC (quiet hours), then every week/month.
  const firstRun = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(3, 0, 0, 0);
    return d;
  })();
  const nextRunAt =
    existing && existing.enabled && existing.frequency === input.frequency ? existing.nextRunAt : input.enabled ? firstRun : (existing?.nextRunAt ?? firstRun);
  const [row] = await db
    .insert(auditSchedules)
    .values({ projectId, kind, enabled: input.enabled, frequency: input.frequency, config: input.config, nextRunAt, createdBy: userId })
    .onConflictDoUpdate({
      target: [auditSchedules.projectId, auditSchedules.kind],
      set: { enabled: input.enabled, frequency: input.frequency, config: input.config, nextRunAt, updatedAt: new Date(), createdBy: existing?.createdBy ?? userId },
    })
    .returning();
  return row!;
}

/** Claims due schedules (CAS on next_run_at) and hands each to `start`. */
export async function runDueSchedules(
  start: (schedule: typeof auditSchedules.$inferSelect, project: typeof projects.$inferSelect) => Promise<string | null>,
) {
  const now = new Date();
  const due = await db
    .select({ schedule: auditSchedules, project: projects })
    .from(auditSchedules)
    .innerJoin(projects, eq(projects.id, auditSchedules.projectId))
    .where(and(eq(auditSchedules.enabled, true), lte(auditSchedules.nextRunAt, now), eq(projects.archived, false)))
    .limit(50);
  for (const { schedule, project } of due) {
    const next = nextRunAfter(schedule.nextRunAt, schedule.frequency, now);
    const [claimed] = await db
      .update(auditSchedules)
      .set({ nextRunAt: next, lastRunAt: now })
      .where(and(eq(auditSchedules.id, schedule.id), eq(auditSchedules.nextRunAt, schedule.nextRunAt)))
      .returning({ id: auditSchedules.id });
    if (!claimed) continue;
    try {
      const runId = await start(schedule, project);
      if (runId) await db.update(auditSchedules).set({ lastRunId: runId }).where(eq(auditSchedules.id, schedule.id));
    } catch (err) {
      console.error(`[audit] scheduled ${schedule.kind} for ${project.id} failed to start:`, err instanceof Error ? err.message : err);
      // Retry in an hour instead of waiting a full period.
      await db
        .update(auditSchedules)
        .set({ nextRunAt: sql`LEAST(${auditSchedules.nextRunAt}, now() + interval '1 hour')` })
        .where(eq(auditSchedules.id, schedule.id));
    }
  }
}
