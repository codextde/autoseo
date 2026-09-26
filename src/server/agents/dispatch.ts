import "server-only";
import { and, asc, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { agentChatEvents, agentJobs, agents, projects } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { autoJobMode, offlineAfterSeconds } from "./core";
import { createAgentJob, requestJobCancel } from "./jobs";
import { normalizeJsonSchema } from "./json-schema";
import { waitForSignal } from "./notify";

/**
 * Contract between AI features and the local agent system (Claude Code / Codex running on
 * users' machines). Implemented by the agents module — see docs/ARCHITECTURE.md.
 */
export type AgentRuntime = "claude" | "codex";

export type AgentLlmTask = {
  /** Short label shown in the agent activity log, e.g. "sentiment_extraction". */
  purpose: string;
  system?: string;
  prompt: string;
  /** JSON schema the final answer must follow (agent is instructed to answer with JSON only). */
  jsonSchema?: Record<string, unknown>;
  /** Allow the CLI to use web search (answers with citations). */
  webSearch?: boolean;
  /** Preferred CLI. "any" lets the dispatcher choose (respects per-agent settings). */
  runtime?: AgentRuntime | "any";
  /**
   * CLI mode hint for agents in Auto mode: "full" loads the machine's MCP servers & config (agentic
   * work), "lean" skips them (bulk analysis). Omitted → derived from the job purpose.
   */
  mode?: "lean" | "full";
  timeoutMs: number;
  projectId?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
};

export type AgentLlmResult = {
  text: string;
  runtime: AgentRuntime;
  agentId: string;
  jobId: string;
  model?: string;
  citations?: { url: string; title?: string }[];
  durationMs: number;
};

/** How long a dispatcher waits for an eligible agent to come online before giving up. */
const ONLINE_GRACE_MS = 4_000;
/** Without API fallback, queued work may wait for a busy agent much longer than with one. */
const PICKUP_TIMEOUT_WITH_FALLBACK_MS = 45_000;

type Eligibility = {
  runtime?: AgentRuntime | "any";
  workspaceId?: string | null;
  kind?: "llm" | "web-search" | "chat";
  readyOnly?: boolean;
  /** Personal jobs (chat / Full mode): only agents owned by this user. */
  ownerUserId?: string | null;
  /** Status hint only: count agents of every workspace when no workspace is known. */
  anyWorkspace?: boolean;
};

async function countEligibleOnline(opts: Eligibility): Promise<number> {
  const settings = await getSetting("agents");
  if (!settings.enabled) return 0;
  const since = new Date(Date.now() - offlineAfterSeconds(settings) * 1000);
  const conditions = [eq(agents.enabled, true), isNotNull(agents.lastSeenAt), gt(agents.lastSeenAt, since), isNotNull(agents.firstCheckinAt)];
  if (opts.kind) conditions.push(sql`${agents.allowedKinds} @> ${JSON.stringify([opts.kind])}::jsonb`);
  if (opts.runtime === "claude") conditions.push(isNotNull(agents.claudeVersion));
  else if (opts.runtime === "codex") conditions.push(isNotNull(agents.codexVersion));
  else conditions.push(or(isNotNull(agents.claudeVersion), isNotNull(agents.codexVersion))!);
  if (opts.workspaceId) conditions.push(or(eq(agents.workspaceId, opts.workspaceId), eq(agents.shared, true))!);
  // Instance-level work (no workspace) may only run on agents an admin marked as shared.
  else if (!opts.anyWorkspace) conditions.push(eq(agents.shared, true));
  if (opts.ownerUserId) conditions.push(eq(agents.userId, opts.ownerUserId));
  // Agents installing an update (draining) or shutting down take no new work.
  if (opts.readyOnly) conditions.push(sql`${agents.state} not in ('updating', 'stopping')`);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agents)
    .where(and(...conditions));
  return row?.n ?? 0;
}

/** True when at least one enabled agent checked in recently (optionally supporting a runtime). */
export async function hasOnlineAgent(
  runtime?: AgentRuntime | "any",
  opts: { workspaceId?: string | null; projectId?: string | null; kind?: "llm" | "web-search" | "chat"; userId?: string | null } = {},
): Promise<boolean> {
  const workspaceId = opts.workspaceId ?? (opts.projectId ? await projectWorkspace(opts.projectId) : null);
  return (
    (await countEligibleOnline({
      runtime,
      workspaceId,
      kind: opts.kind,
      readyOnly: opts.kind === "chat",
      ownerUserId: opts.kind === "chat" ? (opts.userId ?? "__none__") : undefined,
      anyWorkspace: !workspaceId && !opts.kind,
    })) > 0
  );
}

