import { apiRoute, parseBody } from "@/server/api/handler";
import { domainOverviewBody, domainOverviewForApi, restSeoContext } from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/seo/domain/overview — organic traffic + ranking keyword count (paid, cached 12h). */
export const POST = apiRoute<ProjectParams>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await domainOverviewForApi(ctx, await parseBody(req, domainOverviewBody)) };
});

export const OPTIONS = corsPreflight;
