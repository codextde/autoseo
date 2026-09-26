import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { attributionBulkBody, bulkAttributionsForApi } from "@/server/api/attribution";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/attribution/bulk — up to 1000 attributions; invalid items are reported by index. */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "attribution.manage" }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, attributionBulkBody);
  const res = await bulkAttributionsForApi(project.id, body);
  return { status: res.created ? 201 : 400, data: res };
});

export const OPTIONS = corsPreflight;
