import { apiRoute, parseBody } from "@/server/api/handler";
import { backlinksTopPagesBody, backlinksTopPagesForApi, restSeoContext } from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/seo/backlinks/top-pages — most linked pages (paid, cached 6h). */
export const POST = apiRoute<ProjectParams>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await backlinksTopPagesForApi(ctx, await parseBody(req, backlinksTopPagesBody)) };
});

export const OPTIONS = corsPreflight;
