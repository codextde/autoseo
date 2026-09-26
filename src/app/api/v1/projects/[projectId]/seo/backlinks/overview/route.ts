import { apiRoute, parseBody } from "@/server/api/handler";
import { backlinksOverviewBody, backlinksOverviewForApi, restSeoContext } from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/seo/backlinks/overview — backlink summary, trends and top referring domains (paid, cached 6h). */
export const POST = apiRoute<ProjectParams>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await backlinksOverviewForApi(ctx, await parseBody(req, backlinksOverviewBody)) };
});

export const OPTIONS = corsPreflight;
