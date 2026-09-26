import { apiRoute, parseQuery } from "@/server/api/handler";
import { getApiProject } from "@/server/api/auth";
import { serpLocationsForApi, serpLocationsQuery } from "@/server/api/seo-research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/seo/locations?query=&countryCode= — DataForSEO sub-country locations (free). */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: (await serpLocationsForApi({ projectId: project.id }, parseQuery(url, serpLocationsQuery))).locations };
});

export const OPTIONS = corsPreflight;
