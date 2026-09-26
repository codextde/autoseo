import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { optimizeUrlForApi, optimizeUrlInput } from "@/server/api/optimize";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/content/optimize-url — import + (AI) rewrite a public page (job). */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "prompts.manage", spend: true }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, optimizeUrlInput);
  return { status: 202, data: await optimizeUrlForApi(principal, project, body) };
});

export const OPTIONS = corsPreflight;
