import { apiRoute, parseBody } from "@/server/api/handler";
import { referringDomainsBody, referringDomainsForApi, restSeoContext } from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/seo/backlinks/referring-domains — paginated referring domains (paid, cached 6h). */
export const POST = apiRoute<ProjectParams>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await referringDomainsForApi(ctx, await parseBody(req, referringDomainsBody)) };
});

export const OPTIONS = corsPreflight;
