import "server-only";
import { and, asc, desc, eq, gt, inArray, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { agentJobLogs, agentJobs, agents } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { agentStatus } from "./core";
import { onSignal } from "./notify";

export type LiveLogLine = { seq: number; jobId: string | null; stream: string; data: string; ts: string };
export type LiveStatus = {
  status: string;
  state: string;
  runningJobs: number;
  lastSeenAt: string | null;
  agentVersion: string | null;
  jobs: { id: string; purpose: string; kind: string; status: string; startedAt: string | null }[];
};

type Opts = { agentId: string; jobId?: string | null; after?: number | null; backlog?: number; signal: AbortSignal };

/**
 * Server-Sent Events stream for the live terminal: log lines (agent + job output), agent status and
 * (when following a single job) job status changes. Backed by the DB, woken by LISTEN/NOTIFY.
 */
export function createLiveStream(opts: Opts): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let wake: (() => void) | null = null;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown, id?: number) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`${id != null ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        wake?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      opts.signal.addEventListener("abort", close, { once: true });

      unsubscribe = onSignal((s) => {
        if (
          (s.type === "logs" && s.agentId === opts.agentId) ||
          (s.type === "agent-changed" && s.agentId === opts.agentId) ||
          (s.type === "job-done" && (!opts.jobId || s.jobId === opts.jobId)) ||
          s.type === "job-new"
        )
          wake?.();
      });

      const logFilter = (after: number) =>
        opts.jobId
          ? and(eq(agentJobLogs.agentId, opts.agentId), eq(agentJobLogs.jobId, opts.jobId), gt(agentJobLogs.seq, after))
          : and(eq(agentJobLogs.agentId, opts.agentId), gt(agentJobLogs.seq, after));

      const toLine = (r: typeof agentJobLogs.$inferSelect): LiveLogLine => ({
        seq: r.seq,
        jobId: r.jobId,
        stream: r.stream,
        data: r.data,
        ts: r.createdAt.toISOString(),
      });

      // Backlog.
      let cursor = opts.after ?? 0;
      if (opts.after == null) {
        const limit = Math.min(Math.max(opts.backlog ?? 300, 0), 2000);
        const rows = limit
          ? await db
              .select()
              .from(agentJobLogs)
              .where(logFilter(0))
              .orderBy(desc(agentJobLogs.seq))
              .limit(limit)
          : [];
        rows.reverse();
        if (rows.length) send("backlog", rows.map(toLine));
        cursor = rows.at(-1)?.seq ?? cursor;
        if (!rows.length) {
          const [last] = await db
            .select({ seq: agentJobLogs.seq })
            .from(agentJobLogs)
            .where(eq(agentJobLogs.agentId, opts.agentId))
            .orderBy(desc(agentJobLogs.seq))
            .limit(1);
          if (!opts.jobId) cursor = last?.seq ?? 0;
        }
      }
      send("ready", { cursor });

      let lastStatusAt = 0;
      let lastStatusJson = "";
      let lastJobStatus = "";
      let lastPing = Date.now();

      while (!closed) {
        try {
          const rows = await db.select().from(agentJobLogs).where(logFilter(cursor)).orderBy(asc(agentJobLogs.seq)).limit(1000);
          for (const r of rows) send("log", toLine(r), r.seq);
          if (rows.length) cursor = rows.at(-1)!.seq;

          if (Date.now() - lastStatusAt > 2_500) {
            lastStatusAt = Date.now();
            const status = await loadStatus(opts.agentId);
            if (!status) {
              send("gone", {});
              close();
              break;
            }
            const json = JSON.stringify(status);
            if (json !== lastStatusJson) {
              lastStatusJson = json;
              send("status", status);
            }
            if (opts.jobId) {
              const [job] = await db
                .select({ id: agentJobs.id, status: agentJobs.status, error: agentJobs.error, finishedAt: agentJobs.finishedAt, durationMs: agentJobs.durationMs })
                .from(agentJobs)
                .where(and(eq(agentJobs.id, opts.jobId), or(eq(agentJobs.agentId, opts.agentId), eq(agentJobs.pinnedAgentId, opts.agentId))))
                .limit(1);
              const js = JSON.stringify(job ?? null);
              if (js !== lastJobStatus) {
                lastJobStatus = js;
                send("job", job ?? null);
              }
            }
          }
          if (Date.now() - lastPing > 15_000) {
            lastPing = Date.now();
            if (!closed) controller.enqueue(enc.encode(`: ping\n\n`));
          }
        } catch (err) {
          console.error("[agents] live stream error", err);
        }
        if (closed) break;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 1_500);
          wake = () => {
            clearTimeout(t);
            wake = null;
            resolve();
          };
        });
        // Coalesce bursts of log writes.
        await new Promise((r) => setTimeout(r, 120));
      }
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      wake?.();
    },
  });
}

async function loadStatus(agentId: string): Promise<LiveStatus | null> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return null;
  const settings = await getSetting("agents");
  const jobs = await db
    .select({ id: agentJobs.id, purpose: agentJobs.purpose, kind: agentJobs.kind, status: agentJobs.status, startedAt: agentJobs.startedAt })
    .from(agentJobs)
    .where(and(eq(agentJobs.agentId, agentId), inArray(agentJobs.status, ["assigned", "running"])))
    .limit(50);
  return {
    status: agentStatus(agent, settings),
    state: agent.state,
    runningJobs: agent.runningJobs,
    lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
    agentVersion: agent.agentVersion,
    jobs: jobs.map((j) => ({ ...j, startedAt: j.startedAt?.toISOString() ?? null })),
  };
}
