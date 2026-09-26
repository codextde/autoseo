import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody, parseQuery } from "@/server/api/handler";
import { contentListQuery, generateContentForApi, generateContentInput, listContentForApi } from "@/server/api/optimize";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/content — content pieces with AEO scores + summary. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, contentListQuery);
  const r = await listContentForApi(project, q);
  return { data: r.items, meta: { summary: r.summary, pagination: r.pagination } };
});

/** POST /api/v1/projects/{projectId}/content — generate an AI-optimized article (job). */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "prompts.manage", spend: true }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, generateContentInput);
  return { status: 202, data: await generateContentForApi(principal, project, body) };
});

export const OPTIONS = corsPreflight;
