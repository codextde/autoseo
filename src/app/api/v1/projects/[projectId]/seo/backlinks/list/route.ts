import { apiRoute, parseBody } from "@/server/api/handler";
import { backlinksProfileBody, backlinksProfileForApi, restSeoContext } from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/seo/backlinks/list — paginated backlinks (paid, cached 6h). */
export const POST = apiRoute<ProjectParams>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await backlinksProfileForApi(ctx, await parseBody(req, backlinksProfileBody)) };
});

export const OPTIONS = corsPreflight;
