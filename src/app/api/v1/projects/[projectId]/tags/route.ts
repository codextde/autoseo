import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { getTags } from "@/server/api/ai-data";
import { createAndApplyTags } from "@/server/api/prompts";
import type { ProjectParams } from "@/server/api/rest";
import { tagsCreateBody } from "@/server/api/schemas";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/tags — prompt tags with counts. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await getTags(project.id) };
});

/** POST /api/v1/projects/{projectId}/tags — create tags and optionally apply them to prompts. */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "prompts.manage" }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const b = await parseBody(req, tagsCreateBody);
  const names = [...new Set([...(b.name ? [b.name] : []), ...(b.names ?? [])])];
  return { status: 201, data: await createAndApplyTags(project, names, b.promptIds, b.mode) };
});

export const OPTIONS = corsPreflight;
