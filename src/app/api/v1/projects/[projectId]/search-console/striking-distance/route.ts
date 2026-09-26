import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { strikingDistance, strikingDistanceInput } from "@/server/api/analytics";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/search-console/striking-distance — queries ranking 5–20. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const { rows, ...meta } = await strikingDistance(project.id, parseQuery(url, strikingDistanceInput));
  return { data: rows, meta };
});

export const OPTIONS = corsPreflight;
