import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { apiSeoContext } from "@/server/api/module-context";
import { localRunsQuery } from "@/server/api/seo-tracking";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";
import { listLocalRuns } from "@/server/seo";

/** GET …/seo/local/runs — recent local SEO runs (newest first, without results). */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, localRunsQuery);
  const runs = await listLocalRuns(apiSeoContext(principal, project), { tool: q.tool, limit: q.limit });
  return {
    data: runs.map((r) => ({ runId: r.id, tool: r.tool, label: r.label, status: r.status, error: r.error, costUsd: r.costUsd, createdAt: r.createdAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null })),
  };
});

export const OPTIONS = corsPreflight;
