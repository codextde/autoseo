"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { optimizeSettings } from "@/server/db/schema";
import { actionProject, runAction } from "@/server/auth/guards";
import { logAudit } from "@/server/audit";
import {
  buildFramerExport,
  connectIntegration,
  disconnectIntegration,
  enqueueTaskPush,
  getProviderMeta,
  listConnectedIntegrations,
  listIntegrationTargets,
  publishContentToCms,
  pushTasksToPm,
  resolveProviderKey,
  rotateWebhookSecret,
  sendWebhookTest,
  setIntegrationTarget,
  testIntegration,
} from "@/server/optimize/integrations";
import { getIntegrationRow, readConfig } from "@/server/optimize/integrations/store";

const projectIdSchema = z.string().min(1).max(64);
const providerSchema = z
  .string()
  .min(1)
  .max(40)
  .transform((v) => resolveProviderKey(v))
  .refine((v) => !!getProviderMeta(v), "Unknown integration");
const kindSchema = z.enum(["pm", "cms"]).optional();

export async function listIntegrationsAction(projectId: string, kind?: "pm" | "cms") {
  return runAction(async () => {
    const pid = projectIdSchema.parse(projectId);
    await actionProject(pid);
    return listConnectedIntegrations(pid, kindSchema.parse(kind));
  });
}

const connectInput = z.object({
  projectId: projectIdSchema,
  provider: providerSchema,
  values: z.record(z.string(), z.string().max(4000)).default({}),
});

export async function connectIntegrationAction(input: z.input<typeof connectInput>) {
  return runAction(async () => {
    const data = connectInput.parse(input);
    const ctx = await actionProject(data.projectId, "settings.manage");
    const result = await connectIntegration(data.projectId, data.provider, data.values, ctx.user.id);
    await logAudit("integration.connected", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "integration",
      targetId: result.integration.id,
      workspaceId: ctx.project.workspaceId,
      projectId: data.projectId,
      meta: { provider: data.provider, account: result.integration.account },
    });
    return result;
  });
}

/** Non-secret details of a connection for the manage dialog (field values without secrets). */
export async function getIntegrationDetailsAction(projectId: string, provider: string) {
  return runAction(async () => {
    const pid = projectIdSchema.parse(projectId);
    const key = providerSchema.parse(provider);
    const ctx = await actionProject(pid, "settings.manage");
    const row = await getIntegrationRow(ctx.project.id, key);
    if (!row) return null;
    const meta = getProviderMeta(key)!;
    const cfg = readConfig(row);
    const values: Record<string, string> = {};
    for (const f of meta.fields) if (!f.secret && cfg.fields[f.key]) values[f.key] = cfg.fields[f.key]!;
    let webhookEvents: boolean | null = null;
    if (key === "webhook") {
      const [s] = await db
        .select({ webhookEvents: optimizeSettings.webhookEvents })
        .from(optimizeSettings)
        .where(eq(optimizeSettings.projectId, pid))
        .limit(1);
      webhookEvents = s?.webhookEvents ?? true;
    }
    return { values, webhookEvents };
  });
}

const targetInput = z.object({ projectId: projectIdSchema, provider: providerSchema, targetId: z.string().min(1).max(200) });

export async function setIntegrationTargetAction(input: z.input<typeof targetInput>) {
  return runAction(async () => {
    const data = targetInput.parse(input);
    await actionProject(data.projectId, "settings.manage");
    return setIntegrationTarget(data.projectId, data.provider, data.targetId);
  });
}

export async function listIntegrationTargetsAction(projectId: string, provider: string) {
  return runAction(async () => {
    const pid = projectIdSchema.parse(projectId);
    const key = providerSchema.parse(provider);
    await actionProject(pid, "settings.manage");
    return listIntegrationTargets(pid, key);
  });
}

