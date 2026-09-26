import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { auditPages, auditPagesQuery } from "@/server/api/audit";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/audits/{auditId}/pages — crawled pages with SEO data. */
export const GET = apiRoute<{ projectId: string; auditId: string }>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const r = await auditPages(project.id, params.auditId, parseQuery(url, auditPagesQuery));
  return { data: r.pages, meta: { pagination: r.pagination } };
});

export const OPTIONS = corsPreflight;
