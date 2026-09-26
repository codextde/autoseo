import { apiRoute, parseBody } from "@/server/api/handler";
import { domainTopPagesBody, domainTopPagesForApi, restSeoContext } from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/seo/domain/pages — top organic pages of a domain (paid, cached 12h). */
export const POST = apiRoute<ProjectParams>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await domainTopPagesForApi(ctx, await parseBody(req, domainTopPagesBody)) };
});

export const OPTIONS = corsPreflight;
