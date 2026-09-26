import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { runFactCheckForApi, runFactCheckInput } from "@/server/api/optimize";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/fact-check/run — queue a fact-check run (all assets or one). */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "prompts.manage", spend: true }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, runFactCheckInput);
  return { status: 202, data: await runFactCheckForApi(principal, project, body) };
});

export const OPTIONS = corsPreflight;
