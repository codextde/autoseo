import { apiRoute, parseBody } from "@/server/api/handler";
import { keywordMetricsBody, keywordMetricsForApi, restSeoContext } from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/seo/keywords/metrics — metrics for up to 700 keywords (paid DataForSEO; seo.run). */
export const POST = apiRoute<ProjectParams>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await keywordMetricsForApi(ctx, await parseBody(req, keywordMetricsBody)) };
});

export const OPTIONS = corsPreflight;
