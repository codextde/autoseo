import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { buildAiScope, getTopSources } from "@/server/api/ai-data";
import { FILTER_ARRAY_KEYS, toAiFilter, type ProjectParams } from "@/server/api/rest";
import { sourcesQuery } from "@/server/api/schemas";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/sources — sources cited in AI answers. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, sourcesQuery, FILTER_ARRAY_KEYS);
  const r = await getTopSources(await buildAiScope(project, toAiFilter(q)), {
    limit: q.limit,
    page: q.page,
    contentType: q.type,
    ownership: q.ownership,
    search: q.search,
    domains: q.groupBy === "domain",
  });
  return { data: r.items, meta: { period: r.period, groupedBy: r.groupedBy, pagination: r.pagination } };
});

export const OPTIONS = corsPreflight;
