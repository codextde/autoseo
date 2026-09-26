import { getApiProject } from "@/server/api/auth";
import { apiRoute } from "@/server/api/handler";
import { corsPreflight } from "@/server/api/urls";
import { stopAudit } from "@/server/audit-crawler/service";

/** POST /api/v1/projects/{projectId}/audits/{auditId}/stop — stop a running audit (write + seo.run). */
export const POST = apiRoute<{ projectId: string; auditId: string }>({ scope: "write", permission: "seo.run" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: { auditId: params.auditId, ...(await stopAudit(project.id, params.auditId)) } };
});

export const OPTIONS = corsPreflight;
