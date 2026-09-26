// Schema for the "agents" module (local Claude Code / Codex agents). See docs/ARCHITECTURE.md.
import { pgTable, text, boolean, integer, bigint, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, ts } from "./_helpers";
import { users, workspaces } from "./core";

export type AgentRuntimeName = "claude" | "codex";
export type AgentRuntimeSetting = "claude" | "codex" | "detect";
export type AgentJobKind = "llm" | "web-search" | "chat" | "test";
/** auto = Full for chat/agentic jobs, Lean for bulk analysis; lean/full force one mode for every job. */
export type AgentCliProfile = "auto" | "lean" | "full";
export type AgentCliMode = "lean" | "full";

/** Flags the agent was started with on the machine (reported at every check-in). */
export type AgentLocalFlags = {
  runtime?: "claude" | "codex" | "detect";
  workDir?: string | null;
  maxParallel?: number | null;
  noAutoUpdate?: boolean;
  noAutostart?: boolean;
  autostart?: string | null;
  /** Local security policy (set by the machine owner at install; the server can't widen it). */
  allowFull?: boolean;
  allowCodexShell?: boolean;
  allowRemoteWorkdir?: boolean;
  mcpServers?: string | null;
};

/** Pending control commands delivered with the next check-in. */
export type AgentCommand = {
  id: string;
  type: "cleanup";
  /** Delete finished job folders older than this (0 = all finished). */
  maxAgeHours: number;
  /** true for the scheduled auto-cleanup, false for the dashboard button. */
  auto?: boolean;
  requestedAt: string;
  requestedBy?: string | null;
};

/**
 * One row per installed agent (a machine running `agent.mjs`). Only the SHA-256 of the agent token
 * is stored; the plaintext token is shown once in the install dialog.
 */
