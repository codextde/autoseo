import { getApiProject } from "@/server/api/auth";
import { apiRoute } from "@/server/api/handler";
import { factCheckOverview } from "@/server/api/optimize";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/fact-check — label alignment totals, assets and last run. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await factCheckOverview(project) };
});

export const OPTIONS = corsPreflight;
