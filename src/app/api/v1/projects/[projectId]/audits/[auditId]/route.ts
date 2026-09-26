import { getApiProject } from "@/server/api/auth";
import { apiRoute } from "@/server/api/handler";
import { auditOverview, auditStatus } from "@/server/api/audit";
import { corsPreflight } from "@/server/api/urls";
import { deleteAudit } from "@/server/audit-crawler/service";
import { logAudit } from "@/server/audit";

type Params = { projectId: string; auditId: string };

/** GET /api/v1/projects/{projectId}/audits/{auditId} — progress + overview (score, categories, page stats, Lighthouse). */
export const GET = apiRoute<Params>({ scope: "read" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  const [status, overview] = await Promise.all([auditStatus(project.id, params.auditId, 20), auditOverview(project.id, params.auditId)]);
  return { data: { status, overview } };
});

/** DELETE /api/v1/projects/{projectId}/audits/{auditId} — delete an audit and all its data (write + seo.run). */
export const DELETE = apiRoute<Params>({ scope: "write", permission: "seo.run" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  await deleteAudit(project.id, params.auditId);
  void logAudit("site_audit.delete", {
    actor: { id: principal.user.id, email: principal.user.email },
    targetType: "site_audit",
    targetId: params.auditId,
    projectId: project.id,
    workspaceId: project.workspaceId,
    meta: { via: "api" },
  });
  return { data: { auditId: params.auditId, deleted: true } };
});

export const OPTIONS = corsPreflight;
