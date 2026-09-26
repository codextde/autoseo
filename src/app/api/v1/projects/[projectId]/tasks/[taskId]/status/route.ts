import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { getTaskForApi } from "@/server/api/tasks";
import { taskStatusInput, updateTaskStatus } from "@/server/api/optimize";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/tasks/{taskId}/status — set a task's status. */
export const POST = apiRoute<{ projectId: string; taskId: string }>({ scope: "write", permission: "prompts.manage" }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const { status } = await parseBody(req, taskStatusInput);
  await getTaskForApi(project.id, params.taskId);
  const r = await updateTaskStatus(principal, project, [params.taskId], status);
  return { data: { taskId: params.taskId, status, changed: r.changed > 0 } };
});

export const OPTIONS = corsPreflight;
