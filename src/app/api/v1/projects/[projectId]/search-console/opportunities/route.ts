import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { searchOpportunities, searchOpportunitiesInput } from "@/server/api/analytics";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/search-console/opportunities — GSC × GA4 scored page opportunities. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const { rows, ...meta } = await searchOpportunities(project.id, parseQuery(url, searchOpportunitiesInput));
  return { data: rows, meta };
});

export const OPTIONS = corsPreflight;
