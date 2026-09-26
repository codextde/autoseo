import "server-only";
import { and, asc, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { agentCheckins, agentEvents, agentJobLogs, agentJobs, agents, users, workspaces } from "@/server/db/schema";
import type { UserContext } from "@/server/auth/context";
import { getSetting } from "@/server/settings";
import { agentStatus, type AgentRow, type AgentStatus } from "./core";
import { getAgentRuntimeInfo } from "./runtime";
import { manageableWorkspaceIds } from "./service";

/** Serializable agent view for client components. */
export type AgentView = {
  id: string;
  name: string;
  labels: string[];
  workspaceId: string;
  workspaceName: string | null;
  ownerName: string | null;
  status: AgentStatus;
  enabled: boolean;
  runtimeSetting: "claude" | "codex" | "detect" | null;
  effectiveRuntime: "claude" | "codex" | null;
  cliProfile: "auto" | "lean" | "full";
  workDir: string | null;
  effectiveWorkDir: string | null;
  maxParallel: number | null;
  effectiveMaxParallel: number | null;
  autoUpdate: boolean;
  allowedKinds: string[];
  shared: boolean;
  hostname: string | null;
  os: string | null;
  osRelease: string | null;
  arch: string | null;
  nodeVersion: string | null;
  claudeVersion: string | null;
  codexVersion: string | null;
  agentVersion: string | null;
  latestVersion: string | null;
  outdated: boolean;
  localFlags: AgentRow["localFlags"];
  state: AgentRow["state"];
  runningJobs: number;
  workDirBytes: number | null;
  tokenPrefix: string;
  tokenIssuedAt: string;
  reinstallCount: number;
  lastCheckinAt: string | null;
  lastSeenAt: string | null;
  firstCheckinAt: string | null;
  lastIp: string | null;
  updateRequestedAt: string | null;
  updatingToVersion: string | null;
  lastUpdatedAt: string | null;
  lastCleanupAt: string | null;
  lastCleanupFreedBytes: number | null;
  pendingCleanup: boolean;
  createdAt: string;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function toAgentView(
  rows: AgentRow[],
  extra: { workspaces?: Map<string, string>; owners?: Map<string, string> } = {},
): Promise<AgentView[]> {
  const settings = await getSetting("agents");
  const latest = getAgentRuntimeInfo()?.version ?? null;
  const now = Date.now();
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    labels: a.labels ?? [],
    workspaceId: a.workspaceId,
    workspaceName: extra.workspaces?.get(a.workspaceId) ?? null,
    ownerName: a.userId ? (extra.owners?.get(a.userId) ?? null) : null,
    status: agentStatus(a, settings, now),
    enabled: a.enabled,
    runtimeSetting: a.runtime ?? null,
    effectiveRuntime: a.effectiveRuntime ?? null,
    cliProfile: a.cliProfile,
    workDir: a.workDir,
    effectiveWorkDir: a.effectiveWorkDir,
    maxParallel: a.maxParallel,
    effectiveMaxParallel: a.effectiveMaxParallel,
    autoUpdate: a.autoUpdate,
    allowedKinds: a.allowedKinds,
    shared: a.shared,
    hostname: a.hostname,
    os: a.os,
    osRelease: a.osRelease,
    arch: a.arch,
    nodeVersion: a.nodeVersion,
    claudeVersion: a.claudeVersion,
    codexVersion: a.codexVersion,
    agentVersion: a.agentVersion,
    latestVersion: latest,
    outdated: !!(a.agentVersion && latest && a.agentVersion !== latest),
    localFlags: a.localFlags ?? {},
    state: a.state,
    runningJobs: a.runningJobs,
    workDirBytes: a.workDirBytes,
    tokenPrefix: a.tokenPrefix,
    tokenIssuedAt: a.tokenIssuedAt.toISOString(),
    reinstallCount: a.reinstallCount,
    lastCheckinAt: iso(a.lastCheckinAt),
    lastSeenAt: iso(a.lastSeenAt),
    firstCheckinAt: iso(a.firstCheckinAt),
    lastIp: a.lastIp,
    updateRequestedAt: iso(a.updateRequestedAt),
    updatingToVersion: a.updatingToVersion,
    lastUpdatedAt: iso(a.lastUpdatedAt),
    lastCleanupAt: iso(a.lastCleanupAt),
    lastCleanupFreedBytes: a.lastCleanupFreedBytes,
    pendingCleanup: (a.commands ?? []).some((c) => c.type === "cleanup" && !c.auto),
    createdAt: a.createdAt.toISOString(),
  }));
}

