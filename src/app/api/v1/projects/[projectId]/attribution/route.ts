import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody, parseQuery } from "@/server/api/handler";
import { attributionListQuery, createAttributionForApi, listAttributionsForApi } from "@/server/api/attribution";
import { createAttributionSchema } from "@/server/attribution/service";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/attribution — attribution responses (newest first). */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, attributionListQuery);
  const res = await listAttributionsForApi(project.id, q);
  return { data: res.items, meta: { pagination: res.pagination } };
});

/** POST /api/v1/projects/{projectId}/attribution — record one attribution response. */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "attribution.manage" }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, createAttributionSchema);
  return { status: 201, data: await createAttributionForApi(project.id, body) };
});

export const OPTIONS = corsPreflight;
