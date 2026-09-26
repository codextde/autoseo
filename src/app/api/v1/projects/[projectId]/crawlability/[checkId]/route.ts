import { getApiProject } from "@/server/api/auth";
import { apiRoute } from "@/server/api/handler";
import { crawlabilityCheck } from "@/server/api/audit";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/crawlability/{checkId} — scores, findings, per-bot access, llms.txt, sitemap. */
export const GET = apiRoute<{ projectId: string; checkId: string }>({ scope: "read" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await crawlabilityCheck(project.id, params.checkId) };
});

export const OPTIONS = corsPreflight;
