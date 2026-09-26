import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { scPerformanceInput, searchConsolePerformance } from "@/server/api/analytics";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/search-console — Search Console / Bing performance (totals + rows by dimension). */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, scPerformanceInput, ["intents", "countries"]);
  const { rows, ...rest } = await searchConsolePerformance(project.id, q);
  return {
    data: rows,
    meta: { ...rest, pagination: { offset: q.offset, limit: q.limit, total: rest.totalRowCount, hasMore: rest.hasMore } },
  };
});

export const OPTIONS = corsPreflight;
