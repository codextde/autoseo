import { apiRoute, parseBody } from "@/server/api/handler";
import { domainOverviewBody, domainKeywordSuggestionsForApi, restSeoContext } from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/seo/domain/keyword-suggestions — top 100 ranked keywords by traffic (paid, cached 12h). */
export const POST = apiRoute<ProjectParams>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await domainKeywordSuggestionsForApi(ctx, await parseBody(req, domainOverviewBody)) };
});

export const OPTIONS = corsPreflight;
