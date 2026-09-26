import { apiRoute, parseBody } from "@/server/api/handler";
import { serpCompetitorsBody, serpCompetitorsForApi, restSeoContext } from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/seo/domain/competitors — SERP competitor domains for a keyword set (paid, not cached). */
export const POST = apiRoute<ProjectParams>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const ctx = await restSeoContext(principal, params.projectId);
  return { data: await serpCompetitorsForApi(ctx, await parseBody(req, serpCompetitorsBody)) };
});

export const OPTIONS = corsPreflight;
