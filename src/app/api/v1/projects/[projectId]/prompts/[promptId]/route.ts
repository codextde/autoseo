import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { buildAiScope, getPromptDetails } from "@/server/api/ai-data";
import { FILTER_ARRAY_KEYS, toAiFilter } from "@/server/api/rest";
import { filterOnlyQuery } from "@/server/api/schemas";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/prompts/{promptId} — per-model metrics and recent answers. */
export const GET = apiRoute<{ projectId: string; promptId: string }>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, filterOnlyQuery, FILTER_ARRAY_KEYS);
  const scope = await buildAiScope(project, toAiFilter(q));
  const { period, ...data } = await getPromptDetails(scope, params.promptId);
  return { data, meta: { period } };
});

export const OPTIONS = corsPreflight;
