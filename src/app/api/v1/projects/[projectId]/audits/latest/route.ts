import { getApiProject } from "@/server/api/auth";
import { apiRoute } from "@/server/api/handler";
import { ApiError } from "@/server/api/errors";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";
import { getLatestAuditSummary } from "@/server/audit-crawler/service";

/** GET /api/v1/projects/{projectId}/audits/latest — summary of the most recent audit (top issues). */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  const s = await getLatestAuditSummary(project.id);
  if (!s) throw new ApiError("not_found", "No site audit yet.");
  return { data: s };
});

export const OPTIONS = corsPreflight;