async function lookupMaps(rows: AgentRow[]) {
  const wsIds = [...new Set(rows.map((r) => r.workspaceId))];
  const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
  const [ws, us] = await Promise.all([
    wsIds.length ? db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).where(inArray(workspaces.id, wsIds)) : [],
    userIds.length ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds)) : [],
  ]);
  return {
    workspaces: new Map(ws.map((w) => [w.id, w.name])),
    owners: new Map(us.map((u) => [u.id, u.name || u.email])),
  };
}

/** Agents the user may manage (all agents for instance admins when `all` is set). */
export async function listAgentsForUser(ctx: UserContext, opts: { all?: boolean } = {}): Promise<AgentView[]> {
  const wsIds = manageableWorkspaceIds(ctx);
  let rows: AgentRow[];
  if (opts.all && ctx.isInstanceAdmin) rows = await db.select().from(agents).orderBy(asc(agents.name));
  else if (!wsIds.length) rows = [];
  else rows = await db.select().from(agents).where(inArray(agents.workspaceId, wsIds)).orderBy(asc(agents.name));
  return toAgentView(rows, await lookupMaps(rows));
}

export async function getAgentView(agent: AgentRow): Promise<AgentView> {
  const [view] = await toAgentView([agent], await lookupMaps([agent]));
  return view!;
}

export type AgentJobView = {
  id: string;
  kind: string;
  purpose: string;
  status: string;
  runtime: string;
  runtimeUsed: string | null;
  cliMode: string | null;
  requestedMode: string | null;
  cliVersion: string | null;
  model: string | null;
  attempts: number;
  maxAttempts: number;
  pinned: boolean;
  projectId: string | null;
  durationMs: number | null;
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  cancelRequested: boolean;
  citations: number;
};

function toJobView(j: typeof agentJobs.$inferSelect): AgentJobView {
  return {
    id: j.id,
    kind: j.kind,
    purpose: j.purpose,
    status: j.status,
    runtime: j.runtime,
    runtimeUsed: j.runtimeUsed,
    cliMode: j.cliMode,
    requestedMode: j.payload?.mode ?? null,
    cliVersion: j.cliVersion,
    model: j.model,
    attempts: j.attempts,
    maxAttempts: j.maxAttempts,
    pinned: !!j.pinnedAgentId,
    projectId: j.projectId,
    durationMs: j.durationMs ?? (j.startedAt && !j.finishedAt ? Date.now() - j.startedAt.getTime() : null),
    error: j.error,
    queuedAt: j.queuedAt.toISOString(),
    startedAt: iso(j.startedAt),
    finishedAt: iso(j.finishedAt),
    createdAt: j.createdAt.toISOString(),
    cancelRequested: !!j.cancelRequestedAt,
    citations: j.citations?.length ?? 0,
  };
}

export async function listAgentJobs(
  agentId: string,
  opts: { status?: string[]; kind?: string[]; limit?: number } = {},
): Promise<AgentJobView[]> {
  const conds: SQL[] = [sql`(${agentJobs.agentId} = ${agentId} OR ${agentJobs.pinnedAgentId} = ${agentId})`];
  if (opts.status?.length) conds.push(inArray(agentJobs.status, opts.status as (typeof agentJobs.$inferSelect)["status"][]));
  if (opts.kind?.length) conds.push(inArray(agentJobs.kind, opts.kind as (typeof agentJobs.$inferSelect)["kind"][]));
  const rows = await db
    .select()
    .from(agentJobs)
    .where(and(...conds))
    .orderBy(desc(agentJobs.createdAt))
    .limit(Math.min(opts.limit ?? 200, 1000));
  return rows.map(toJobView);
}

export type AgentJobStats = { total24h: number; succeeded24h: number; failed24h: number; avgDurationMs: number | null; running: number; queued: number };

