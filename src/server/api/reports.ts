import "server-only";
import { z } from "zod";
import { ActionError } from "@/server/auth/guards";
import { enqueueJob } from "@/server/jobs/queue";
import { logAudit } from "@/server/audit";
import {
  createHtmlReport,
  createHtmlTemplate,
  deleteReport,
  deleteTemplate,
  getReport,
  getTemplate,
  listReports,
  listTemplates,
  MAX_HTML_BYTES,
  revokeShare,
  saveHtmlReport,
  updateShare,
  updateTemplate,
  type ReportRow,
} from "@/server/reports/service";
import type { ApiPrincipal, ApiProject } from "./auth";
import { checkRateLimit } from "./rate-limit";
import { ApiError, type ApiErrorCode } from "./errors";

/**
 * Reports (agent-written HTML reports + templates + share links) for REST v1 and MCP — open-seo's
 * save_report / list_reports / get_report / delete_report / *_report_template tools. Writes need
 * `reports.manage`. Slide decks are listed and readable (metadata) but edited in the app.
 */

const ACTION_CODES: Record<ActionError["code"], ApiErrorCode> = {
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  not_found: "not_found",
  invalid: "validation_error",
  conflict: "conflict",
  error: "validation_error",
};

/** The reports service throws `ActionError`s → API errors. */
async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ActionError) throw new ApiError(ACTION_CODES[err.code] ?? "validation_error", err.message);
    throw err;
  }
}

/** Label stored as "created by" on agent-written reports. */
export function clientLabel(p: ApiPrincipal): string {
  return (p.kind === "oauth" ? p.name : `API key · ${p.name}`).replace(/[^A-Za-z0-9._+\- ·]/g, "").slice(0, 60) || "API";
}

export function reportUrls(baseUrl: string, projectId: string, r: Pick<ReportRow, "id" | "shareToken" | "shareEnabled">) {
  return {
    url: `${baseUrl}/p/${projectId}/reports/${r.id}`,
    shareUrl: r.shareEnabled && r.shareToken ? `${baseUrl}/share/r/${r.shareToken}` : null,
  };
}

export const listReportsQuery = z.object({
  kind: z.enum(["deck", "html", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export async function listReportsForApi(project: ApiProject, baseUrl: string, q: z.infer<typeof listReportsQuery>) {
  let rows = await listReports(project.id);
  if (q.kind !== "all") rows = rows.filter((r) => r.kind === q.kind);
  const page = rows.slice(q.offset, q.offset + q.limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      subtitle: r.subtitle,
      status: r.status,
      aiStatus: r.aiStatus,
      aiError: r.aiError,
      slideCount: r.slideCount,
      sizeBytes: r.sizeBytes,
      shareEnabled: r.shareEnabled,
      createdBy: r.createdByLabel ?? r.createdByName,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      url: `${baseUrl}/p/${project.id}/reports/${r.id}`,
    })),
    total: rows.length,
    remaining: Math.max(0, rows.length - q.offset - page.length),
  };
}

export const reportDetailQuery = z.object({
  includeHtml: z.enum(["true", "false"]).optional().describe("Include the HTML of an HTML report."),
});

export async function getReportForApi(project: ApiProject, baseUrl: string, reportId: string, includeHtml: boolean) {
  const r = await getReport(project.id, reportId);
  if (!r) throw new ApiError("not_found", "Report not found.");
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    subtitle: r.subtitle,
    status: r.status,
    summary: r.summary,
    prompt: r.prompt,
    aiStatus: r.aiStatus,
    aiError: r.aiError,
    templateKey: r.templateKey,
    dateRange: r.dateRange,
    slideCount: r.slideCount,
    htmlBytes: r.sizeBytes,
    share: {
      enabled: r.shareEnabled,
      hasPassword: Boolean(r.sharePasswordHash),
      expiresAt: r.shareExpiresAt?.toISOString() ?? null,
      views: r.shareViews,
    },
    createdBy: r.createdByLabel,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...reportUrls(baseUrl, project.id, r),
    ...(includeHtml && r.kind === "html" ? { html: r.html ?? "" } : {}),
  };
}

