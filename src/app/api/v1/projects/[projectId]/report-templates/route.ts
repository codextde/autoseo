import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { listTemplatesForApi, saveTemplateForApi, saveTemplateInput } from "@/server/api/reports";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/report-templates — workspace report templates. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await listTemplatesForApi(project) };
});

/** POST /api/v1/projects/{projectId}/report-templates — create an instruction template. */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "reports.manage" }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, saveTemplateInput.omit({ templateId: true }));
  return { status: 201, data: await saveTemplateForApi(principal, project, body) };
});

export const OPTIONS = corsPreflight;