/**
 * True when one of `userId`'s own agents could take a personal job right now — same rules as the job
 * claim: agent enabled (and agents enabled instance-wide), checked in recently, `kind` allowed, owned by
 * the user, in the job's workspace (or shared), the requested CLI installed, not updating/stopping.
 */
export async function hasOnlineOwnAgent(opts: {
  userId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  kind: "llm" | "web-search" | "chat";
  runtime?: AgentRuntime | "any";
}): Promise<boolean> {
  if (!opts.userId) return false;
  const workspaceId = opts.workspaceId ?? (opts.projectId ? await projectWorkspace(opts.projectId) : null);
  return (await countEligibleOnline({ runtime: opts.runtime ?? "any", workspaceId, kind: opts.kind, readyOnly: true, ownerUserId: opts.userId })) > 0;
}

async function projectWorkspace(projectId: string): Promise<string | null> {
  const [p] = await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  return p?.workspaceId ?? null;
}

async function hasApiFallback(): Promise<boolean> {
  const ai = await getSetting("ai");
  return !!(ai.anthropicApiKey || ai.openaiApiKey || ai.openrouterApiKey);
}

export class AgentJobError extends Error {
  constructor(
    message: string,
    public jobId: string,
    public status: string,
  ) {
    super(message);
  }
}

/**
 * Runs an LLM task on an online local agent and waits for the result.
 * Returns null when no agent is available or the agent did not answer in time.
 * Throws when the agent ran the task but the CLI failed (callers fall back to API providers).
 */
export async function dispatchAgentLlm(task: AgentLlmTask): Promise<AgentLlmResult | null> {
  const settings = await getSetting("agents");
  if (!settings.enabled) return null;
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(10_000, task.timeoutMs);
  const kind = task.webSearch ? "web-search" : "llm";
  const workspaceId = task.workspaceId ?? (task.projectId ? await projectWorkspace(task.projectId) : null);
  const runtime = task.runtime ?? "any";
  const eligibility: Eligibility = { runtime, workspaceId, kind };
  // Full mode is personal: only when the requesting user's own agent is online; otherwise Lean pool.
  let mode = autoJobMode(kind, task.purpose, task.mode);
  if (mode === "full" && !(task.userId && (await countEligibleOnline({ ...eligibility, ownerUserId: task.userId, readyOnly: true })))) mode = "lean";

  // 1) Is anybody there? Short grace period for agents that are just reconnecting.
  let online = await countEligibleOnline(eligibility);
  const graceUntil = Date.now() + ONLINE_GRACE_MS;
  while (!online && Date.now() < graceUntil) {
    await new Promise((r) => setTimeout(r, 1_000));
    online = await countEligibleOnline(eligibility);
  }
  if (!online) return null;
  const fallback = await hasApiFallback();
  // Every eligible agent is busy updating/stopping: answer via API right away when possible.
  if (fallback && !(await countEligibleOnline({ ...eligibility, readyOnly: true }))) return null;

  // 2) Enqueue. Pickup expiry keeps callers from waiting forever behind a saturated agent when an
  //    API provider could answer instead.
  const pickupMs = fallback ? Math.min(PICKUP_TIMEOUT_WITH_FALLBACK_MS, deadline - Date.now()) : deadline - Date.now();
  const job = await createAgentJob({
    kind,
    purpose: task.purpose,
    payload: {
      system: task.system,
      prompt: task.prompt,
      // CLI validators reject some keywords zod emits ($schema, format…); callers validate with zod anyway.
      jsonSchema: task.jsonSchema ? (normalizeJsonSchema(task.jsonSchema) ?? undefined) : undefined,
      webSearch: !!task.webSearch,
      mode,
    },
    runtime,
    workspaceId,
    projectId: task.projectId ?? null,
    userId: task.userId ?? null,
    timeoutMs: Math.min(deadline - Date.now(), settings.jobTimeoutMinutes * 60_000),
    expiresAt: new Date(Date.now() + Math.max(5_000, pickupMs)),
  });

  // 3) Wait for completion (NOTIFY wake-ups + periodic DB checks).
  while (true) {
    const [row] = await db.select().from(agentJobs).where(eq(agentJobs.id, job.id)).limit(1);
    if (!row) throw new AgentJobError("The agent job was removed", job.id, "deleted");
    if (row.status === "succeeded") {
      return {
        text: row.resultText ?? (row.resultJson != null ? JSON.stringify(row.resultJson) : ""),
        runtime: (row.runtimeUsed ?? "claude") as AgentRuntime,
        agentId: row.agentId ?? "",
        jobId: row.id,
        model: row.model ?? undefined,
        citations: row.citations ?? [],
        durationMs: row.durationMs ?? Date.now() - startedAt,
      };
    }
    if (row.status === "failed" && !row.assignedAt && row.error === "No agent picked up the job in time") return null;
    if (row.status === "failed" || row.status === "timeout" || row.status === "cancelled") {
      throw new AgentJobError(`Local agent ${row.status === "failed" ? "failed" : row.status === "timeout" ? "timed out" : "job was cancelled"}: ${row.error ?? row.status}`, row.id, row.status);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      await requestJobCancel(job.id, null, "The caller stopped waiting (timeout)");
      return null;
    }
    if (row.status === "queued" && row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      await requestJobCancel(job.id, null, "No agent picked up the job in time");
      return null;
    }
    await waitForSignal((s) => s.type === "job-done" && s.jobId === job.id, Math.min(remaining, 2_000));
  }
}

