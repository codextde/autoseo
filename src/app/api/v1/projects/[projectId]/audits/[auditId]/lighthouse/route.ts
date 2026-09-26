import { getApiProject } from "@/server/api/auth";
import { apiRoute } from "@/server/api/handler";
import { auditLighthouse } from "@/server/api/audit";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/audits/{auditId}/lighthouse — Lighthouse scores per URL/strategy. */
export const GET = apiRoute<{ projectId: string; auditId: string }>({ scope: "read" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await auditLighthouse(project.id, params.auditId) };
});

export const OPTIONS = corsPreflight;