export async function agentJobStats(agentId: string): Promise<AgentJobStats> {
  const since = sql`${new Date(Date.now() - 24 * 3_600_000).toISOString()}::timestamptz`;
  const [row] = await db
    .select({
      total: sql<number>`count(*) filter (where ${agentJobs.createdAt} >= ${since})::int`,
      succeeded: sql<number>`count(*) filter (where ${agentJobs.status} = 'succeeded' and ${agentJobs.createdAt} >= ${since})::int`,
      failed: sql<number>`count(*) filter (where ${agentJobs.status} in ('failed','timeout') and ${agentJobs.createdAt} >= ${since})::int`,
      avg: sql<number | null>`avg(${agentJobs.durationMs}) filter (where ${agentJobs.status} = 'succeeded' and ${agentJobs.createdAt} >= ${since})`,
      running: sql<number>`count(*) filter (where ${agentJobs.status} in ('assigned','running'))::int`,
      queued: sql<number>`count(*) filter (where ${agentJobs.status} = 'queued')::int`,
    })
    .from(agentJobs)
    .where(sql`(${agentJobs.agentId} = ${agentId} OR ${agentJobs.pinnedAgentId} = ${agentId})`);
  return {
    total24h: row?.total ?? 0,
    succeeded24h: row?.succeeded ?? 0,
    failed24h: row?.failed ?? 0,
    avgDurationMs: row?.avg != null ? Math.round(Number(row.avg)) : null,
    running: row?.running ?? 0,
    queued: row?.queued ?? 0,
  };
}

