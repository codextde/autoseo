import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { auditLighthouseResult, lighthouseResultQuery } from "@/server/api/audit";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/audits/{auditId}/lighthouse/{resultId} — prioritized Lighthouse issues. */
export const GET = apiRoute<{ projectId: string; auditId: string; resultId: string }>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, lighthouseResultQuery);
  return { data: await auditLighthouseResult(project.id, params.auditId, params.resultId, q.category) };
});

export const OPTIONS = corsPreflight;
