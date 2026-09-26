import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { buildAiScope, periodInfo } from "@/server/api/ai-data";
import { answersToCsv, exportProjectData } from "@/server/api/export";
import { FILTER_ARRAY_KEYS, toAiFilter, type ProjectParams } from "@/server/api/rest";
import { exportQuery } from "@/server/api/schemas";
import { corsPreflight } from "@/server/api/urls";

/**
 * GET /api/v1/projects/{projectId}/export — bulk export (export scope): every prompt with metrics
 * (first page) and one row per AI answer in the period. `format=csv` returns the answers as CSV.
 */
export const GET = apiRoute<ProjectParams>({ scope: "export" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, exportQuery, FILTER_ARRAY_KEYS);
  const scope = await buildAiScope(project, toAiFilter(q));
  const includeText = q.includeText === "true";
  const res = await exportProjectData(scope, { page: q.page, limit: q.limit, includeText });
  if (q.format === "csv") {
    const filename = `${project.domain.replace(/[^a-z0-9.-]/gi, "_")}-answers-${scope.period.from}-${scope.period.to}-p${q.page}.csv`;
    return new Response(answersToCsv(res.answers, includeText), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Total-Count": String(res.pagination.total),
        "X-Total-Pages": String(res.pagination.totalPages),
      },
    });
  }
  return {
    data: { project: { id: project.id, name: project.name, domain: project.domain }, prompts: res.prompts ?? null, answers: res.answers },
    meta: { period: periodInfo(scope), pagination: res.pagination },
  };
});

export const OPTIONS = corsPreflight;
