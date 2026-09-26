import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { buildAiScope, getCompetitorRanking } from "@/server/api/ai-data";
import { FILTER_ARRAY_KEYS, paginate, toAiFilter, type ProjectParams } from "@/server/api/rest";
import { competitorsQuery } from "@/server/api/schemas";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/competitors — brand ranking incl. your own brand. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, competitorsQuery, FILTER_ARRAY_KEYS);
  const r = await getCompetitorRanking(await buildAiScope(project, toAiFilter(q)), {
    sortBy: q.sortBy,
    order: q.order,
    includeUntracked: q.includeUntracked === "true",
  });
  const page = paginate(r.items, q.page, q.limit);
  return { data: page.items, meta: { period: r.period, sortBy: r.sortBy, order: r.order, totals: r.totals, pagination: page.pagination } };
});

export const OPTIONS = corsPreflight;
