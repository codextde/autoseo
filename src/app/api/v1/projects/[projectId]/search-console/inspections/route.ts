import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { inspectionsQuery, recentInspectionsForApi } from "@/server/api/inspection";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/search-console/inspections — recent URL inspections + today's quota. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, inspectionsQuery);
  const r = await recentInspectionsForApi(project, q.limit);
  return { data: r.items, meta: { quota: r.quota } };
});

export const OPTIONS = corsPreflight;
