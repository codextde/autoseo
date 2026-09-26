"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, actionProject, runAction } from "@/server/auth/guards";
import { logAudit } from "@/server/audit";
import { AuditServiceError, deleteAudit, startAudit, stopAudit } from "@/server/audit-crawler/service";
import { upsertSchedule } from "@/server/audit-crawler/schedules";

function mapError(err: unknown): never {
  if (err instanceof AuditServiceError) {
    throw new ActionError(err.message, err.code === "NOT_FOUND" ? "not_found" : err.code === "AUDIT_ALREADY_RUNNING" ? "conflict" : "invalid");
  }
  throw err;
}

const startInput = z.object({
  startUrl: z.string().trim().max(2048).optional().nullable(),
  maxPages: z.number().int().min(1).max(100_000).optional().nullable(),
  lighthouse: z.boolean().default(false),
  lighthouseProvider: z.enum(["psi", "dataforseo"]).default("psi"),
});

export async function startAuditAction(projectId: string, input: z.input<typeof startInput>) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "seo.run");
    const data = startInput.parse(input);
    const res = await startAudit(
      { projectId, workspaceId: ctx.project.workspaceId, userId: ctx.user.id },
      { ...data, trigger: "manual" },
    ).catch(mapError);
    await logAudit("site_audit.start", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "site_audit",
      targetId: res.auditId,
      projectId,
      workspaceId: ctx.project.workspaceId,
      meta: { startUrl: res.startUrl, maxPages: data.maxPages, lighthouse: data.lighthouse },
    });
    revalidatePath(`/p/${projectId}/seo/audit`);
    return res;
  });
}

export async function stopAuditAction(projectId: string, auditId: string) {
  return runAction(async () => {
    await actionProject(projectId, "seo.run");
    const res = await stopAudit(projectId, z.string().min(1).parse(auditId)).catch(mapError);
    revalidatePath(`/p/${projectId}/seo/audit/${auditId}`);
    return res;
  });
}

export async function deleteAuditAction(projectId: string, auditId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "seo.run");
    await deleteAudit(projectId, z.string().min(1).parse(auditId)).catch(mapError);
    await logAudit("site_audit.delete", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "site_audit",
      targetId: auditId,
      projectId,
      workspaceId: ctx.project.workspaceId,
    });
    revalidatePath(`/p/${projectId}/seo/audit`);
    return true;
  });
}

const scheduleInput = z.object({
  kind: z.enum(["site_audit", "crawlability"]),
  enabled: z.boolean(),
  frequency: z.enum(["weekly", "monthly"]),
  startUrl: z.string().trim().max(2048).optional().nullable(),
  maxPages: z.number().int().min(10).max(100_000).optional().nullable(),
  lighthouse: z.boolean().optional(),
  lighthouseProvider: z.enum(["psi", "dataforseo"]).optional(),
  urls: z.array(z.string().trim().max(2048)).max(10).optional(),
  dropThreshold: z.number().int().min(0).max(100).default(5),
  emails: z.array(z.email()).max(10).default([]),
});

export async function saveAuditScheduleAction(projectId: string, input: z.input<typeof scheduleInput>) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "seo.run");
    const data = scheduleInput.parse(input);
    const row = await upsertSchedule(
      projectId,
      data.kind,
      {
        enabled: data.enabled,
        frequency: data.frequency,
        config: {
          startUrl: data.startUrl || undefined,
          maxPages: data.maxPages ?? undefined,
          lighthouse: data.lighthouse,
          lighthouseProvider: data.lighthouseProvider,
          urls: data.urls?.filter(Boolean),
          dropThreshold: data.dropThreshold,
          emails: data.emails,
        },
      },
      ctx.user.id,
    );
    await logAudit(`${data.kind}.schedule`, {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "audit_schedule",
      targetId: row.id,
      projectId,
      workspaceId: ctx.project.workspaceId,
      meta: { enabled: data.enabled, frequency: data.frequency },
    });
    revalidatePath(data.kind === "site_audit" ? `/p/${projectId}/seo/audit` : `/p/${projectId}/crawlability`);
    return { id: row.id, nextRunAt: row.nextRunAt.toISOString(), enabled: row.enabled };
  });
}
