import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { attributionSummaryForApi, attributionSummaryQuery } from "@/server/api/attribution";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/attribution/summary — AI search share, deal value, breakdowns. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, attributionSummaryQuery);
  return { data: await attributionSummaryForApi(project.id, q) };
});

export const OPTIONS = corsPreflight;
