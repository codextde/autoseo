"use server";

import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { reports } from "@/server/db/schema";
import { actionProject, ActionError, runAction } from "@/server/auth/guards";
import { getProjectContext } from "@/server/auth/context";
import { enqueueJob, getJob } from "@/server/jobs/queue";
import { logAudit } from "@/server/audit";
import { rateLimit } from "@/server/rate-limit";
import {
  createDeckReport,
  createHtmlReport,
  createHtmlTemplate,
  deleteReport,
  deleteTemplate,
  duplicateReport,
  getReportByShareToken,
  listReports,
  listTemplates,
  requireReport,
  revokeShare,
  saveAsTemplate,
  saveDeck,
  setPublished,
  updateReportMeta,
  updateShare,
  updateTemplate,
  type ReportRow,
} from "@/server/reports/service";
import { loadReportData } from "@/server/reports/data";
import { getBrandKit, saveBrandKit } from "@/server/reports/brand";
import { deleteAsset, getAssetForProject, listAssets } from "@/server/reports/assets";
import { SHARE_PASSWORD_MIN, SHARE_TOKEN_RE, shareCookieName, shareCookieValue, verifySharePassword } from "@/server/reports/share";
import { clientIp } from "@/server/http/request";
import { assertWorkspaceReports, canManageWorkspaceReports } from "@/server/reports/access";
import type { ReportAgentPayload } from "@/server/jobs/handlers/reports";
import { themeFromBrandKit } from "./lib/theme";
import { parseDeck } from "./lib/types";

const rangeSchema = z.object({
  preset: z.enum(["7d", "30d", "90d", "mtd", "last_month", "custom"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const idSchema = z.string().min(3).max(64);
const titleSchema = z.string().trim().min(1, "Title is required").max(160);

export type ShareState = {
  status: "draft" | "published";
  shareEnabled: boolean;
  sharePath: string | null;
  hasPassword: boolean;
  shareExpiresAt: string | null;
  shareMode: "live" | "snapshot";
  snapshotAt: string | null;
  shareViews: number;
};

function shareState(r: ReportRow): ShareState {
  return {
    status: r.status,
    shareEnabled: r.shareEnabled,
    sharePath: r.shareToken ? `/share/r/${r.shareToken}` : null,
    hasPassword: !!r.sharePasswordHash,
    shareExpiresAt: r.shareExpiresAt?.toISOString() ?? null,
    shareMode: r.shareMode,
    snapshotAt: r.snapshotAt?.toISOString() ?? null,
    shareViews: r.shareViews,
  };
}

/* ───────────────────────────── Reports ───────────────────────────── */

export async function listReportsAction(projectId: string) {
  return runAction(async () => {
    await actionProject(projectId);
    return listReports(projectId);
  });
}

export async function createReportAction(
  projectId: string,
  input: { title: string; subtitle?: string | null; template: string; dateRange?: z.input<typeof rangeSchema> },
) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    const data = z
      .object({ title: titleSchema, subtitle: z.string().trim().max(200).nullish(), template: z.string().min(1).max(80), dateRange: rangeSchema.optional() })
      .parse(input);
    const row = await createDeckReport({
      projectId,
      workspaceId: ctx.project.workspaceId,
      userId: ctx.user.id,
      title: data.title,
      subtitle: data.subtitle ?? null,
      template: data.template,
      dateRange: data.dateRange,
    });
    await logAudit("report.create", { actor: ctx.user, targetType: "report", targetId: row.id, projectId, workspaceId: ctx.project.workspaceId });
    return { id: row.id };
  });
}

export async function createAiReportAction(
  projectId: string,
  input: { title: string; prompt: string; templateId?: string | null; dateRange?: z.input<typeof rangeSchema> },
) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    const data = z
      .object({ title: titleSchema, prompt: z.string().trim().min(3, "Describe the report").max(4000), templateId: idSchema.nullish(), dateRange: rangeSchema.optional() })
      .parse(input);
    if (!rateLimit(`reports:ai:${ctx.user.id}`, 20, 60 * 60_000)) throw new ActionError("Too many AI reports — try again later.", "conflict");
    const row = await createHtmlReport({
      projectId,
      workspaceId: ctx.project.workspaceId,
      userId: ctx.user.id,
      title: data.title,
      prompt: data.prompt,
      templateId: data.templateId ?? null,
      dateRange: data.dateRange,
    });
    const job = await enqueueJob("reports.generate_html", { reportId: row.id }, { projectId, workspaceId: ctx.project.workspaceId, createdBy: ctx.user.id, maxAttempts: 1 });
    if (job) await updateAiJob(row.id, job.id);
    await logAudit("report.create_ai", { actor: ctx.user, targetType: "report", targetId: row.id, projectId, workspaceId: ctx.project.workspaceId });
    return { id: row.id };
  });
}

