import { apiRoute, parseBody } from "@/server/api/handler";
import { listSavedKeywordTagsForApi, restSeoContext, tagSavedKeywordsBody, tagSavedKeywordsForApi } from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/seo/saved-keywords/tags — saved-keyword tags with counts. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await listSavedKeywordTagsForApi(ctx) };
});

/** POST /api/v1/projects/{projectId}/seo/saved-keywords/tags — add / remove tags on saved keywords. */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "seo.run" }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await tagSavedKeywordsForApi(ctx, await parseBody(req, tagSavedKeywordsBody)) };
});

export const OPTIONS = corsPreflight;
