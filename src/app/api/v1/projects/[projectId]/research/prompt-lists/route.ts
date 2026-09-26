import { getApiProject } from "@/server/api/auth";
import { apiRoute } from "@/server/api/handler";
import { listResearchLists } from "@/server/api/research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/research/prompt-lists — prompt research lists. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await listResearchLists(project) };
});

export const OPTIONS = corsPreflight;
