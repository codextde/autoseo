import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody, parseQuery } from "@/server/api/handler";
import { buildAiScope, listPromptsWithMetrics } from "@/server/api/ai-data";
import { addPromptsToProject } from "@/server/api/prompts";
import { FILTER_ARRAY_KEYS, toAiFilter, type ProjectParams } from "@/server/api/rest";
import { promptsCreateBody, promptsListQuery } from "@/server/api/schemas";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/prompts — tracked prompts with visibility metrics. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, promptsListQuery, FILTER_ARRAY_KEYS);
  const scope = await buildAiScope(project, toAiFilter(q));
  const res = await listPromptsWithMetrics(scope, { search: q.search, status: q.status, language: q.language, country: q.country, page: q.page, limit: q.limit });
  return { data: res.items, meta: { period: res.period, pagination: res.pagination } };
});

/** POST /api/v1/projects/{projectId}/prompts — add prompts to tracking (write scope + prompts.manage). */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "prompts.manage", spend: true }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, promptsCreateBody);
  const res = await addPromptsToProject(project, {
    prompts: body.prompts.map((p) =>
      typeof p === "string"
        ? { text: p, country: body.country, tags: body.tags }
        : { text: p.text, country: p.country ?? body.country, language: p.language, tags: [...(body.tags ?? []), ...(p.tags ?? [])] },
    ),
    models: body.models,
    runNow: body.runNow,
    userId: principal.user.id,
  });
  return { status: 201, data: res };
});

export const OPTIONS = corsPreflight;
