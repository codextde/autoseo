import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { buildAiScope, getVisibilityTimeseries } from "@/server/api/ai-data";
import { FILTER_ARRAY_KEYS, toAiFilter, type ProjectParams } from "@/server/api/rest";
import { filterOnlyQuery } from "@/server/api/schemas";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/metrics/timeseries — daily visibility series. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, filterOnlyQuery, FILTER_ARRAY_KEYS);
  const t = await getVisibilityTimeseries(await buildAiScope(project, toAiFilter(q)));
  return { data: t.series, meta: { period: t.period } };
});

export const OPTIONS = corsPreflight;