async function updateAiJob(reportId: string, jobId: string) {
  await db.update(reports).set({ aiJobId: jobId, aiStatus: "queued", aiError: null }).where(eq(reports.id, reportId));
}

export async function regenerateAiReportAction(projectId: string, reportId: string, input: { prompt?: string } = {}) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    const row = await requireReport(projectId, reportId);
    if (row.kind !== "html") throw new ActionError("Only AI reports can be regenerated.", "invalid");
    const prompt = z.string().trim().min(3).max(4000).optional().parse(input.prompt);
    if (!rateLimit(`reports:ai:${ctx.user.id}`, 20, 60 * 60_000)) throw new ActionError("Too many AI reports — try again later.", "conflict");
    if (prompt) {
      await db.update(reports).set({ prompt }).where(eq(reports.id, row.id));
    }
    const job = await enqueueJob("reports.generate_html", { reportId: row.id }, { projectId, workspaceId: ctx.project.workspaceId, createdBy: ctx.user.id, maxAttempts: 1 });
    if (job) await updateAiJob(row.id, job.id);
    return true;
  });
}

export async function renameReportAction(projectId: string, reportId: string, input: { title: string; subtitle?: string | null }) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    const data = z.object({ title: titleSchema, subtitle: z.string().trim().max(200).nullish() }).parse(input);
    await updateReportMeta(projectId, reportId, { title: data.title, subtitle: data.subtitle ?? null }, ctx.user.id);
    return true;
  });
}

export async function updateReportRangeAction(projectId: string, reportId: string, range: z.input<typeof rangeSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    await updateReportMeta(projectId, reportId, { dateRange: rangeSchema.parse(range) }, ctx.user.id);
    return true;
  });
}

export async function duplicateReportAction(projectId: string, reportId: string, targetProjectId?: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    let target = projectId;
    if (targetProjectId && targetProjectId !== projectId) {
      const tctx = await getProjectContext(idSchema.parse(targetProjectId));
      if (!tctx || !tctx.permissions.has("reports.manage")) throw new ActionError("You can't create reports in that project.", "forbidden");
      target = tctx.project.id;
    }
    const tctx = target === projectId ? ctx : await actionProject(target, "reports.manage");
    const row = await duplicateReport({ projectId, reportId, userId: ctx.user.id, targetProjectId: target, workspaceId: tctx.project.workspaceId });
    return { id: row.id, projectId: target };
  });
}

export async function deleteReportAction(projectId: string, reportId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    await deleteReport(projectId, idSchema.parse(reportId));
    await logAudit("report.delete", { actor: ctx.user, targetType: "report", targetId: reportId, projectId, workspaceId: ctx.project.workspaceId });
    return true;
  });
}

export async function setPublishedAction(projectId: string, reportId: string, published: boolean) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    const row = await setPublished(projectId, reportId, !!published, ctx.user.id);
    return shareState(row);
  });
}

export async function getShareStateAction(projectId: string, reportId: string) {
  return runAction(async () => {
    await actionProject(projectId);
    return shareState(await requireReport(projectId, reportId));
  });
}

export async function updateShareAction(
  projectId: string,
  reportId: string,
  input: { enabled: boolean; password?: string | null; expiresAt?: string | null; mode?: "live" | "snapshot"; refreshSnapshot?: boolean },
) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    const data = z
      .object({
        enabled: z.boolean(),
        password: z.string().min(SHARE_PASSWORD_MIN, `Password must have at least ${SHARE_PASSWORD_MIN} characters`).max(200).nullish(),
        expiresAt: z.string().datetime({ offset: true }).nullish().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()),
        mode: z.enum(["live", "snapshot"]).optional(),
        refreshSnapshot: z.boolean().optional(),
      })
      .parse(input);
    const expires = data.expiresAt ? (data.expiresAt.length === 10 ? `${data.expiresAt}T23:59:59.000Z` : data.expiresAt) : data.expiresAt;
    const row = await updateShare(
      projectId,
      reportId,
      { enabled: data.enabled, password: data.password === undefined ? undefined : data.password, expiresAt: expires, mode: data.mode, refreshSnapshot: data.refreshSnapshot },
      ctx.user.id,
    );
    await logAudit(data.enabled ? "report.share" : "report.unshare", { actor: ctx.user, targetType: "report", targetId: reportId, projectId, workspaceId: ctx.project.workspaceId });
    return shareState(row);
  });
}

