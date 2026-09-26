import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { generateResearchInput, generateResearchList } from "@/server/api/research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/research/prompt-lists/generate — AI prompt set generation (job). */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "prompts.manage", spend: true }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, generateResearchInput);
  return { status: 202, data: await generateResearchList(principal, project, body) };
});

export const OPTIONS = corsPreflight;
