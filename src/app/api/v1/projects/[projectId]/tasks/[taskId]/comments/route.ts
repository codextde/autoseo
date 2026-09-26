import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { commentOnTask, taskCommentInput } from "@/server/api/optimize";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/tasks/{taskId}/comments — add a comment to the task activity. */
export const POST = apiRoute<{ projectId: string; taskId: string }>({ scope: "write", permission: "prompts.manage" }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const { body } = await parseBody(req, taskCommentInput);
  return { status: 201, data: await commentOnTask(principal, project, params.taskId, body) };
});

export const OPTIONS = corsPreflight;
