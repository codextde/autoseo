import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { buildAiScope, getQueryFanouts } from "@/server/api/ai-data";
import { FILTER_ARRAY_KEYS, toAiFilter, type ProjectParams } from "@/server/api/rest";
import { fanoutsQuery } from "@/server/api/schemas";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/fanouts — AI query fan-outs (default last 90 days). */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, fanoutsQuery, FILTER_ARRAY_KEYS);
  const r = await getQueryFanouts(await buildAiScope(project, toAiFilter(q), 90), { search: q.search, promptId: q.promptId, limit: q.limit, page: q.page });
  return { data: r.items, meta: { period: r.period, pagination: r.pagination } };
});

export const OPTIONS = corsPreflight;