export const saveReportInput = z.object({
  title: z.string().trim().min(1).max(160).describe('Report type + full date, e.g. "Competitive Landscape — Sep 17, 2026".'),
  summary: z.string().trim().max(2500).optional().describe("Markdown summary: verdict, top action, key numbers (≤2,500 chars)."),
  html: z
    .string()
    .min(20)
    .describe(`Complete self-contained HTML document (must contain <html and end with </html>; ≤${Math.floor(MAX_HTML_BYTES / 1000)} KB; no external scripts).`),
  reportId: z.string().min(1).max(64).optional().describe("Replace this existing HTML report in place."),
});

export async function saveReportForApi(p: ApiPrincipal, project: ApiProject, baseUrl: string, raw: z.input<typeof saveReportInput>) {
  const data = saveReportInput.parse(raw);
  const row = await mapped(() =>
    saveHtmlReport({
      projectId: project.id,
      workspaceId: project.workspaceId,
      title: data.title,
      html: data.html,
      summary: data.summary ?? null,
      reportId: data.reportId ?? null,
      userId: p.user.id,
      createdByLabel: clientLabel(p),
    }),
  );
  void logAudit(data.reportId ? "report.update" : "report.create", {
    actor: { id: p.user.id, email: p.user.email },
    targetType: "report",
    targetId: row.id,
    projectId: project.id,
    workspaceId: project.workspaceId,
    meta: { via: "api", kind: "html" },
  });
  return { reportId: row.id, title: row.title, created: !data.reportId, htmlBytes: row.sizeBytes, ...reportUrls(baseUrl, project.id, row) };
}

export const generateReportInput = z.object({
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(3).max(4000).describe("What the report should cover (audience, focus, sections)."),
  templateId: z.string().min(1).max(64).optional().describe("Workspace report template to follow (see list_report_templates)."),
  period: z.enum(["7d", "30d", "90d", "mtd", "last_month"]).optional().describe("Data period (default 30d)."),
});

export async function generateReportForApi(p: ApiPrincipal, project: ApiProject, baseUrl: string, raw: z.input<typeof generateReportInput>) {
  const data = generateReportInput.parse(raw);
  if (data.templateId && !(await getTemplate(project.workspaceId, data.templateId))) throw new ApiError("not_found", "Report template not found.");
  const rl = checkRateLimit(`reports:ai:${p.user.id}`, 20, 60 * 60_000);
  if (!rl.allowed) throw new ApiError("rate_limited", "Too many AI reports — try again later.");
  const row = await mapped(() =>
    createHtmlReport({
      projectId: project.id,
      workspaceId: project.workspaceId,
      userId: p.user.id,
      title: data.title,
      prompt: data.prompt,
      templateId: data.templateId ?? null,
      dateRange: { preset: data.period ?? "30d" },
      createdByLabel: clientLabel(p),
    }),
  );
  const job = await enqueueJob("reports.generate_html", { reportId: row.id }, { projectId: project.id, workspaceId: project.workspaceId, createdBy: p.user.id, maxAttempts: 1 });
  void logAudit("report.create_ai", {
    actor: { id: p.user.id, email: p.user.email },
    targetType: "report",
    targetId: row.id,
    projectId: project.id,
    workspaceId: project.workspaceId,
    meta: { via: "api" },
  });
  return { reportId: row.id, status: "queued" as const, jobId: job?.id ?? null, ...reportUrls(baseUrl, project.id, row) };
}

export async function deleteReportForApi(p: ApiPrincipal, project: ApiProject, reportId: string) {
  await mapped(() => deleteReport(project.id, reportId));
  void logAudit("report.delete", {
    actor: { id: p.user.id, email: p.user.email },
    targetType: "report",
    targetId: reportId,
    projectId: project.id,
    workspaceId: project.workspaceId,
    meta: { via: "api" },
  });
  return { reportId, deleted: true };
}

