"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, actionUser, runAction } from "@/server/auth/guards";
import { logAudit } from "@/server/audit";
import {
  cancelAgentJob,
  createAgent,
  deleteAgent,
  getManageableAgent,
  manageableWorkspaceIds,
  reinstallAgent,
  requestAgentCleanup,
  requestAgentUpdate,
  startAgentTest,
  updateAgentSettings,
} from "@/server/agents/service";
import { getAgentJobDetail, getAgentView, listAgentEvents, listAgentJobs } from "@/server/agents/queries";
import type { InstallCommands } from "@/server/agents/runtime";

async function manageable(agentId: string) {
  const ctx = await actionUser();
  const agent = await getManageableAgent(ctx, z.string().max(40).parse(agentId));
  if (!agent) throw new ActionError("Agent not found.", "not_found");
  return { ctx, agent };
}

const createInput = z.object({
  name: z.string().trim().min(1).max(80),
  workspaceId: z.string().max(40),
  labels: z.array(z.string().trim().min(1).max(32)).max(10).default([]),
});

export type InstallResult = { agentId: string; name: string; token: string; commands: InstallCommands; issuedAt: string };

export async function createAgentAction(input: z.input<typeof createInput>) {
  return runAction<InstallResult>(async () => {
    const ctx = await actionUser();
    const data = createInput.parse(input);
    if (!ctx.isInstanceAdmin && !manageableWorkspaceIds(ctx).includes(data.workspaceId))
      throw new ActionError("You can't add agents to this workspace.", "forbidden");
    const created = await createAgent(ctx, data);
    await logAudit("agent.create", { actor: ctx.user, targetType: "agent", targetId: created.agent.id, workspaceId: data.workspaceId });
    revalidatePath("/agents");
    return { agentId: created.agent.id, name: created.agent.name, token: created.token, commands: created.commands, issuedAt: new Date().toISOString() };
  });
}

export async function reinstallAgentAction(agentId: string) {
  return runAction<InstallResult>(async () => {
    const { ctx, agent } = await manageable(agentId);
    const res = await reinstallAgent(ctx, agent);
    await logAudit("agent.reinstall", { actor: ctx.user, targetType: "agent", targetId: agent.id, workspaceId: agent.workspaceId });
    revalidatePath(`/agents/${agent.id}`);
    return { agentId: agent.id, name: agent.name, token: res.token, commands: res.commands, issuedAt: new Date().toISOString() };
  });
}

const settingsInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  labels: z.array(z.string().trim().min(1).max(32)).max(10).optional(),
  enabled: z.boolean().optional(),
  runtime: z.enum(["claude", "codex", "detect"]).nullable().optional(),
  workDir: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v)),
  maxParallel: z.number().int().min(1).max(32).nullable().optional(),
  autoUpdate: z.boolean().optional(),
  allowedKinds: z.array(z.enum(["llm", "web-search", "chat", "test"])).max(4).optional(),
  cliProfile: z.enum(["auto", "lean", "full"]).optional(),
  shared: z.boolean().optional(),
});

export async function updateAgentSettingsAction(agentId: string, input: z.input<typeof settingsInput>) {
  return runAction(async () => {
    const { ctx, agent } = await manageable(agentId);
    const patch = settingsInput.parse(input);
    if (patch.workDir && !/^([/~]|[A-Za-z]:[\\/]|\\\\)/.test(patch.workDir)) throw new ActionError("Work directory must be an absolute path (or start with ~).", "invalid");
    const updated = await updateAgentSettings(ctx, agent, patch);
    revalidatePath(`/agents/${agent.id}`);
    revalidatePath("/agents");
    return getAgentView(updated);
  });
}

export async function requestAgentUpdateAction(agentId: string) {
  return runAction(async () => {
    const { ctx, agent } = await manageable(agentId);
    await requestAgentUpdate(ctx, agent);
    revalidatePath(`/agents/${agent.id}`);
    return true;
  });
}

export async function requestAgentCleanupAction(agentId: string) {
  return runAction(async () => {
    const { ctx, agent } = await manageable(agentId);
    await requestAgentCleanup(ctx, agent);
    revalidatePath(`/agents/${agent.id}`);
    return true;
  });
}

export async function startAgentTestAction(agentId: string, runtimes?: ("claude" | "codex")[]) {
  return runAction(async () => {
    const { ctx, agent } = await manageable(agentId);
    const list = z.array(z.enum(["claude", "codex"])).max(2).optional().parse(runtimes);
    try {
      const jobId = await startAgentTest(ctx, agent, list);
      revalidatePath(`/agents/${agent.id}`);
      return { jobId };
    } catch (err) {
      throw new ActionError(err instanceof Error ? err.message : "Could not start the test", "invalid");
    }
  });
}

export async function setAgentEnabledAction(agentId: string, enabled: boolean) {
  return updateAgentSettingsAction(agentId, { enabled });
}

export async function deleteAgentAction(agentId: string) {
  return runAction(async () => {
    const { ctx, agent } = await manageable(agentId);
    await deleteAgent(agent);
    await logAudit("agent.delete", { actor: ctx.user, targetType: "agent", targetId: agent.id, workspaceId: agent.workspaceId, meta: { name: agent.name } });
    revalidatePath("/agents");
    return true;
  });
}

export async function cancelAgentJobAction(jobId: string) {
  return runAction(async () => {
    const ctx = await actionUser();
    const ok = await cancelAgentJob(ctx, z.string().max(40).parse(jobId));
    if (!ok) throw new ActionError("This job can't be cancelled (already finished or not accessible).", "invalid");
    return true;
  });
}

export async function getAgentJobDetailAction(jobId: string) {
  return runAction(async () => {
    const ctx = await actionUser();
    const detail = await getAgentJobDetail(z.string().max(40).parse(jobId));
    if (!detail || !detail.agentId) throw new ActionError("Job not found.", "not_found");
    const agent = await getManageableAgent(ctx, detail.agentId);
    if (!agent) throw new ActionError("Job not found.", "not_found");
    return detail;
  });
}

export async function refreshAgentDataAction(agentId: string) {
  return runAction(async () => {
    const { agent } = await manageable(agentId);
    const [view, jobs, events] = await Promise.all([getAgentView(agent), listAgentJobs(agent.id, { limit: 200 }), listAgentEvents(agent.id, { limit: 200 })]);
    return { view, jobs, events };
  });
}
