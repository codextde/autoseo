import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { generateReportForApi, generateReportInput } from "@/server/api/reports";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";
import { env } from "@/server/env";

/** POST /api/v1/projects/{projectId}/reports/generate — AI-written HTML report from live data (job). */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "reports.manage", spend: true }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, generateReportInput);
  return { status: 202, data: await generateReportForApi(principal, project, env.appUrl, body) };
});

export const OPTIONS = corsPreflight;
