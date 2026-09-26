import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { deleteTemplateForApi, saveTemplateForApi, saveTemplateInput } from "@/server/api/reports";
import { corsPreflight } from "@/server/api/urls";

type Params = { projectId: string; templateId: string };

/** PUT /api/v1/projects/{projectId}/report-templates/{templateId} — update an instruction template. */
export const PUT = apiRoute<Params>({ scope: "write", permission: "reports.manage" }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, saveTemplateInput.omit({ templateId: true }));
  return { data: await saveTemplateForApi(principal, project, { ...body, templateId: params.templateId }) };
});

/** DELETE /api/v1/projects/{projectId}/report-templates/{templateId} */
export const DELETE = apiRoute<Params>({ scope: "write", permission: "reports.manage" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await deleteTemplateForApi(project, params.templateId) };
});

export const OPTIONS = corsPreflight;
