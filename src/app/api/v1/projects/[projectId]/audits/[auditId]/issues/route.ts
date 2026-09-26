import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { auditIssues, auditIssuesQuery } from "@/server/api/audit";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/audits/{auditId}/issues — issue summary + affected URLs. */
export const GET = apiRoute<{ projectId: string; auditId: string }>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const r = await auditIssues(project.id, params.auditId, parseQuery(url, auditIssuesQuery));
  return { data: { summary: r.summary, issues: r.issues }, meta: { pagination: r.pagination } };
});

export const OPTIONS = corsPreflight;
