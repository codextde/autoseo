import "server-only";
import { and, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, invitations, jobs, loginTokens, projects, sessions } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { logAudit } from "@/server/audit";

/**
 * Housekeeping tasks run by the `core.maintenance` job (hourly + daily schedules) and on demand
 * from Admin → System.
 */
export const MAINTENANCE_TASKS = ["tokens", "sessions", "invitations", "pitch", "auditLogs", "jobs"] as const;
export type MaintenanceTask = (typeof MAINTENANCE_TASKS)[number];

export const HOURLY_TASKS: MaintenanceTask[] = ["tokens", "sessions", "invitations", "pitch"];
export const DAILY_TASKS: MaintenanceTask[] = ["auditLogs", "jobs"];

const DAY = 86_400_000;

function count(rows: unknown): number {
  return Array.isArray(rows) ? rows.length : 0;
}

/** Login tokens that expired or were used more than a day ago. */
export async function purgeLoginTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - DAY);
  const rows = await db
    .delete(loginTokens)
    .where(or(lt(loginTokens.expiresAt, cutoff), and(isNotNull(loginTokens.usedAt), lt(loginTokens.usedAt, cutoff))))
    .returning({ id: loginTokens.id });
  return count(rows);
}

/** Sessions that expired more than 7 days ago or were revoked more than 30 days ago. */
export async function purgeSessions(): Promise<number> {
  const rows = await db
    .delete(sessions)
    .where(
      or(
        lt(sessions.expiresAt, new Date(Date.now() - 7 * DAY)),
        and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, new Date(Date.now() - 30 * DAY))),
      ),
    )
    .returning({ id: sessions.id });
  return count(rows);
}

/** Marks pending invitations past their expiry as expired. */
export async function expireInvitations(): Promise<number> {
  const rows = await db
    .update(invitations)
    .set({ status: "expired" })
    .where(and(eq(invitations.status, "pending"), lt(invitations.expiresAt, new Date())))
    .returning({ id: invitations.id });
  return count(rows);
}

/** Archives pitch projects whose pitch period ended. */
export async function expirePitchProjects(): Promise<number> {
  const rows = await db
    .update(projects)
    .set({ archived: true })
    .where(
      and(
        eq(projects.isPitch, true),
        eq(projects.archived, false),
        isNotNull(projects.pitchExpiresAt),
        lt(projects.pitchExpiresAt, new Date()),
      ),
    )
    .returning({ id: projects.id, name: projects.name, workspaceId: projects.workspaceId, pitchExpiresAt: projects.pitchExpiresAt });
  for (const p of rows) {
    await logAudit("project.pitch_expired", {
      targetType: "project",
      targetId: p.id,
      projectId: p.id,
      workspaceId: p.workspaceId,
      meta: { name: p.name, expiredAt: p.pitchExpiresAt?.toISOString() ?? null },
    });
  }
  return rows.length;
}

/** Deletes audit log entries older than the configured retention. */
export async function pruneAuditLogs(): Promise<number> {
  const { auditLogRetentionDays } = await getSetting("security");
  const rows = await db
    .delete(auditLogs)
    .where(lt(auditLogs.createdAt, new Date(Date.now() - auditLogRetentionDays * DAY)))
    .returning({ id: auditLogs.id });
  return count(rows);
}

/** Deletes finished jobs older than the configured retention. */
export async function pruneFinishedJobs(): Promise<number> {
  const { jobRetentionDays } = await getSetting("security");
  const rows = await db
    .delete(jobs)
    .where(
      and(
        inArray(jobs.status, ["succeeded", "failed", "cancelled"]),
        sql`coalesce(${jobs.finishedAt}, ${jobs.updatedAt}) < ${new Date(Date.now() - jobRetentionDays * DAY).toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: jobs.id });
  return count(rows);
}

const RUNNERS: Record<MaintenanceTask, () => Promise<number>> = {
  tokens: purgeLoginTokens,
  sessions: purgeSessions,
  invitations: expireInvitations,
  pitch: expirePitchProjects,
  auditLogs: pruneAuditLogs,
  jobs: pruneFinishedJobs,
};

export type MaintenanceResult = Partial<Record<MaintenanceTask, number | string>>;

/** Runs the given tasks sequentially; a failing task is reported without stopping the others. */
export async function runMaintenance(tasks: readonly MaintenanceTask[] = MAINTENANCE_TASKS): Promise<MaintenanceResult> {
  const result: MaintenanceResult = {};
  for (const task of tasks) {
    try {
      result[task] = await RUNNERS[task]();
    } catch (err) {
      console.error(`[maintenance] ${task} failed`, err);
      result[task] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return result;
}
