import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody, parseQuery } from "@/server/api/handler";
import { listReportsForApi, listReportsQuery, saveReportForApi, saveReportInput } from "@/server/api/reports";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";
import { env } from "@/server/env";

/** GET /api/v1/projects/{projectId}/reports — reports (HTML + decks), newest first. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, listReportsQuery);
  const r = await listReportsForApi(project, env.appUrl, q);
  return { data: r.items, meta: { total: r.total, remaining: r.remaining, limit: q.limit, offset: q.offset } };
});

/** POST /api/v1/projects/{projectId}/reports — save an agent-written HTML report (reports.manage). */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "reports.manage" }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, saveReportInput);
  const r = await saveReportForApi(principal, project, env.appUrl, body);
  return { status: r.created ? 201 : 200, data: r };
});

export const OPTIONS = corsPreflight;
