import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { agentJobs, agents, type AgentCommand, type AgentJobKind, type AgentRuntimeName } from "@/server/db/schema";
import { newId } from "@/server/db/schema/_helpers";
import type { UserContext } from "@/server/auth/context";
import { getSetting } from "@/server/settings";
import { isAgentOnline, logAgentEvent, newAgentToken, type AgentRow } from "./core";
import { createAgentJob, requeueAgentJobs, requestJobCancel } from "./jobs";
import { signal } from "./notify";
import { buildInstallCommands, type InstallCommands } from "./runtime";

/** Workspaces in which the user may manage agents (instance admins: all their memberships + any agent). */
export function manageableWorkspaceIds(ctx: UserContext): string[] {
  return ctx.memberships.filter((m) => m.permissions.has("agents.manage")).map((m) => m.workspace.id);
}

export function canManageAgent(ctx: UserContext, agent: Pick<AgentRow, "workspaceId">): boolean {
  return ctx.isInstanceAdmin || manageableWorkspaceIds(ctx).includes(agent.workspaceId);
}

export async function getManageableAgent(ctx: UserContext, agentId: string): Promise<AgentRow | null> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent || !canManageAgent(ctx, agent)) return null;
  return agent;
}

export type CreatedAgent = { agent: AgentRow; token: string; commands: InstallCommands };

export async function createAgent(
  ctx: UserContext,
  input: { workspaceId: string; name: string; labels?: string[]; userId?: string | null },
): Promise<CreatedAgent> {
  const settings = await getSetting("agents");
  const { token, hash, prefix } = newAgentToken();
  const [agent] = await db
    .insert(agents)
    .values({
      id: newId("agt"),
      workspaceId: input.workspaceId,
      userId: input.userId === undefined ? ctx.user.id : input.userId,
      createdBy: ctx.user.id,
      name: input.name,
      labels: input.labels ?? [],
      tokenHash: hash,
      tokenPrefix: prefix,
      autoUpdate: settings.allowAutoUpdate,
    })
    .returning();
  await logAgentEvent(agent!.id, "created", `Agent created by ${ctx.user.email}`, { actorId: ctx.user.id, level: "success" });
  return { agent: agent!, token, commands: buildInstallCommands(token) };
}

/**
 * Reinstall: issues a new token (the old one stops working immediately), requeues unfinished jobs,
 * keeps settings and history. The new install command is shown once.
 */
export async function reinstallAgent(ctx: UserContext, agent: AgentRow): Promise<CreatedAgent> {
  const { token, hash, prefix } = newAgentToken();
  const [updated] = await db
    .update(agents)
    .set({
      tokenHash: hash,
      tokenPrefix: prefix,
      tokenIssuedAt: new Date(),
      reinstallCount: agent.reinstallCount + 1,
      commands: [],
      state: "idle",
      runningJobs: 0,
      updateRequestedAt: null,
      updatingToVersion: null,
    })
    .where(eq(agents.id, agent.id))
    .returning();
  const requeued = await requeueAgentJobs(agent.id, "Agent was reinstalled");
  await logAgentEvent(agent.id, "reinstalled", `New token issued by ${ctx.user.email}; old token revoked${requeued ? `, ${requeued} job(s) requeued` : ""}`, {
    actorId: ctx.user.id,
    level: "warning",
    meta: { requeued },
  });
  await signal({ type: "agent-changed", agentId: agent.id });
  return { agent: updated!, token, commands: buildInstallCommands(token) };
}

export type AgentSettingsPatch = {
  name?: string;
  labels?: string[];
  enabled?: boolean;
  runtime?: "claude" | "codex" | "detect" | null;
  workDir?: string | null;
  maxParallel?: number | null;
  autoUpdate?: boolean;
  allowedKinds?: AgentJobKind[];
  cliProfile?: "auto" | "lean" | "full";
  shared?: boolean;
  userId?: string | null;
};

