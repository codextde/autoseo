import { getApiProject } from "@/server/api/auth";
import { apiRoute } from "@/server/api/handler";
import { crawlabilityCheck } from "@/server/api/audit";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/crawlability/latest — the most recent crawlability check. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await crawlabilityCheck(project.id, undefined) };
});

export const OPTIONS = corsPreflight;
