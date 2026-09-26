import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { FINDINGS_ARRAY_KEYS, findingsQuery, listFindings } from "@/server/api/optimize";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/fact-check/findings — deviating AI statements. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, findingsQuery, FINDINGS_ARRAY_KEYS);
  const r = await listFindings(project, q);
  return { data: r.items, meta: { kpis: r.kpis, offLabelCount: r.offLabelCount, options: r.options, pagination: r.pagination } };
});

export const OPTIONS = corsPreflight;
