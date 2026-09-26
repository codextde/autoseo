import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody, parseQuery } from "@/server/api/handler";
import { deleteReportForApi, getReportForApi, reportDetailQuery, saveReportForApi, saveReportInput } from "@/server/api/reports";
import { corsPreflight } from "@/server/api/urls";
import { env } from "@/server/env";

type Params = { projectId: string; reportId: string };

/** GET /api/v1/projects/{projectId}/reports/{reportId} — metadata, summary, share link (+ HTML). */
export const GET = apiRoute<Params>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, reportDetailQuery);
  return { data: await getReportForApi(project, env.appUrl, params.reportId, q.includeHtml === "true") };
});

/** PUT /api/v1/projects/{projectId}/reports/{reportId} — replace an HTML report in place. */
export const PUT = apiRoute<Params>({ scope: "write", permission: "reports.manage" }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, saveReportInput.omit({ reportId: true }));
  return { data: await saveReportForApi(principal, project, env.appUrl, { ...body, reportId: params.reportId }) };
});

/** DELETE /api/v1/projects/{projectId}/reports/{reportId} */
export const DELETE = apiRoute<Params>({ scope: "write", permission: "reports.manage" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await deleteReportForApi(principal, project, params.reportId) };
});

export const OPTIONS = corsPreflight;
