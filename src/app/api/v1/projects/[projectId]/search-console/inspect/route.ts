import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { inspectUrlForApi, inspectUrlInput } from "@/server/api/inspection";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/**
 * POST /api/v1/projects/{projectId}/search-console/inspect — Google URL Inspection for one page.
 * Cached results (< 24 h) for anyone with read access; live calls need seo.run or settings.manage.
 */
export const POST = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, inspectUrlInput);
  return { data: await inspectUrlForApi(principal, project, body) };
});

export const OPTIONS = corsPreflight;