/** Jobs per hour for the last 24h (succeeded / failed), for the overview sparkline. */
export async function agentJobHistogram(agentId: string): Promise<{ hour: string; succeeded: number; failed: number }[]> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const rows = await db
    .select({
      hour: sql<string>`to_char(date_trunc('hour', ${agentJobs.createdAt}), 'YYYY-MM-DD"T"HH24:00:00"Z"')`,
      succeeded: sql<number>`count(*) filter (where ${agentJobs.status} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${agentJobs.status} in ('failed','timeout'))::int`,
    })
    .from(agentJobs)
    .where(and(sql`(${agentJobs.agentId} = ${agentId} OR ${agentJobs.pinnedAgentId} = ${agentId})`, gte(agentJobs.createdAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const map = new Map(rows.map((r) => [r.hour, r]));
  const out: { hour: string; succeeded: number; failed: number }[] = [];
  const start = new Date(Math.floor((Date.now() - 23 * 3_600_000) / 3_600_000) * 3_600_000);
  for (let i = 0; i < 24; i++) {
    const h = new Date(start.getTime() + i * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const r = map.get(h);
    out.push({ hour: h, succeeded: r?.succeeded ?? 0, failed: r?.failed ?? 0 });
  }
  return out;
}

export type AgentEventView = { id: string; type: string; level: string; message: string; jobId: string | null; createdAt: string; meta: Record<string, unknown> };

export async function listAgentEvents(agentId: string, opts: { jobId?: string; limit?: number } = {}): Promise<AgentEventView[]> {
  const rows = await db
    .select()
    .from(agentEvents)
    .where(opts.jobId ? and(eq(agentEvents.agentId, agentId), eq(agentEvents.jobId, opts.jobId)) : eq(agentEvents.agentId, agentId))
    .orderBy(desc(agentEvents.createdAt))
    .limit(Math.min(opts.limit ?? 200, 1000));
  return rows.map((e) => ({ id: e.id, type: e.type, level: e.level, message: e.message, jobId: e.jobId, createdAt: e.createdAt.toISOString(), meta: e.meta ?? {} }));
}

export type CheckinHistoryView = {
  id: string;
  agentVersion: string | null;
  claudeVersion: string | null;
  codexVersion: string | null;
  nodeVersion: string | null;
  os: string | null;
  osRelease: string | null;
  arch: string | null;
  hostname: string | null;
  effectiveRuntime: string | null;
  createdAt: string;
};

/** Environment history: one entry per change (consecutive duplicates collapsed). */
export async function listCheckinHistory(agentId: string, limit = 50): Promise<CheckinHistoryView[]> {
  const rows = await db.select().from(agentCheckins).where(eq(agentCheckins.agentId, agentId)).orderBy(desc(agentCheckins.createdAt)).limit(500);
  const out: CheckinHistoryView[] = [];
  let prev: string | null = null;
  for (const r of rows) {
    if (r.fingerprint === prev) continue;
    prev = r.fingerprint;
    out.push({
      id: r.id,
      agentVersion: r.agentVersion,
      claudeVersion: r.claudeVersion,
      codexVersion: r.codexVersion,
      nodeVersion: r.nodeVersion,
      os: r.os,
      osRelease: r.osRelease,
      arch: r.arch,
      hostname: r.hostname,
      effectiveRuntime: r.effectiveRuntime,
      createdAt: r.createdAt.toISOString(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export type AgentJobDetail = AgentJobView & {
  payload: {
    system?: string;
    prompt?: string;
    jsonSchema?: Record<string, unknown> | null;
    webSearch?: boolean;
    testRuntimes?: string[];
    messages?: { role: string; content: string }[];
    mcpUrl?: string | null;
    attachmentNames?: string[];
  };
  resultText: string | null;
  resultJson: unknown;
  citationList: { url: string; title?: string }[];
  usage: Record<string, unknown> | null;
  workDir: string | null;
  exitCode: number | null;
  agentId: string | null;
  logs: { seq: number; stream: string; data: string; ts: string }[];
  events: AgentEventView[];
};

export async function getAgentJobDetail(jobId: string): Promise<AgentJobDetail | null> {
  const [j] = await db.select().from(agentJobs).where(eq(agentJobs.id, jobId)).limit(1);
  if (!j) return null;
  const [logs, events] = await Promise.all([
    db.select().from(agentJobLogs).where(eq(agentJobLogs.jobId, jobId)).orderBy(asc(agentJobLogs.seq)).limit(5000),
    db.select().from(agentEvents).where(eq(agentEvents.jobId, jobId)).orderBy(asc(agentEvents.createdAt)).limit(200),
  ]);
  const p = j.payload ?? {};
  return {
    ...toJobView(j),
    payload: {
      system: p.system,
      prompt: p.prompt ? (p.prompt.length > 60_000 ? `${p.prompt.slice(0, 60_000)}\n…` : p.prompt) : undefined,
      jsonSchema: p.jsonSchema ?? null,
      webSearch: p.webSearch,
      testRuntimes: p.testRuntimes,
      // Never expose the MCP token or attachment data to the browser.
      messages: p.messages?.slice(-50).map((m) => ({ role: m.role, content: m.content.length > 20_000 ? `${m.content.slice(0, 20_000)}\n…` : m.content })),
      mcpUrl: p.mcp?.url ?? null,
      attachmentNames: p.attachmentNames ?? p.attachments?.map((a) => a.name),
    },
    resultText: j.resultText ? (j.resultText.length > 200_000 ? `${j.resultText.slice(0, 200_000)}\n…` : j.resultText) : null,
    resultJson: j.resultJson ?? null,
    citationList: j.citations ?? [],
    usage: j.usage ?? null,
    workDir: j.workDir,
    exitCode: j.exitCode,
    agentId: j.agentId ?? j.pinnedAgentId,
    logs: logs.map((l) => ({ seq: l.seq, stream: l.stream, data: l.data, ts: l.createdAt.toISOString() })),
    events: events.map((e) => ({ id: e.id, type: e.type, level: e.level, message: e.message, jobId: e.jobId, createdAt: e.createdAt.toISOString(), meta: e.meta ?? {} })),
  };
}

/** Instance-wide overview for Admin → Local Agents. */
export async function adminAgentOverview() {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [jobs] = await db
    .select({
      total: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${agentJobs.status} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${agentJobs.status} in ('failed','timeout'))::int`,
      queued: sql<number>`count(*) filter (where ${agentJobs.status} = 'queued')::int`,
    })
    .from(agentJobs)
    .where(gte(agentJobs.createdAt, since));
  return { jobs24h: jobs ?? { total: 0, succeeded: 0, failed: 0, queued: 0 }, runtime: getAgentRuntimeInfo() };
}