export const agents = pgTable(
  "agents",
  {
    id: id("agt"),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Optional owner (the person whose machine this is). */
    userId: text().references(() => users.id, { onDelete: "set null" }),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    name: text().notNull(),
    labels: jsonb().$type<string[]>().notNull().default([]),
    tokenHash: text().notNull(),
    /** First characters of the token (safe to display, helps identifying installs). */
    tokenPrefix: text().notNull(),
    tokenIssuedAt: ts().notNull().defaultNow(),
    reinstallCount: integer().notNull().default(0),

    /* ── settings (applied on next check-in) ── */
    /** Paused agents check in but receive no jobs. */
    enabled: boolean().notNull().default(true),
    /** null = use the agent's local `--runtime` flag. */
    runtime: text({ enum: ["claude", "codex", "detect"] }),
    /** null = local `--workdir` → instance default → OS temp dir. */
    workDir: text(),
    /** null = local `--max-parallel` → instance default. */
    maxParallel: integer(),
    autoUpdate: boolean().notNull().default(true),
    allowedKinds: jsonb().$type<AgentJobKind[]>().notNull().default(["llm", "web-search", "chat", "test"]),
    /**
     * CLI mode. lean = no user MCP servers/plugins/CLAUDE.md (fast, cheap); full = the user's CLI config
     * incl. MCP servers; auto = full for chat & agentic jobs, lean for bulk analysis.
     */
    cliProfile: text({ enum: ["auto", "lean", "full"] })
      .notNull()
      .default("auto"),
    /** Instance-wide agent: may serve AI work of every workspace (admin only). */
    shared: boolean().notNull().default(false),

    /* ── reported by the agent ── */
    agentVersion: text(),
    hostname: text(),
    os: text(),
    osRelease: text(),
    arch: text(),
    nodeVersion: text(),
    claudeVersion: text(),
    codexVersion: text(),
    /** Runtime the agent actually uses (after resolving settings / detection). */
    effectiveRuntime: text({ enum: ["claude", "codex"] }),
    localFlags: jsonb().$type<AgentLocalFlags>().notNull().default({}),
    effectiveWorkDir: text(),
    effectiveMaxParallel: integer(),
    runningJobs: integer().notNull().default(0),
    workDirBytes: bigint({ mode: "number" }),
    state: text({ enum: ["idle", "busy", "updating", "stopping"] })
      .notNull()
      .default("idle"),
    lastIp: text(),
    firstCheckinAt: ts(),
    lastCheckinAt: ts(),
    /** Updated by every authenticated agent request (check-in, long-poll, logs). */
    lastSeenAt: ts(),
    /** Set when the server noticed the agent went offline (cleared on next check-in). */
    offlineSince: ts(),

    /* ── update / maintenance ── */
    updateRequestedAt: ts(),
    updateRequestedBy: text(),
    updatingToVersion: text(),
    updateStartedAt: ts(),
    lastUpdatedAt: ts(),
    commands: jsonb().$type<AgentCommand[]>().notNull().default([]),
    lastCleanupAt: ts(),
    lastCleanupFreedBytes: bigint({ mode: "number" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("agents_token_uq").on(t.tokenHash),
    index("agents_workspace_idx").on(t.workspaceId),
    index("agents_seen_idx").on(t.lastSeenAt),
  ],
);

/** Version/environment history — one row whenever the reported environment changes (or hourly). */
export const agentCheckins = pgTable(
  "agent_checkins",
  {
    id: id("ack"),
    agentId: text()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    agentVersion: text(),
    hostname: text(),
    os: text(),
    osRelease: text(),
    arch: text(),
    nodeVersion: text(),
    claudeVersion: text(),
    codexVersion: text(),
    effectiveRuntime: text(),
    runningJobs: integer().notNull().default(0),
    ip: text(),
    fingerprint: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("agent_checkins_agent_idx").on(t.agentId, t.createdAt)],
);

export type AgentChatMessage = { role: "user" | "assistant"; content: string };
export type AgentJobAttachment = { name: string; mimeType: string; dataBase64: string };

export type AgentJobPayload = {
  system?: string;
  prompt?: string;
  jsonSchema?: Record<string, unknown>;
  webSearch?: boolean;
  /** CLI mode for agents in Auto mode (resolved from kind/purpose/caller hint when the job is created). */
  mode?: AgentCliMode;
  /** Chat jobs: transcript (replayed into the new CLI session). */
  messages?: AgentChatMessage[];
  /** Chat jobs: AutoSEO MCP server (short-lived token; scrubbed when the job ends). */
  mcp?: { url: string; token: string | null } | null;
  /** Chat jobs: files written into the job folder (data removed when the job ends). */
  attachments?: AgentJobAttachment[];
  /** Kept after the attachment data was scrubbed. */
  attachmentNames?: string[];
  /** Self-test: which runtimes to probe (default: the agent's effective runtime). */
  testRuntimes?: AgentRuntimeName[];
  model?: string;
};

export type AgentJobCitation = { url: string; title?: string };

/** Work items executed by agents. Every attempt runs as a fresh CLI session in its own folder. */
export const agentJobs = pgTable(
  "agent_jobs",
  {
    id: id("ajb"),
    workspaceId: text().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text(),
    userId: text(),
    kind: text({ enum: ["llm", "web-search", "chat", "test"] }).notNull(),
    purpose: text().notNull(),
    /** Requested CLI ("any" lets the agent use its effective runtime). */
    runtime: text({ enum: ["claude", "codex", "any"] })
      .notNull()
      .default("any"),
    payload: jsonb().$type<AgentJobPayload>().notNull().default({}),
    /** Pinned jobs only ever run on this agent (self-tests). */
    pinnedAgentId: text().references(() => agents.id, { onDelete: "cascade" }),
    /** Agent currently (or last) executing the job. */
    agentId: text().references(() => agents.id, { onDelete: "set null" }),
    /** Agents that already failed/lost this job (retries prefer others). */
    excludedAgentIds: jsonb().$type<string[]>().notNull().default([]),
    status: text({ enum: ["queued", "assigned", "running", "succeeded", "failed", "cancelled", "timeout"] })
      .notNull()
      .default("queued"),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(2),
    timeoutMs: integer().notNull(),
    /** Jobs not picked up before this moment are failed (caller falls back to API providers). */
    expiresAt: ts(),
    cancelRequestedAt: ts(),
    cancelledBy: text(),

    runtimeUsed: text({ enum: ["claude", "codex"] }),
    /** CLI mode the agent actually used. */
    cliMode: text({ enum: ["lean", "full"] }),
    cliVersion: text(),
    model: text(),
    workDir: text(),
    resultText: text(),
    resultJson: jsonb().$type<unknown>(),
    citations: jsonb().$type<AgentJobCitation[]>().notNull().default([]),
    usage: jsonb().$type<Record<string, unknown>>(),
    exitCode: integer(),
    error: text(),
    logBytes: integer().notNull().default(0),
    durationMs: integer(),

    queuedAt: ts().notNull().defaultNow(),
    assignedAt: ts(),
    startedAt: ts(),
    heartbeatAt: ts(),
    finishedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("agent_jobs_pick_idx").on(t.status, t.queuedAt),
    index("agent_jobs_agent_idx").on(t.agentId, t.createdAt),
    index("agent_jobs_pinned_idx").on(t.pinnedAgentId),
    index("agent_jobs_workspace_idx").on(t.workspaceId, t.createdAt),
  ],
);

/**
 * Live output (job stdout/stderr and agent log lines), chunked. `seq` gives a global order used as
 * SSE cursor. Pruned by the maintenance schedule.
 */
export const agentJobLogs = pgTable(
  "agent_job_logs",
  {
    seq: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    agentId: text()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** null = agent-level log line (not tied to a job). */
    jobId: text(),
    stream: text({ enum: ["stdout", "stderr", "agent", "system"] }).notNull(),
    data: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("agent_job_logs_agent_idx").on(t.agentId, t.seq), index("agent_job_logs_job_idx").on(t.jobId, t.seq)],
);

/** Structured chat events (text/thinking deltas, tool calls/results) of `chat` jobs, in order. */
export const agentChatEvents = pgTable(
  "agent_chat_events",
  {
    seq: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobId: text()
      .notNull()
      .references(() => agentJobs.id, { onDelete: "cascade" }),
    type: text({ enum: ["text", "thinking", "tool_call", "tool_result"] }).notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("agent_chat_events_job_idx").on(t.jobId, t.seq)],
);

/** Activity log per agent (and per job). */
export const agentEvents = pgTable(
  "agent_events",
  {
    id: id("aev"),
    agentId: text()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    jobId: text(),
    type: text().notNull(),
    level: text({ enum: ["info", "success", "warning", "error"] })
      .notNull()
      .default("info"),
    message: text().notNull(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    actorId: text(),
    createdAt: createdAt(),
  },
  (t) => [index("agent_events_agent_idx").on(t.agentId, t.createdAt), index("agent_events_job_idx").on(t.jobId)],
);