/* ───────────────────────────── Interactive chat (streaming) ─────────────────────────────
 * Contract used by the Agent chat mode. Implemented by the agents module: a "chat" job runs a
 * fresh CLI session (Claude Code / Codex) with the AutoSEO MCP server (short-lived, project-scoped
 * token) plus the machine's own MCP servers, and streams structured events back.
 */

export type AgentChatEvent =
  | { type: "status"; status: "queued" | "assigned" | "running"; agentId?: string; agentName?: string; runtime?: AgentRuntime }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; output: string; isError?: boolean }
  | { type: "done"; text: string; jobId: string; durationMs: number; model?: string }
  | { type: "error"; message: string };

export type AgentChatTask = {
  purpose: string;
  system?: string;
  /** Full transcript (each job is a new CLI session, so history is replayed). */
  messages: { role: "user" | "assistant"; content: string }[];
  runtime?: AgentRuntime | "any";
  /** AutoSEO MCP server the CLI should connect to (URL + short-lived bearer token). */
  mcp?: { url: string; token: string } | null;
  /** Attachments saved by the chat module, passed as local files to the CLI job folder. */
  attachments?: { name: string; mimeType: string; dataBase64: string }[];
  webSearch?: boolean;
  timeoutMs: number;
  projectId?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
};

/** Max. total size of chat attachments (base64) carried in one job. */
const MAX_CHAT_ATTACHMENT_CHARS = 20 * 1024 * 1024;

/**
 * Runs an interactive chat turn on an online local agent (fresh CLI session, Full mode by default,
 * AutoSEO MCP server attached) and streams structured events. Returns null when no eligible agent is
 * online. The stream ends with exactly one `done` or `error` event. Aborting `signal` (or stopping the
 * iteration early) cancels the job and stops the CLI on the agent.
 */
