import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { listTasksForApi, tasksQuery } from "@/server/api/tasks";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/tasks — prioritized optimization tasks with counts. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, tasksQuery);
  const res = await listTasksForApi(project.id, q);
  return { data: res.items, meta: { counts: res.counts, pagination: res.pagination } };
});

export const OPTIONS = corsPreflight;
