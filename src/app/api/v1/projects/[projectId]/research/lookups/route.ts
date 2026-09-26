import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { listLookupHistory, lookupsQuery } from "@/server/api/research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/research/lookups — brand lookup / prompt explorer history. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, lookupsQuery);
  return { data: await listLookupHistory(project, q.kind, q.limit), meta: { kind: q.kind } };
});

export const OPTIONS = corsPreflight;
