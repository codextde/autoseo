import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { auditCompare, compareAuditsQuery } from "@/server/api/audit";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/audits/compare?base=&target= — issue diff between two audits. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await auditCompare(project.id, parseQuery(url, compareAuditsQuery)) };
});

export const OPTIONS = corsPreflight;
