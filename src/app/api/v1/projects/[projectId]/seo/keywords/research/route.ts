import { apiRoute, parseBody } from "@/server/api/handler";
import { researchKeywordsBody, researchKeywordsForApi, restSeoContext } from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/seo/keywords/research — keyword ideas for 1–5 seeds (paid DataForSEO, cached 24h; seo.run on cache miss). */
export const POST = apiRoute<ProjectParams>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await researchKeywordsForApi(ctx, await parseBody(req, researchKeywordsBody)) };
});

export const OPTIONS = corsPreflight;