export async function revokeShareAction(projectId: string, reportId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    const row = await revokeShare(projectId, reportId, ctx.user.id);
    await logAudit("report.share_revoke", { actor: ctx.user, targetType: "report", targetId: reportId, projectId, workspaceId: ctx.project.workspaceId });
    return shareState(row);
  });
}

export async function saveDeckAction(
  projectId: string,
  reportId: string,
  input: { deck: unknown; baseVersion: number; force?: boolean; title?: string; dateRange?: z.input<typeof rangeSchema> },
) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    const data = z
      .object({ baseVersion: z.number().int().min(0), force: z.boolean().optional(), title: titleSchema.optional(), dateRange: rangeSchema.optional() })
      .parse(input);
    return saveDeck({ projectId, reportId, deck: input.deck, baseVersion: data.baseVersion, force: data.force, userId: ctx.user.id, title: data.title, dateRange: data.dateRange });
  });
}

/* ───────────────────────────── Live data ───────────────────────────── */

export async function loadDataAction(projectId: string, input: { dataProjectId?: string | null; dateRange: z.input<typeof rangeSchema> }) {
  return runAction(async () => {
    await actionProject(projectId);
    const range = rangeSchema.parse(input.dateRange);
    let dataProject = projectId;
    if (input.dataProjectId && input.dataProjectId !== projectId) {
      const other = await getProjectContext(idSchema.parse(input.dataProjectId));
      if (!other) throw new ActionError("You don't have access to that project.", "forbidden");
      dataProject = other.project.id;
    }
    return loadReportData(dataProject, range);
  });
}

/* ───────────────────────────── Templates ───────────────────────────── */

export async function listTemplatesAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId);
    return listTemplates(ctx.project.workspaceId);
  });
}

export async function saveAsTemplateAction(projectId: string, reportId: string, input: { name: string; description?: string | null }) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    assertWorkspaceReports(ctx);
    const data = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(200).nullish() }).parse(input);
    const tpl = await saveAsTemplate({ projectId, reportId, workspaceId: ctx.project.workspaceId, userId: ctx.user.id, name: data.name, description: data.description ?? null });
    return { id: tpl.id };
  });
}

export async function createAiTemplateAction(projectId: string, input: { name: string; description?: string | null; instructions: string }) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    assertWorkspaceReports(ctx);
    const data = z
      .object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(200).nullish(), instructions: z.string().trim().min(3).max(3000) })
      .parse(input);
    const tpl = await createHtmlTemplate({ workspaceId: ctx.project.workspaceId, userId: ctx.user.id, name: data.name, description: data.description ?? null, instructions: data.instructions });
    return { id: tpl.id };
  });
}

export async function updateTemplateAction(projectId: string, templateId: string, input: { name?: string; description?: string | null; instructions?: string }) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    assertWorkspaceReports(ctx);
    const data = z
      .object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().trim().max(200).nullish(), instructions: z.string().trim().max(3000).optional() })
      .parse(input);
    await updateTemplate(ctx.project.workspaceId, idSchema.parse(templateId), { ...data, description: data.description ?? undefined });
    return true;
  });
}

export async function deleteTemplateAction(projectId: string, templateId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    assertWorkspaceReports(ctx);
    await deleteTemplate(ctx.project.workspaceId, idSchema.parse(templateId));
    return true;
  });
}

/* ───────────────────────────── Assets & brand kit ───────────────────────────── */

export async function listAssetsAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId);
    const rows = await listAssets(ctx.project.workspaceId, projectId);
    return rows.map((a) => ({
      id: a.id,
      kind: a.kind,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      width: a.width,
      height: a.height,
      scope: a.projectId ? ("project" as const) : ("workspace" as const),
      createdAt: a.createdAt.toISOString(),
    }));
  });
}

