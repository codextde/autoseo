import { apiRoute, parseBody, parseQuery } from "@/server/api/handler";
import {
  listSavedKeywordsForApi,
  listSavedKeywordsQuery,
  removeSavedKeywordsBody,
  removeSavedKeywordsForApi,
  restSeoContext,
  saveKeywordsBody,
  saveKeywordsForApi,
} from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/seo/saved-keywords — saved keywords with metrics and tags (free). */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  const q = parseQuery(url, listSavedKeywordsQuery, ["tags"]);
  const { pagination, ...data } = await listSavedKeywordsForApi(ctx, { ...q, limit: q.limit as 50 | 100 | 250 });
  return { data: data.rows, meta: { pagination, tags: data.tags, url: data.url } };
});

/** POST /api/v1/projects/{projectId}/seo/saved-keywords — save keywords (+ metrics, tags). */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "seo.run" }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { status: 201, data: await saveKeywordsForApi(ctx, await parseBody(req, saveKeywordsBody)) };
});

/** DELETE /api/v1/projects/{projectId}/seo/saved-keywords — remove saved keywords by id (JSON body). */
export const DELETE = apiRoute<ProjectParams>({ scope: "write", permission: "seo.run" }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await removeSavedKeywordsForApi(ctx, await parseBody(req, removeSavedKeywordsBody)) };
});

export const OPTIONS = corsPreflight;
