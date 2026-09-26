import "server-only";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { agentChatEvents, agentJobLogs, agentJobs, agents, type AgentJobCitation, type AgentJobKind, type AgentJobPayload } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { autoJobMode, logAgentEvent, offlineAfterSeconds, type AgentRow } from "./core";
import { signal } from "./notify";

export type AgentJobRow = typeof agentJobs.$inferSelect;
export const ACTIVE_JOB_STATUSES = ["assigned", "running"] as const;
export const FINAL_JOB_STATUSES = ["succeeded", "failed", "cancelled", "timeout"] as const;

/** Max log bytes stored per job (the full raw output stays in the job folder on the agent). */
const MAX_JOB_LOG_BYTES = 2 * 1024 * 1024;

export type CreateAgentJobInput = {
  kind: AgentJobKind;
  purpose: string;
  payload: AgentJobPayload;
  runtime?: "claude" | "codex" | "any";
  workspaceId?: string | null;
  projectId?: string | null;
  userId?: string | null;
  pinnedAgentId?: string | null;
  maxAttempts?: number;
  timeoutMs: number;
  /** Jobs still queued at this moment are failed (so callers can fall back). */
  expiresAt?: Date | null;
};

export async function createAgentJob(input: CreateAgentJobInput): Promise<AgentJobRow> {
  if (input.kind === "chat" && !input.userId) throw new Error("Chat jobs need the requesting user (they only run on that user's own agents).");
  // Full mode (local MCP servers & config) is personal: it only exists for a requesting user, whose own
  // agent runs it. Everything else is Lean and may run on any agent of the workspace pool.
  let mode = autoJobMode(input.kind, input.purpose, input.payload.mode);
  if (mode === "full" && !input.userId) mode = "lean";
  const [row] = await db
    .insert(agentJobs)
    .values({
      kind: input.kind,
      purpose: input.purpose.slice(0, 120),
      payload: { ...input.payload, mode },
      runtime: input.runtime ?? "any",
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      userId: input.userId ?? null,
      pinnedAgentId: input.pinnedAgentId ?? null,
      maxAttempts: input.pinnedAgentId ? 1 : (input.maxAttempts ?? 2),
      timeoutMs: Math.max(5_000, Math.round(input.timeoutMs)),
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  await signal({ type: "job-new" });
  return row!;
}

/**
 * Atomically assigns up to `slots` queued jobs this agent may run. Pinned jobs first, then FIFO.
 * Jobs that already failed on this agent are left to other agents for 15s before it may retry them.
 */
export async function claimJobsForAgent(
  agent: AgentRow,
  slots: number,
  runtimes: ("claude" | "codex")[],
  opts: { globalEnabled: boolean },
): Promise<AgentJobRow[]> {
  if (slots <= 0) return [];
  const kinds = agent.allowedKinds.length ? agent.allowedKinds : [];
  if (!kinds.length) return [];
  const kindList = sql.join(
    kinds.map((k) => sql`${k}`),
    sql`, `,
  );
  const runtimeList = runtimes.length
    ? sql.join(
        runtimes.map((r) => sql`${r}`),
        sql`, `,
      )
    : sql`'__none__'`;
  const mayTakeShared = agent.enabled && opts.globalEnabled;
  const ownerId = agent.userId ?? "";
  const rows = await db.execute(sql`
    UPDATE agent_jobs SET status = 'assigned', agent_id = ${agent.id}, assigned_at = now(), heartbeat_at = now(),
      attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT j.id FROM agent_jobs j
      WHERE j.status = 'queued'
        AND (j.expires_at IS NULL OR j.expires_at > now())
        AND j.kind IN (${kindList})
        AND (j.kind = 'test' OR j.runtime IN (${runtimeList}) OR (j.runtime = 'any' AND ${runtimes.length > 0}))
        AND (
          j.pinned_agent_id = ${agent.id}
          OR (
            j.pinned_agent_id IS NULL AND ${mayTakeShared}
            -- Workspace pool: own workspace only; instance-level jobs (no workspace) only on shared agents.
            AND (${agent.shared} OR j.workspace_id = ${agent.workspaceId})
            -- Personal jobs (chat, Full mode) only ever run on the requesting user's own agent.
            AND (
              (j.kind <> 'chat' AND COALESCE(j.payload->>'mode', 'lean') <> 'full')
              OR (j.user_id IS NOT NULL AND j.user_id = ${ownerId})
            )
            AND (NOT (j.excluded_agent_ids @> jsonb_build_array(${agent.id}::text)) OR j.queued_at < now() - interval '15 seconds')
          )
        )
      ORDER BY (j.pinned_agent_id IS NOT NULL) DESC, j.queued_at ASC
      LIMIT ${slots}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
  if (!ids.length) return [];
  return db.select().from(agentJobs).where(inArray(agentJobs.id, ids));
}

export async function getJobForAgent(agentId: string, jobId: string): Promise<AgentJobRow | null> {
  const [row] = await db
    .select()
    .from(agentJobs)
    .where(and(eq(agentJobs.id, jobId), eq(agentJobs.agentId, agentId)))
    .limit(1);
  return row ?? null;
}

export async function markJobStarted(
  agent: AgentRow,
  jobId: string,
  info: { runtime: "claude" | "codex"; cliVersion?: string | null; workDir?: string | null; cliMode?: "lean" | "full" | null },
): Promise<{ ok: boolean; cancel: boolean }> {
  const job = await getJobForAgent(agent.id, jobId);
  if (!job || !["assigned", "running"].includes(job.status)) return { ok: false, cancel: true };
  if (job.cancelRequestedAt) return { ok: true, cancel: true };
  await db
    .update(agentJobs)
    .set({
      status: "running",
      startedAt: new Date(),
      heartbeatAt: new Date(),
      runtimeUsed: info.runtime,
      cliVersion: info.cliVersion ?? null,
      workDir: info.workDir ?? null,
      cliMode: info.cliMode ?? null,
    })
    .where(and(eq(agentJobs.id, jobId), eq(agentJobs.agentId, agent.id), inArray(agentJobs.status, ["assigned", "running"])));
  await logAgentEvent(
    agent.id,
    "job_started",
    `Started ${job.kind} job "${job.purpose}" with ${info.runtime === "claude" ? "Claude Code" : "Codex"}${info.cliMode ? ` (${info.cliMode})` : ""}`,
    { jobId, meta: { runtime: info.runtime, cliVersion: info.cliVersion, cliMode: info.cliMode, attempt: job.attempts } },
  );
  return { ok: true, cancel: false };
}

export type LogEntry = { jobId?: string | null; stream: "stdout" | "stderr" | "agent" | "system"; data: string };

/** Stores streamed output. Returns ids of this agent's jobs that should be cancelled. */
export async function appendAgentLogs(agent: AgentRow, entries: LogEntry[]): Promise<string[]> {
  const jobIds = [...new Set(entries.map((e) => e.jobId).filter((v): v is string => !!v))];
  const jobs = jobIds.length
    ? await db
        .select({ id: agentJobs.id, logBytes: agentJobs.logBytes, cancelRequestedAt: agentJobs.cancelRequestedAt, status: agentJobs.status })
        .from(agentJobs)
        .where(and(inArray(agentJobs.id, jobIds), eq(agentJobs.agentId, agent.id)))
    : [];
  const jobMap = new Map(jobs.map((j) => [j.id, { ...j, added: 0, truncated: false }]));
  const rows: (typeof agentJobLogs.$inferInsert)[] = [];
  for (const e of entries) {
    if (!e.data) continue;
    if (e.jobId) {
      const j = jobMap.get(e.jobId);
      if (!j) continue;
      const size = Buffer.byteLength(e.data);
      if (j.logBytes + j.added + size > MAX_JOB_LOG_BYTES) {
        if (!j.truncated && j.logBytes + j.added < MAX_JOB_LOG_BYTES) {
          rows.push({ agentId: agent.id, jobId: e.jobId, stream: "system", data: "[output truncated — full log is in the job folder on the agent]\n" });
          j.added = MAX_JOB_LOG_BYTES;
        }
        j.truncated = true;
        continue;
      }
      j.added += size;
    }
    rows.push({ agentId: agent.id, jobId: e.jobId ?? null, stream: e.stream, data: e.data });
  }
  if (rows.length) await db.insert(agentJobLogs).values(rows);
  const now = new Date();
  for (const j of jobMap.values()) {
    if (!j.added) continue;
    await db
      .update(agentJobs)
      .set({ logBytes: Math.min(MAX_JOB_LOG_BYTES, j.logBytes + j.added), heartbeatAt: now })
      .where(eq(agentJobs.id, j.id));
  }
  if (rows.length) await signal({ type: "logs", agentId: agent.id });
  return jobs.filter((j) => j.cancelRequestedAt || !["assigned", "running"].includes(j.status)).map((j) => j.id);
}

export type JobCompletion = {
  status: "succeeded" | "failed" | "cancelled" | "timeout";
  text?: string | null;
  json?: unknown;
  citations?: AgentJobCitation[];
  model?: string | null;
  runtime?: "claude" | "codex" | null;
  cliVersion?: string | null;
  exitCode?: number | null;
  error?: string | null;
  durationMs?: number | null;
  usage?: Record<string, unknown> | null;
  /** Failure unrelated to the task itself (CLI missing, agent shutting down) → retry elsewhere. */
  retryable?: boolean;
};

export async function completeAgentJob(agent: AgentRow, jobId: string, result: JobCompletion): Promise<{ accepted: boolean; requeued: boolean }> {
  const job = await getJobForAgent(agent.id, jobId);
  if (!job) return { accepted: false, requeued: false };
  if (!["assigned", "running"].includes(job.status)) return { accepted: false, requeued: false };
  const now = new Date();
  const common = {
    runtimeUsed: result.runtime ?? job.runtimeUsed,
    cliVersion: result.cliVersion ?? job.cliVersion,
    model: result.model ?? job.model,
    exitCode: result.exitCode ?? null,
    durationMs: result.durationMs ?? (job.startedAt ? now.getTime() - job.startedAt.getTime() : null),
    usage: result.usage ?? null,
  };

  if (result.status === "failed" && result.retryable && !job.pinnedAgentId && job.attempts < job.maxAttempts && !job.cancelRequestedAt) {
    await requeueJob(job, agent.id, result.error ?? "Agent could not run the job");
    return { accepted: true, requeued: true };
  }

  const status = job.cancelRequestedAt && result.status !== "succeeded" ? "cancelled" : result.status;
  const updated = await db
    .update(agentJobs)
    .set({
      ...common,
      status,
      resultText: result.text ?? null,
      resultJson: result.json === undefined ? null : result.json,
      citations: result.citations ?? [],
      error:
        status === "succeeded"
          ? null
          : status === "cancelled" && job.cancelRequestedAt && job.error
            ? job.error
            : (result.error ?? (status === "timeout" ? "Timed out" : status === "cancelled" ? "Cancelled" : "Failed")),
      finishedAt: now,
    })
    .where(and(eq(agentJobs.id, jobId), eq(agentJobs.agentId, agent.id), inArray(agentJobs.status, ["assigned", "running"])))
    .returning({ id: agentJobs.id });
  if (!updated.length) return { accepted: false, requeued: false };

  const secs = common.durationMs != null ? ` in ${(common.durationMs / 1000).toFixed(1)}s` : "";
  if (job.kind === "test") {
    const ok = status === "succeeded";
    await logAgentEvent(agent.id, ok ? "test_passed" : "test_failed", ok ? `Self-test passed${secs}` : `Self-test failed: ${result.error ?? status}`, {
      jobId,
      level: ok ? "success" : "error",
      meta: { result: result.json ?? null },
    });
  } else if (status === "succeeded") {
    await logAgentEvent(agent.id, "job_succeeded", `Finished "${job.purpose}"${secs}`, { jobId, level: "success", meta: { durationMs: common.durationMs } });
  } else {
    await logAgentEvent(
      agent.id,
      `job_${status}`,
      `${status === "timeout" ? "Timed out" : status === "cancelled" ? "Cancelled" : "Failed"}: "${job.purpose}"${result.error && status === "failed" ? ` — ${result.error.slice(0, 300)}` : ""}`,
      { jobId, level: status === "failed" ? "error" : "warning" },
    );
  }
  await scrubJobSecrets(jobId);
  await signal({ type: "job-done", jobId });
  return { accepted: true, requeued: false };
}

/**
 * Removes short-lived MCP tokens and attachment data from finished jobs (defense in depth: tokens
 * expire anyway, attachments are large). Without `jobId` all finished jobs are scrubbed.
 */
export async function scrubJobSecrets(jobId?: string): Promise<void> {
  await db.execute(sql`
    UPDATE agent_jobs SET payload =
      CASE WHEN payload ? 'mcp' AND jsonb_typeof(payload->'mcp') = 'object'
        THEN jsonb_set(payload, '{mcp,token}', 'null'::jsonb) ELSE payload END
      - 'attachments'
      || CASE WHEN jsonb_typeof(payload->'attachments') = 'array'
        THEN jsonb_build_object('attachmentNames', COALESCE((SELECT jsonb_agg(a->>'name') FROM jsonb_array_elements(payload->'attachments') a), '[]'::jsonb))
        ELSE '{}'::jsonb END
    WHERE status IN ('succeeded', 'failed', 'cancelled', 'timeout')
      AND (payload->'mcp'->>'token' IS NOT NULL OR payload ? 'attachments')
      ${jobId ? sql`AND id = ${jobId}` : sql``}`);
}

export type ChatEventInput =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; id: string; name: string; input?: unknown }
  | { type: "tool_result"; id: string; output: string; isError?: boolean };

/** Stores structured chat events from the agent. Returns true when the job should be cancelled. */
export async function appendChatEvents(agent: AgentRow, jobId: string, events: ChatEventInput[]): Promise<{ ok: boolean; cancel: boolean }> {
  const job = await getJobForAgent(agent.id, jobId);
  if (!job || job.kind !== "chat") return { ok: false, cancel: true };
  if (!["assigned", "running"].includes(job.status)) return { ok: false, cancel: true };
  if (events.length) {
    await db.insert(agentChatEvents).values(events.map((e) => ({ jobId, type: e.type, data: e as Record<string, unknown> })));
    await db.update(agentJobs).set({ heartbeatAt: new Date() }).where(eq(agentJobs.id, jobId));
    await signal({ type: "chat", jobId });
  }
  return { ok: true, cancel: !!job.cancelRequestedAt };
}

/** Puts an unfinished job back into the queue (or fails it when no attempts are left). */
export async function requeueJob(job: AgentJobRow, fromAgentId: string | null, reason: string, opts: { countAttempt?: boolean } = {}): Promise<"requeued" | "failed"> {
  const attemptsLeft = job.attempts < job.maxAttempts || opts.countAttempt === false;
  // Only touch jobs that are still active (the agent may have completed it concurrently).
  const stillActive = and(eq(agentJobs.id, job.id), inArray(agentJobs.status, ["assigned", "running"]));
  if (!attemptsLeft) {
    const rows = await db
      .update(agentJobs)
      .set({ status: "failed", error: reason, finishedAt: new Date() })
      .where(stillActive)
      .returning({ id: agentJobs.id });
    if (!rows.length) return "failed";
    if (fromAgentId) await logAgentEvent(fromAgentId, job.kind === "test" ? "test_failed" : "job_failed", `Failed: "${job.purpose}" — ${reason}`, { jobId: job.id, level: "error" });
    await signal({ type: "job-done", jobId: job.id });
    return "failed";
  }
  const excluded = fromAgentId && !job.excludedAgentIds.includes(fromAgentId) ? [...job.excludedAgentIds, fromAgentId] : job.excludedAgentIds;
  const rows = await db
    .update(agentJobs)
    .set({
      status: "queued",
      agentId: null,
      assignedAt: null,
      startedAt: null,
      heartbeatAt: null,
      excludedAgentIds: excluded,
      queuedAt: new Date(),
      error: reason,
      attempts: opts.countAttempt === false ? Math.max(0, job.attempts - 1) : job.attempts,
    })
    .where(stillActive)
    .returning({ id: agentJobs.id });
  if (!rows.length) return "failed";
  if (fromAgentId) await logAgentEvent(fromAgentId, "job_requeued", `Requeued "${job.purpose}" — ${reason}`, { jobId: job.id, level: "warning" });
  await signal({ type: "job-new" });
  return "requeued";
}

/** Cancel from the dashboard (or a dispatcher that stopped waiting). */
export async function requestJobCancel(jobId: string, actorId?: string | null, reason = "Cancelled"): Promise<boolean> {
  const [job] = await db.select().from(agentJobs).where(eq(agentJobs.id, jobId)).limit(1);
  if (!job) return false;
  if (job.status === "queued") {
    await db
      .update(agentJobs)
      .set({ status: "cancelled", cancelRequestedAt: new Date(), cancelledBy: actorId ?? null, error: reason, finishedAt: new Date() })
      .where(and(eq(agentJobs.id, jobId), eq(agentJobs.status, "queued")));
    await scrubJobSecrets(jobId);
    await signal({ type: "job-done", jobId });
    return true;
  }
  if (job.status === "assigned" || job.status === "running") {
    await db
      .update(agentJobs)
      .set({ cancelRequestedAt: new Date(), cancelledBy: actorId ?? null, error: reason })
      .where(eq(agentJobs.id, jobId));
    await signal({ type: "job-cancel", jobId, agentId: job.agentId });
    return true;
  }
  return false;
}

/** Ids of this agent's active jobs with a pending cancel request. */
export async function pendingCancels(agentId: string): Promise<string[]> {
  const rows = await db
    .select({ id: agentJobs.id })
    .from(agentJobs)
    .where(and(eq(agentJobs.agentId, agentId), inArray(agentJobs.status, ["assigned", "running"]), isNotNull(agentJobs.cancelRequestedAt)));
  return rows.map((r) => r.id);
}

/**
 * Reconciles the agent's reported running jobs with the DB: jobs the server thinks are running on the
 * agent but the agent doesn't know about are requeued; jobs the agent runs that are no longer active
 * are returned so the agent stops them.
 */
export async function reconcileRunningJobs(agent: AgentRow, reported: string[]): Promise<string[]> {
  const active = await db
    .select()
    .from(agentJobs)
    .where(and(eq(agentJobs.agentId, agent.id), inArray(agentJobs.status, ["assigned", "running"])));
  const reportedSet = new Set(reported);
  const cutoff = Date.now() - 30_000;
  for (const job of active) {
    if (reportedSet.has(job.id)) continue;
    if ((job.assignedAt?.getTime() ?? 0) > cutoff) continue;
    await requeueJob(job, agent.id, "The agent restarted while running this job");
  }
  const activeIds = new Set(active.map((j) => j.id));
  const stop = reported.filter((id) => !activeIds.has(id));
  const cancels = active.filter((j) => j.cancelRequestedAt).map((j) => j.id);
  return [...new Set([...stop, ...cancels])];
}

/** Periodic maintenance: offline detection, lost jobs, timeouts, expiries. */
export async function sweepAgentJobs(): Promise<{ offline: number; requeued: number; timedOut: number; expired: number }> {
  const settings = await getSetting("agents");
  const threshold = new Date(Date.now() - offlineAfterSeconds(settings) * 1000);
  const stats = { offline: 0, requeued: 0, timedOut: 0, expired: 0 };

  // 1) Agents that stopped talking to us.
  const wentOffline = await db
    .update(agents)
    .set({ offlineSince: new Date(), runningJobs: 0, state: "idle" })
    .where(and(isNotNull(agents.firstCheckinAt), isNull(agents.offlineSince), lt(agents.lastSeenAt, threshold)))
    .returning({ id: agents.id, name: agents.name, lastSeenAt: agents.lastSeenAt });
  for (const a of wentOffline) {
    stats.offline++;
    await logAgentEvent(a.id, "offline", "Went offline (no check-in)", { level: "warning", meta: { lastSeenAt: a.lastSeenAt } });
    await signal({ type: "agent-changed", agentId: a.id });
  }

  // 2) Active jobs on offline agents → retry elsewhere (non-pinned) or fail.
  const offlineAgentIds = (
    await db
      .select({ id: agents.id })
      .from(agents)
      .where(or(isNull(agents.lastSeenAt), lt(agents.lastSeenAt, threshold)))
  ).map((r) => r.id);
  if (offlineAgentIds.length) {
    const lost = await db
      .select()
      .from(agentJobs)
      .where(and(inArray(agentJobs.status, ["assigned", "running"]), inArray(agentJobs.agentId, offlineAgentIds)));
    for (const job of lost) {
      const res = await requeueJob(job, job.agentId, "The agent went offline");
      if (res === "requeued") stats.requeued++;
    }
  }

  // 3) Running longer than their timeout (+ grace) → timeout; the agent kills the process on its side.
  const overdue = await db.execute(sql`
    SELECT id, agent_id FROM agent_jobs
    WHERE status = 'running' AND started_at IS NOT NULL
      AND started_at + ((timeout_ms + 60000) || ' milliseconds')::interval < now()`);
  for (const row of overdue as unknown as Array<{ id: string; agent_id: string | null }>) {
    const changed = await db
      .update(agentJobs)
      .set({ status: "timeout", error: "Timed out", finishedAt: new Date(), cancelRequestedAt: new Date() })
      .where(and(eq(agentJobs.id, row.id), eq(agentJobs.status, "running")))
      .returning({ id: agentJobs.id });
    if (!changed.length) continue;
    if (row.agent_id) await logAgentEvent(row.agent_id, "job_timeout", "Job timed out", { jobId: row.id, level: "warning" });
    await signal({ type: "job-done", jobId: row.id });
    stats.timedOut++;
  }

  // 4) Assigned but never started (agent crashed between claim and start).
  const stuck = await db
    .select()
    .from(agentJobs)
    .where(and(eq(agentJobs.status, "assigned"), lt(agentJobs.assignedAt, new Date(Date.now() - 120_000))));
  for (const job of stuck) {
    const res = await requeueJob(job, job.agentId, "The agent did not start the job");
    if (res === "requeued") stats.requeued++;
  }

  // 5) Cancel requests the agent never acknowledged.
  const staleCancels = await db
    .update(agentJobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(inArray(agentJobs.status, ["assigned", "running"]), lt(agentJobs.cancelRequestedAt, new Date(Date.now() - 90_000))))
    .returning({ id: agentJobs.id });
  for (const j of staleCancels) await signal({ type: "job-done", jobId: j.id });

  // 6) Queued jobs nobody picked up in time.
  const expired = await db
    .update(agentJobs)
    .set({ status: "failed", error: "No agent picked up the job in time", finishedAt: new Date() })
    .where(and(eq(agentJobs.status, "queued"), lt(agentJobs.expiresAt, new Date())))
    .returning({ id: agentJobs.id });
  for (const j of expired) await signal({ type: "job-done", jobId: j.id });
  stats.expired = expired.length;

  // 7) Tokens / attachment data of jobs that ended through any path.
  await scrubJobSecrets();
  return stats;
}

/** Retention for high-volume tables. */
export async function pruneAgentData(): Promise<void> {
  await db.execute(sql`DELETE FROM agent_job_logs WHERE job_id IS NULL AND created_at < now() - interval '3 days'`);
  await db.execute(sql`DELETE FROM agent_job_logs WHERE job_id IS NOT NULL AND created_at < now() - interval '14 days'`);
  await db.execute(sql`DELETE FROM agent_events WHERE created_at < now() - interval '90 days'`);
  await db.execute(sql`DELETE FROM agent_checkins WHERE created_at < now() - interval '90 days'`);
  await db.execute(sql`DELETE FROM agent_jobs WHERE finished_at < now() - interval '90 days'`);
  await db.execute(sql`DELETE FROM agent_chat_events WHERE created_at < now() - interval '7 days'`);
  // Unreferenced job logs of deleted agents are removed by FK cascade; orphaned job ids are harmless.
}

export async function activeJobIdsForAgent(agentId: string): Promise<string[]> {
  const rows = await db
    .select({ id: agentJobs.id })
    .from(agentJobs)
    .where(and(eq(agentJobs.agentId, agentId), inArray(agentJobs.status, ["assigned", "running"])));
  return rows.map((r) => r.id);
}

/** Requeue all unfinished jobs of an agent (used by Reinstall) without spending an attempt. */
export async function requeueAgentJobs(agentId: string, reason: string): Promise<number> {
  const rows = await db
    .select()
    .from(agentJobs)
    .where(and(eq(agentJobs.agentId, agentId), inArray(agentJobs.status, ["assigned", "running"])));
  let n = 0;
  for (const job of rows) {
    if (job.pinnedAgentId) {
      await db
        .update(agentJobs)
        .set({ status: "queued", agentId: null, assignedAt: null, startedAt: null, attempts: 0, queuedAt: new Date(), error: reason })
        .where(and(eq(agentJobs.id, job.id), inArray(agentJobs.status, ["assigned", "running"])));
    } else {
      await requeueJob(job, null, reason, { countAttempt: false });
    }
    n++;
  }
  if (n) await signal({ type: "job-new" });
  return n;
}