export async function deleteAssetAction(projectId: string, assetId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    const asset = await getAssetForProject(idSchema.parse(assetId), ctx.project.workspaceId, projectId);
    if (!asset) throw new ActionError("Asset not found.", "not_found");
    if (!asset.projectId) assertWorkspaceReports(ctx);
    await deleteAsset(asset.id, ctx.project.workspaceId, projectId);
    return true;
  });
}

const hexOpt = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .optional()
  .or(z.literal("").transform(() => undefined));
const kitSchema = z.object({
  agencyName: z.string().trim().max(120).optional(),
  agencyWebsite: z.string().trim().max(200).optional(),
  agencyEmail: z.string().trim().max(200).optional(),
  agencyLogo: z
    .string()
    .max(2000)
    .regex(/^(asset:ras_[a-z0-9]+|https?:\/\/.+)?$/i, "Logo must be an uploaded asset or an http(s) URL")
    .optional(),
  clientName: z.string().trim().max(120).optional(),
  clientLogo: z
    .string()
    .max(2000)
    .regex(/^(asset:ras_[a-z0-9]+|https?:\/\/.+)?$/i, "Logo must be an uploaded asset or an http(s) URL")
    .optional(),
  clientColor: hexOpt,
  mode: z.enum(["dark", "light"]).optional(),
  accentColor: hexOpt,
  secondaryColor: hexOpt,
  backgroundColor: hexOpt,
  textColor: hexOpt,
  headingFont: z.string().max(60).regex(/^[A-Za-z0-9 ,'-]*$/).optional(),
  bodyFont: z.string().max(60).regex(/^[A-Za-z0-9 ,'-]*$/).optional(),
});

export async function getBrandKitAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId);
    const kit = await getBrandKit(ctx.project.workspaceId, projectId);
    return { ...kit, theme: themeFromBrandKit(kit.effective), canEditWorkspace: canManageWorkspaceReports(ctx) };
  });
}

export async function saveBrandKitAction(projectId: string, input: { workspace?: z.input<typeof kitSchema>; client?: z.input<typeof kitSchema> }) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    if (input.workspace) {
      assertWorkspaceReports(ctx);
      const w = kitSchema.parse(input.workspace);
      await saveBrandKit(ctx.project.workspaceId, "workspace", {
        agencyName: w.agencyName,
        agencyWebsite: w.agencyWebsite,
        agencyEmail: w.agencyEmail,
        agencyLogo: w.agencyLogo,
        mode: w.mode,
        accentColor: w.accentColor,
        secondaryColor: w.secondaryColor,
        backgroundColor: w.backgroundColor,
        textColor: w.textColor,
        headingFont: w.headingFont,
        bodyFont: w.bodyFont,
      }, ctx.user.id);
    }
    if (input.client) {
      const c = kitSchema.parse(input.client);
      await saveBrandKit(ctx.project.workspaceId, projectId, {
        clientName: c.clientName,
        clientLogo: c.clientLogo,
        clientColor: c.clientColor,
        accentColor: c.accentColor,
        mode: c.mode,
      }, ctx.user.id);
    }
    const kit = await getBrandKit(ctx.project.workspaceId, projectId);
    return { ...kit, theme: themeFromBrandKit(kit.effective), canEditWorkspace: canManageWorkspaceReports(ctx) };
  });
}

/* ───────────────────────────── Agent ───────────────────────────── */

