import { getApiProject } from "@/server/api/auth";
import { apiRoute } from "@/server/api/handler";
import { getTaskForApi } from "@/server/api/tasks";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/tasks/{taskId} — task with steps, evidence and activity. */
export const GET = apiRoute<{ projectId: string; taskId: string }>({ scope: "read" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await getTaskForApi(project.id, params.taskId) };
});

export const OPTIONS = corsPreflight;
