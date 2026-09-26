import { apiRoute, parseBody } from "@/server/api/handler";
import { serpResultsBody, serpResultsForApi, restSeoContext } from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/seo/serp — Google organic SERP for 1–10 keywords (paid, cached 12h; seo.run on cache miss). */
export const POST = apiRoute<ProjectParams>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await serpResultsForApi(ctx, await parseBody(req, serpResultsBody)) };
});

export const OPTIONS = corsPreflight;
