import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { shareReportForApi, shareReportInput } from "@/server/api/reports";
import { corsPreflight } from "@/server/api/urls";
import { env } from "@/server/env";

/** POST /api/v1/projects/{projectId}/reports/{reportId}/share — enable / update / disable / revoke the share link. */
export const POST = apiRoute<{ projectId: string; reportId: string }>({ scope: "write", permission: "reports.manage" }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, shareReportInput);
  return { data: await shareReportForApi(principal, project, env.appUrl, params.reportId, body) };
});

export const OPTIONS = corsPreflight;
