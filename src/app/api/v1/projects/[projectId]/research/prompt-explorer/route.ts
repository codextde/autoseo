import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { promptExplorerInput, startPromptExplorer } from "@/server/api/research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/research/prompt-explorer — ask a prompt to several AI models (seo.run). */
export const POST = apiRoute<ProjectParams>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, promptExplorerInput);
  return { status: 202, data: await startPromptExplorer(principal, project, body) };
});

export const OPTIONS = corsPreflight;
