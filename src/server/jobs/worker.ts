import "server-only";
import os from "node:os";
import { Cron } from "croner";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { claimJobs, completeJob, failJob, recoverStaleJobs, setJobProgress, type JobRow } from "./queue";
import { getHandlers, getSchedules } from "./define";
import "./registry";

const WORKER_ID = `${os.hostname()}:${process.pid}`;
const running = new Map<string, number>(); // type → count
let started = false;
let stopping = false;

class TimeoutError extends Error {}

async function runOne(job: JobRow) {
  const handler = getHandlers().get(job.type);
  if (!handler) {
    await failJob(job, new Error(`No handler registered for job type "${job.type}"`), false);
    return;
  }
  running.set(job.type, (running.get(job.type) ?? 0) + 1);
  const started = Date.now();
  const timeoutMs = handler.timeoutMs ?? 15 * 60_000;
  let timer: NodeJS.Timeout | undefined;
  // Heartbeat: keeps `locked_at` fresh so stale-job recovery only picks up jobs whose worker died.
  const heartbeat = setInterval(() => {
    void db
      .update(jobs)
      .set({ lockedAt: new Date() })
      .where(eq(jobs.id, job.id))
      .catch(() => {});
  }, 60_000);
  try {
    const result = await Promise.race([
      handler.run(job.payload as never, {
        job,
        progress: (p) => setJobProgress(job.id, p),
        isCancelled: async () => {
          const [row] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, job.id)).limit(1);
          return row?.status === "cancelled";
        },
        log: (...args) => console.info(`[job:${job.type}:${job.id}]`, ...args),
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(`Timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
      }),
    ]);
    const [row] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, job.id)).limit(1);
    if (row?.status !== "cancelled") await completeJob(job.id, result);
    console.info(`[jobs] ✓ ${job.type} ${job.id} (${Date.now() - started}ms)`);
  } catch (err) {
    console.error(`[jobs] ✗ ${job.type} ${job.id}:`, err instanceof Error ? err.message : err);
    await failJob(job, err, handler.retryable !== false);
  } finally {
    clearInterval(heartbeat);
    if (timer) clearTimeout(timer);
    running.set(job.type, Math.max(0, (running.get(job.type) ?? 1) - 1));
  }
}

async function pollOnce() {
  const limits = await getSetting("limits");
  const totalRunning = [...running.values()].reduce((a, b) => a + b, 0);
  const capacity = limits.jobConcurrency - totalRunning;
  if (capacity <= 0) return;
  const types: string[] = [];
  for (const [type, h] of getHandlers()) {
    if ((running.get(type) ?? 0) < (h.concurrency ?? 2)) types.push(type);
  }
  const claimed = await claimJobs(WORKER_ID, types, capacity);
  for (const job of claimed) void runOne(job);
}

async function loop() {
  while (!stopping) {
    try {
      await pollOnce();
    } catch (err) {
      console.error("[jobs] poll error", err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function startScheduler() {
  for (const schedule of getSchedules().values()) {
    new Cron(schedule.cron, { timezone: "UTC", protect: true }, async () => {
      // Only one process runs schedules (advisory lock), so replicas don't double-enqueue.
      const lockId = hashName(schedule.name);
      const res = (await db.execute(sql`SELECT pg_try_advisory_lock(${lockId}) AS locked`)) as unknown as Array<{ locked: boolean }>;
      if (!res[0]?.locked) return;
      try {
        await schedule.tick();
      } catch (err) {
        console.error(`[scheduler] ${schedule.name} failed`, err);
      } finally {
        await db.execute(sql`SELECT pg_advisory_unlock(${lockId})`);
      }
    });
  }
  console.info(`[scheduler] ${getSchedules().size} schedules active`);
}

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return h;
}

export async function startWorker() {
  if (started) return;
  started = true;
  await recoverStaleJobs(5 * 60_000).catch(() => {});
  setInterval(() => void recoverStaleJobs(5 * 60_000).catch(() => {}), 2 * 60_000);
  startScheduler();
  void loop();
  console.info(`[jobs] worker ${WORKER_ID} started with ${getHandlers().size} handlers`);
  const stop = () => {
    stopping = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