export async function dispatchAgentChat(task: AgentChatTask, signal?: AbortSignal): Promise<AsyncIterable<AgentChatEvent> | null> {
  const settings = await getSetting("agents");
  if (!settings.enabled || signal?.aborted) return null;
  const workspaceId = task.workspaceId ?? (task.projectId ? await projectWorkspace(task.projectId) : null);
  const runtime = task.runtime ?? "any";
  if (!task.userId) throw new Error("Agent chat needs the requesting user: chat turns only run on that user's own local agent.");
  const eligibility: Eligibility = { runtime, workspaceId, kind: "chat", readyOnly: true, ownerUserId: task.userId };
  let online = await countEligibleOnline(eligibility);
  const graceUntil = Date.now() + ONLINE_GRACE_MS;
  while (!online && Date.now() < graceUntil && !signal?.aborted) {
    await new Promise((r) => setTimeout(r, 1_000));
    online = await countEligibleOnline(eligibility);
  }
  if (!online || signal?.aborted) return null;
  if (!task.messages.length || task.messages.at(-1)?.role !== "user") throw new Error("The chat transcript must end with a user message.");
  const attachmentChars = (task.attachments ?? []).reduce((n, a) => n + a.dataBase64.length, 0);
  if (attachmentChars > MAX_CHAT_ATTACHMENT_CHARS) throw new Error("Attachments are too large for a local agent job (max. 15 MB).");

  const startedAt = Date.now();
  const deadline = startedAt + Math.max(10_000, task.timeoutMs);
  const fallback = await hasApiFallback();
  const pickupMs = fallback ? Math.min(PICKUP_TIMEOUT_WITH_FALLBACK_MS, deadline - Date.now()) : deadline - Date.now();
  const job = await createAgentJob({
    kind: "chat",
    purpose: task.purpose,
    payload: {
      system: task.system,
      messages: task.messages,
      mcp: task.mcp ?? null,
      attachments: task.attachments ?? [],
      webSearch: !!task.webSearch,
      mode: "full",
    },
    runtime,
    workspaceId,
    projectId: task.projectId ?? null,
    userId: task.userId ?? null,
    // A retry would replay already-streamed output, so chat turns are never retried.
    maxAttempts: 1,
    timeoutMs: Math.min(deadline - Date.now(), settings.jobTimeoutMinutes * 60_000),
    expiresAt: new Date(Date.now() + Math.max(5_000, pickupMs)),
  });

  async function* stream(): AsyncGenerator<AgentChatEvent> {
    let cursor = 0;
    let lastStatus = "";
    let finished = false;
    const onAbort = () => void requestJobCancel(job.id, task.userId ?? null, "Stopped by the user");
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      while (true) {
        if (signal?.aborted) {
          finished = true;
          yield { type: "error", message: "Cancelled" };
          return;
        }
        // Status first, then events: when the job is final, every event it produced is already stored.
        const [row] = await db.select().from(agentJobs).where(eq(agentJobs.id, job.id)).limit(1);
        if (!row) {
          finished = true;
          yield { type: "error", message: "The agent job was removed." };
          return;
        }
        if ((row.status === "queued" || row.status === "assigned" || row.status === "running") && row.status !== lastStatus) {
          lastStatus = row.status;
          let agentName: string | undefined;
          if (row.agentId) {
            const [a] = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, row.agentId)).limit(1);
            agentName = a?.name;
          }
          yield {
            type: "status",
            status: row.status,
            agentId: row.agentId ?? undefined,
            agentName,
            runtime: (row.runtimeUsed ?? undefined) as AgentRuntime | undefined,
          };
        }
        const events = await db
          .select()
          .from(agentChatEvents)
          .where(and(eq(agentChatEvents.jobId, job.id), gt(agentChatEvents.seq, cursor)))
          .orderBy(asc(agentChatEvents.seq))
          .limit(1000);
        for (const e of events) {
          cursor = e.seq;
          yield toChatEvent(e.type, e.data);
        }
        if (events.length === 1000) continue;
        if (row.status === "succeeded") {
          finished = true;
          yield {
            type: "done",
            text: row.resultText ?? "",
            jobId: row.id,
            durationMs: row.durationMs ?? Date.now() - startedAt,
            model: row.model ?? undefined,
          };
          return;
        }
        if (row.status === "failed" || row.status === "timeout" || row.status === "cancelled") {
          finished = true;
          const reason = row.status === "timeout" ? "The local agent timed out." : row.status === "cancelled" ? "Cancelled" : (row.error ?? "The local agent failed.");
          yield { type: "error", message: reason };
          return;
        }
        if (Date.now() > deadline) {
          await requestJobCancel(job.id, null, "The chat turn timed out");
          finished = true;
          yield { type: "error", message: "The local agent did not finish in time." };
          return;
        }
        if (row.status === "queued" && row.expiresAt && row.expiresAt.getTime() < Date.now()) {
          await requestJobCancel(job.id, null, "No agent picked up the chat in time");
          finished = true;
          yield { type: "error", message: "No local agent picked up the chat in time." };
          return;
        }
        await waitForSignal(
          (s) => (s.type === "chat" && s.jobId === job.id) || (s.type === "job-done" && s.jobId === job.id),
          Math.min(1_000, Math.max(0, deadline - Date.now())),
          signal,
        );
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      // Consumer stopped early (e.g. HTTP client went away) → stop the CLI too.
      if (!finished) await requestJobCancel(job.id, task.userId ?? null, "The chat stream was closed").catch(() => false);
    }
  }

  return stream();
}

function toChatEvent(type: string, data: Record<string, unknown>): AgentChatEvent {
  switch (type) {
    case "text":
      return { type: "text", delta: String(data.delta ?? "") };
    case "thinking":
      return { type: "thinking", delta: String(data.delta ?? "") };
    case "tool_call":
      return { type: "tool_call", id: String(data.id ?? ""), name: String(data.name ?? "tool"), input: data.input ?? null };
    default:
      return { type: "tool_result", id: String(data.id ?? ""), output: String(data.output ?? ""), isError: data.isError === true };
  }
}
