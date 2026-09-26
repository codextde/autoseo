import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { buildAiScope, getFanoutDetails } from "@/server/api/ai-data";
import { FILTER_ARRAY_KEYS, toAiFilter, type ProjectParams } from "@/server/api/rest";
import { fanoutDetailsQuery } from "@/server/api/schemas";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/fanouts/details?query=… — where one fan-out query came from. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, fanoutDetailsQuery, FILTER_ARRAY_KEYS);
  const { period, ...data } = await getFanoutDetails(await buildAiScope(project, toAiFilter(q), 90), q.query);
  return { data, meta: { period } };
});

export const OPTIONS = corsPreflight;