export async function startAgentAction(
  projectId: string,
  input: {
    action: "slide" | "rewrite" | "summarize";
    prompt?: string;
    markup?: string;
    instruction?: string;
    focus?: string;
    dateRange?: z.input<typeof rangeSchema>;
    dataProjectId?: string | null;
    size?: { w: number; h: number };
  },
) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    const data = z
      .object({
        action: z.enum(["slide", "rewrite", "summarize"]),
        prompt: z.string().trim().max(4000).optional(),
        markup: z.string().max(5000).optional(),
        instruction: z.string().trim().max(500).optional(),
        focus: z.string().trim().max(500).optional(),
        dateRange: rangeSchema.optional(),
        dataProjectId: idSchema.nullish(),
        size: z.object({ w: z.number().int().min(320).max(8000), h: z.number().int().min(320).max(8000) }).optional(),
      })
      .parse(input);
    if (data.action === "slide" && !data.prompt) throw new ActionError("Describe the slide you want.", "invalid");
    if (data.action === "rewrite" && !data.markup?.trim()) throw new ActionError("Select a text box to rewrite.", "invalid");
    if (!rateLimit(`reports:agent:${ctx.user.id}`, 60, 60 * 60_000)) throw new ActionError("Too many agent requests — try again later.", "conflict");
    let dataProjectId = projectId;
    if (data.dataProjectId && data.dataProjectId !== projectId) {
      const other = await getProjectContext(data.dataProjectId);
      if (!other) throw new ActionError("You don't have access to that project.", "forbidden");
      dataProjectId = other.project.id;
    }
    const payload: ReportAgentPayload = {
      projectId,
      workspaceId: ctx.project.workspaceId,
      userId: ctx.user.id,
      action: data.action,
      prompt: data.prompt,
      markup: data.markup,
      instruction: data.instruction,
      focus: data.focus,
      dateRange: data.dateRange,
      dataProjectId,
      size: data.size,
    };
    const job = await enqueueJob("reports.agent", payload as unknown as Record<string, unknown>, {
      projectId,
      workspaceId: ctx.project.workspaceId,
      createdBy: ctx.user.id,
      priority: 20,
      maxAttempts: 1,
    });
    if (!job) throw new ActionError("Could not start the agent.", "error");
    return { jobId: job.id };
  });
}

export async function pollAgentAction(projectId: string, jobId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "reports.manage");
    const job = await getJob(idSchema.parse(jobId));
    if (!job || job.projectId !== projectId || job.type !== "reports.agent" || job.createdBy !== ctx.user.id) throw new ActionError("Job not found.", "not_found");
    return {
      status: job.status,
      progress: (job.progress as { step?: string } | null)?.step ?? null,
      result: job.status === "succeeded" ? (job.result as Record<string, unknown>) : null,
      error: job.status === "failed" ? (job.lastError ?? "The agent failed.") : null,
    };
  });
}

export async function aiReportStatusAction(projectId: string, reportId: string) {
  return runAction(async () => {
    await actionProject(projectId);
    const row = await requireReport(projectId, reportId);
    return { aiStatus: row.aiStatus, aiError: row.aiError, updatedAt: row.updatedAt.toISOString() };
  });
}

/* ───────────────────────────── Public share unlock ───────────────────────────── */

export async function unlockShareAction(token: string, password: string) {
  return runAction(async () => {
    if (typeof token !== "string" || !SHARE_TOKEN_RE.test(token)) throw new ActionError("This report isn't shared.", "not_found");
    const pw = typeof password === "string" ? password.slice(0, 1024) : "";
    const ip = (await clientIp(await headers())) ?? "unknown";
    // per-IP (trusted proxy address, not the client-controlled X-Forwarded-For first hop) and a
    // global per-link limit that holds even when an attacker rotates IPs
    const perIp = rateLimit(`reports:unlock:${ip}:${token}`, 10, 15 * 60_000);
    const perToken = rateLimit(`reports:unlock:token:${token}`, 20, 15 * 60_000);
    if (!perIp || !perToken) throw new ActionError("Too many attempts. Try again in a few minutes.", "conflict");
    const found = await getReportByShareToken(token);
    if (!found || !found.r.sharePasswordHash) throw new ActionError("This report isn't shared.", "not_found");
    if (!(await verifySharePassword(pw, found.r.sharePasswordHash))) throw new ActionError("Wrong password.", "invalid");
    const jar = await cookies();
    jar.set(shareCookieName(token), shareCookieValue(token, found.r.sharePasswordHash), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: `/share/r/${token}`,
      maxAge: 12 * 60 * 60,
    });
    return true;
  });
}

export async function getDeckAction(projectId: string, reportId: string) {
  return runAction(async () => {
    await actionProject(projectId);
    const row = await requireReport(projectId, idSchema.parse(reportId));
    const deck = row.kind === "deck" ? parseDeck(row.document) : null;
    if (!deck) throw new ActionError("This report has no slides.", "invalid");
    return { deck, title: row.title, subtitle: row.subtitle, dateRange: row.dateRange };
  });
}