export async function updateAgentSettings(ctx: UserContext, agent: AgentRow, patch: AgentSettingsPatch): Promise<AgentRow> {
  const changes: string[] = [];
  const set: Partial<typeof agents.$inferInsert> = {};
  const track = <K extends keyof AgentSettingsPatch>(key: K, label: string) => {
    if (patch[key] === undefined) return;
    const before = (agent as Record<string, unknown>)[key];
    const after = patch[key];
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return;
    (set as Record<string, unknown>)[key] = after;
    changes.push(`${label}: ${fmt(before)} → ${fmt(after)}`);
  };
  track("name", "name");
  track("labels", "labels");
  track("enabled", "enabled");
  track("runtime", "runtime");
  track("workDir", "work dir");
  track("maxParallel", "max parallel");
  track("autoUpdate", "auto-update");
  track("allowedKinds", "job kinds");
  track("cliProfile", "CLI mode");
  track("userId", "owner");
  if (patch.shared !== undefined && ctx.isInstanceAdmin) track("shared", "shared");
  if (!changes.length) return agent;
  const [updated] = await db.update(agents).set(set).where(eq(agents.id, agent.id)).returning();
  const type = patch.enabled === false && agent.enabled ? "paused" : patch.enabled === true && !agent.enabled ? "resumed" : "settings_changed";
  await logAgentEvent(
    agent.id,
    type,
    type === "paused" ? "Paused — no new jobs will be assigned" : type === "resumed" ? "Resumed — accepting jobs again" : `Settings changed (${changes.join("; ")})`,
    { actorId: ctx.user.id, meta: { changes } },
  );
  await signal({ type: "agent-changed", agentId: agent.id });
  return updated!;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "default";
  if (Array.isArray(v)) return v.join(", ") || "none";
  return String(v);
}

/** "Update" button: next check-in rolls out the latest runtime (ignores the dashboard auto-update switch). */
export async function requestAgentUpdate(ctx: UserContext, agent: AgentRow): Promise<void> {
  await db.update(agents).set({ updateRequestedAt: new Date(), updateRequestedBy: ctx.user.id }).where(eq(agents.id, agent.id));
  await logAgentEvent(agent.id, "update_requested", `Update requested by ${ctx.user.email} — applied on the next check-in`, { actorId: ctx.user.id });
}

export async function requestAgentCleanup(ctx: UserContext, agent: AgentRow): Promise<void> {
  const command: AgentCommand = { id: newId("cmd"), type: "cleanup", maxAgeHours: 0, requestedAt: new Date().toISOString(), requestedBy: ctx.user.id };
  // Atomic replace of any pending cleanup (a concurrent check-in may be delivering commands).
  await db.execute(sql`
    UPDATE agents SET commands = COALESCE(
      (SELECT jsonb_agg(c) FROM jsonb_array_elements(commands) c WHERE c->>'type' <> 'cleanup'), '[]'::jsonb
    ) || ${JSON.stringify([command])}::jsonb
    WHERE id = ${agent.id}`);
  await logAgentEvent(agent.id, "cleanup_requested", `Cleanup requested by ${ctx.user.email}`, { actorId: ctx.user.id });
}

/** Self-test: a real job pinned to this machine, one attempt, no credentials/repo. */
export async function startAgentTest(ctx: UserContext, agent: AgentRow, runtimes?: AgentRuntimeName[]): Promise<string> {
  const settings = await getSetting("agents");
  if (!agent.allowedKinds.includes("test")) throw new Error("Self-tests are disabled for this agent (Settings → Allowed job kinds).");
  const job = await createAgentJob({
    kind: "test",
    purpose: "self_test",
    payload: { testRuntimes: runtimes?.length ? runtimes : undefined },
    workspaceId: agent.workspaceId,
    userId: ctx.user.id,
    pinnedAgentId: agent.id,
    // Up to two CLIs × 150s each, plus start-up.
    timeoutMs: 6 * 60_000,
    expiresAt: new Date(Date.now() + (isAgentOnline(agent, settings) ? 5 : 15) * 60_000),
  });
  await logAgentEvent(agent.id, "test_requested", `Self-test requested by ${ctx.user.email}`, { actorId: ctx.user.id, jobId: job.id });
  return job.id;
}

export async function cancelAgentJob(ctx: UserContext, jobId: string): Promise<boolean> {
  const [job] = await db.select().from(agentJobs).where(eq(agentJobs.id, jobId)).limit(1);
  if (!job) return false;
  const agentId = job.agentId ?? job.pinnedAgentId;
  if (agentId) {
    const agent = await getManageableAgent(ctx, agentId);
    if (!agent) return false;
  } else if (!ctx.isInstanceAdmin && !(job.workspaceId && manageableWorkspaceIds(ctx).includes(job.workspaceId))) {
    return false;
  }
  const ok = await requestJobCancel(jobId, ctx.user.id, `Cancelled by ${ctx.user.email}`);
  if (ok && agentId) await logAgentEvent(agentId, "job_cancel_requested", `Cancel requested for "${job.purpose}"`, { jobId, actorId: ctx.user.id, level: "warning" });
  return ok;
}

/** Deletes the agent (token revoked). Unfinished non-pinned jobs go back to the queue for other agents. */
export async function deleteAgent(agent: AgentRow): Promise<void> {
  await requeueAgentJobs(agent.id, "Agent was deleted");
  await db.delete(agents).where(eq(agents.id, agent.id));
}