export async function testIntegrationAction(projectId: string, provider: string) {
  return runAction(async () => {
    const pid = projectIdSchema.parse(projectId);
    const key = providerSchema.parse(provider);
    await actionProject(pid, "settings.manage");
    return testIntegration(pid, key);
  });
}

export async function disconnectIntegrationAction(projectId: string, provider: string) {
  return runAction(async () => {
    const pid = projectIdSchema.parse(projectId);
    const key = providerSchema.parse(provider);
    const ctx = await actionProject(pid, "settings.manage");
    const removed = await disconnectIntegration(pid, key);
    await logAudit("integration.disconnected", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "integration",
      targetId: removed?.id,
      workspaceId: ctx.project.workspaceId,
      projectId: pid,
      meta: { provider: key },
    });
    return true;
  });
}

export async function rotateWebhookSecretAction(projectId: string) {
  return runAction(async () => {
    const pid = projectIdSchema.parse(projectId);
    const ctx = await actionProject(pid, "settings.manage");
    const secret = await rotateWebhookSecret(pid);
    await logAudit("integration.secret_rotated", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "integration",
      workspaceId: ctx.project.workspaceId,
      projectId: pid,
      meta: { provider: "webhook" },
    });
    return secret;
  });
}

export async function sendWebhookTestAction(projectId: string) {
  return runAction(async () => {
    const pid = projectIdSchema.parse(projectId);
    await actionProject(pid, "settings.manage");
    await sendWebhookTest(pid);
    return true;
  });
}

export async function setWebhookEventsAction(projectId: string, enabled: boolean) {
  return runAction(async () => {
    const pid = projectIdSchema.parse(projectId);
    await actionProject(pid, "settings.manage");
    const value = z.boolean().parse(enabled);
    await db
      .insert(optimizeSettings)
      .values({ projectId: pid, webhookEvents: value })
      .onConflictDoUpdate({ target: optimizeSettings.projectId, set: { webhookEvents: value } });
    return value;
  });
}

const pushInput = z.object({
  projectId: projectIdSchema,
  provider: providerSchema,
  taskIds: z.array(z.string().min(1).max(64)).min(1).max(500),
});

export async function pushTasksAction(input: z.input<typeof pushInput>) {
  return runAction(async () => {
    const data = pushInput.parse(input);
    const ctx = await actionProject(data.projectId, "prompts.manage");
    if (getProviderMeta(data.provider)?.kind !== "pm") throw new Error("Not a PM tool.");
    if (data.taskIds.length > 5) {
      const job = await enqueueTaskPush(data.projectId, data.taskIds, data.provider, ctx.user.id);
      return { mode: "queued" as const, count: data.taskIds.length, jobId: job?.id ?? null };
    }
    const results = await pushTasksToPm(data.projectId, data.taskIds, data.provider, ctx.user.id);
    return { mode: "sync" as const, results };
  });
}

const publishInput = z.object({
  projectId: projectIdSchema,
  contentId: z.string().min(1).max(64),
  provider: providerSchema,
  draft: z.boolean().default(false),
});

export async function publishContentAction(input: z.input<typeof publishInput>) {
  return runAction(async () => {
    const data = publishInput.parse(input);
    const ctx = await actionProject(data.projectId, "prompts.manage");
    if (getProviderMeta(data.provider)?.kind !== "cms") throw new Error("Not a CMS.");
    const result = await publishContentToCms(data.projectId, data.contentId, data.provider, { draft: data.draft }, ctx.user.id);
    await logAudit(data.draft ? "content.cms_draft" : "content.published", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "content",
      targetId: data.contentId,
      workspaceId: ctx.project.workspaceId,
      projectId: data.projectId,
      meta: { provider: data.provider, url: result.url },
    });
    return result;
  });
}

export async function framerExportAction(projectId: string, contentId: string) {
  return runAction(async () => {
    const pid = projectIdSchema.parse(projectId);
    const cid = z.string().min(1).max(64).parse(contentId);
    await actionProject(pid);
    return buildFramerExport(pid, cid);
  });
}
