import "server-only";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs, projects } from "@/server/db/schema";

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobListFilters = {
  status?: JobStatus | "all";
  type?: string | null;
  q?: string | null;
  page?: number;
  pageSize?: number;
};

export type JobListRow = {
  id: string;
  type: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  projectId: string | null;
  projectName: string | null;
  runAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  lastError: string | null;
  hasProgress: boolean;
};

function iso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function filterConds(f: JobListFilters, withStatus = true): SQL[] {
  const conds: SQL[] = [];
  if (withStatus && f.status && f.status !== "all") conds.push(eq(jobs.status, f.status));
  if (f.type) conds.push(eq(jobs.type, f.type));
  if (f.q) {
    const q = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(jobs.id, q), ilike(jobs.type, q), ilike(jobs.lastError, q), ilike(jobs.projectId, q))!);
  }
  return conds;
}

/** Paginated job list for the admin queue monitor, plus per-status counts and known types. */
export async function listJobs(f: JobListFilters) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 10), 200);
  const page = Math.max(0, f.page ?? 0);
  const conds = filterConds(f);
  const where = conds.length ? and(...conds) : undefined;

  const [rows, totalRow, statusCounts, types] = await Promise.all([
    db
      .select({ job: jobs, projectName: projects.name })
      .from(jobs)
      .leftJoin(projects, eq(projects.id, jobs.projectId))
      .where(where)
      .orderBy(desc(jobs.createdAt))
      .limit(pageSize)
      .offset(page * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(where),
    (() => {
      const c = filterConds(f, false);
      return db
        .select({ status: jobs.status, n: sql<number>`count(*)::int` })
        .from(jobs)
        .where(c.length ? and(...c) : undefined)
        .groupBy(jobs.status);
    })(),
    db
      .select({ type: jobs.type, n: sql<number>`count(*)::int` })
      .from(jobs)
      .groupBy(jobs.type)
      .orderBy(jobs.type),
  ]);

  const counts: Record<JobStatus | "all", number> = { all: 0, queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
  for (const s of statusCounts) {
    counts[s.status as JobStatus] = Number(s.n);
    counts.all += Number(s.n);
  }

  const items: JobListRow[] = rows.map(({ job, projectName }) => ({
    id: job.id,
    type: job.type,
    status: job.status,
    priority: job.priority,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    projectId: job.projectId,
    projectName,
    runAt: job.runAt.toISOString(),
    startedAt: iso(job.startedAt),
    finishedAt: iso(job.finishedAt),
    createdAt: job.createdAt.toISOString(),
    durationMs: job.startedAt && job.finishedAt ? job.finishedAt.getTime() - job.startedAt.getTime() : null,
    lastError: job.lastError,
    hasProgress: job.progress != null,
  }));

  return {
    items,
    total: Number(totalRow[0]?.n ?? 0),
    page,
    pageSize,
    counts,
    types: types.map((t) => ({ type: t.type, count: Number(t.n) })),
  };
}

export type JobDetail = {
  id: string;
  type: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  projectId: string | null;
  projectName: string | null;
  workspaceId: string | null;
  createdBy: string | null;
  payload: unknown;
  progress: unknown;
  result: unknown;
  lastError: string | null;
  runAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function getJobDetail(id: string): Promise<JobDetail | null> {
  const [row] = await db
    .select({ job: jobs, projectName: projects.name })
    .from(jobs)
    .leftJoin(projects, eq(projects.id, jobs.projectId))
    .where(eq(jobs.id, id))
    .limit(1);
  if (!row) return null;
  const j = row.job;
  return {
    id: j.id,
    type: j.type,
    status: j.status,
    priority: j.priority,
    attempts: j.attempts,
    maxAttempts: j.maxAttempts,
    dedupeKey: j.dedupeKey,
    lockedBy: j.lockedBy,
    lockedAt: iso(j.lockedAt),
    projectId: j.projectId,
    projectName: row.projectName,
    workspaceId: j.workspaceId,
    createdBy: j.createdBy,
    payload: j.payload,
    progress: j.progress,
    result: j.result,
    lastError: j.lastError,
    runAt: j.runAt.toISOString(),
    startedAt: iso(j.startedAt),
    finishedAt: iso(j.finishedAt),
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

/** Re-queues a failed/cancelled job (attempts reset, runs immediately). Returns false if not retryable. */
export async function retryJob(id: string): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({
      status: "queued",
      attempts: 0,
      runAt: new Date(),
      lockedBy: null,
      lockedAt: null,
      finishedAt: null,
      startedAt: null,
      lastError: null,
      result: null,
    })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ["failed", "cancelled"])))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** Queue backlog summary (overview + system pages). */
export async function jobQueueStats() {
  const rows = await db
    .select({ status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.status);
  const out: Record<JobStatus, number> = { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
  for (const r of rows) out[r.status as JobStatus] = Number(r.n);
  return out;
}
