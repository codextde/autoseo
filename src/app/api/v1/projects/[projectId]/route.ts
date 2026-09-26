import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { projectCounts, projectDto } from "@/server/api/ai-data";
import { updateProjectBody, updateProjectFromApi } from "@/server/api/projects";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";
import { env } from "@/server/env";

/** GET /api/v1/projects/{projectId} */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  const counts = (await projectCounts([project.id])).get(project.id);
  return { data: { ...projectDto(project, env.appUrl), activePrompts: counts?.prompts ?? 0, competitors: counts?.competitors ?? 0 } };
});

/** PUT /api/v1/projects/{projectId} — partial update (write scope + projects.manage). */
export const PUT = apiRoute<ProjectParams>({ scope: "write", permission: "projects.manage" }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, updateProjectBody);
  const updated = await updateProjectFromApi(principal, project, body);
  return { data: projectDto(updated, env.appUrl) };
});

export const PATCH = PUT;
export const OPTIONS = corsPreflight;