export const shareReportInput = z.object({
  enabled: z.boolean().describe("true = create / keep a public link, false = disable it."),
  password: z.string().min(4).max(200).nullable().optional().describe("Protect the link with a password (null removes it)."),
  expiresAt: z.string().max(40).nullable().optional().describe("Expiry (YYYY-MM-DD or ISO date-time; null = never)."),
  revoke: z.boolean().optional().describe("Revoke permanently: disables the link and rotates the token (old URL dies)."),
});

export async function shareReportForApi(p: ApiPrincipal, project: ApiProject, baseUrl: string, reportId: string, raw: z.input<typeof shareReportInput>) {
  const data = shareReportInput.parse(raw);
  let expiresAt: string | null | undefined = data.expiresAt;
  if (typeof expiresAt === "string") {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ? `${expiresAt}T23:59:59.000Z` : expiresAt;
    if (Number.isNaN(Date.parse(iso))) throw new ApiError("validation_error", "expiresAt must be YYYY-MM-DD or an ISO date-time.");
    expiresAt = iso;
  }
  const row = await mapped(() =>
    data.revoke
      ? revokeShare(project.id, reportId, p.user.id)
      : updateShare(project.id, reportId, { enabled: data.enabled, password: data.password, expiresAt }, p.user.id),
  );
  void logAudit(data.revoke ? "report.share_revoke" : data.enabled ? "report.share" : "report.unshare", {
    actor: { id: p.user.id, email: p.user.email },
    targetType: "report",
    targetId: reportId,
    projectId: project.id,
    workspaceId: project.workspaceId,
    meta: { via: "api" },
  });
  return {
    reportId,
    shareEnabled: row.shareEnabled,
    hasPassword: Boolean(row.sharePasswordHash),
    expiresAt: row.shareExpiresAt?.toISOString() ?? null,
    ...reportUrls(baseUrl, project.id, row),
  };
}

/* ───────────────────────────── Templates ───────────────────────────── */

export async function listTemplatesForApi(project: ApiProject) {
  const rows = await listTemplates(project.workspaceId);
  return rows.map((t) => ({
    id: t.id,
    kind: t.kind,
    name: t.name,
    description: t.description,
    instructions: t.instructions,
    instructionsPreview: (t.instructions ?? "").slice(0, 300),
    slideCount: t.slideCount,
    updatedAt: t.updatedAt,
  }));
}

export const saveTemplateInput = z.object({
  templateId: z.string().min(1).max(64).optional().describe("Update this template (omit to create)."),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional().describe("When to use this template."),
  instructions: z.string().trim().min(3).max(3000).describe("Markdown: audience, sections in order, tone, sign-off (optional `accent: #hex`)."),
});

export async function saveTemplateForApi(p: ApiPrincipal, project: ApiProject, raw: z.input<typeof saveTemplateInput>) {
  const data = saveTemplateInput.parse(raw);
  const existing = await listTemplates(project.workspaceId);
  const clash = existing.find((t) => t.name.toLowerCase() === data.name.toLowerCase() && t.id !== data.templateId);
  if (clash) throw new ApiError("conflict", `A template named "${clash.name}" already exists (${clash.id}).`);
  if (data.templateId) {
    const cur = existing.find((t) => t.id === data.templateId);
    if (!cur) throw new ApiError("not_found", "Report template not found.");
    if (cur.kind !== "html") throw new ApiError("validation_error", "Slide-deck templates are edited in the app; only instruction templates can be changed here.");
    const tpl = await mapped(() =>
      updateTemplate(project.workspaceId, data.templateId!, { name: data.name, description: data.description ?? null, instructions: data.instructions }),
    );
    return { templateId: tpl.id, name: tpl.name, created: false };
  }
  if (existing.length >= 200) throw new ApiError("conflict", "Template limit reached (200 per workspace).");
  const tpl = await createHtmlTemplate({ workspaceId: project.workspaceId, userId: p.user.id, name: data.name, description: data.description ?? null, instructions: data.instructions });
  return { templateId: tpl.id, name: tpl.name, created: true };
}

export async function deleteTemplateForApi(project: ApiProject, templateId: string) {
  await mapped(() => deleteTemplate(project.workspaceId, templateId));
  return { templateId, deleted: true };
}
