import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { buildAiScope, getVisibilityMetrics } from "@/server/api/ai-data";
import { FILTER_ARRAY_KEYS, toAiFilter, type ProjectParams } from "@/server/api/rest";
import { filterOnlyQuery } from "@/server/api/schemas";
import { corsPreflight } from "@/server/api/urls";

/**
 * GET /api/v1/projects/{projectId}/metrics — PeriodMetrics for today and yesterday plus the
 * selected timeframe (default 30d) vs the previous period of equal length, with changes.
 */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, filterOnlyQuery, FILTER_ARRAY_KEYS);
  const filter = toAiFilter(q);
  const [range, day] = await Promise.all([
    buildAiScope(project, filter).then(getVisibilityMetrics),
    buildAiScope(project, { model: filter.model, tags: filter.tags, timeframeDays: 1 }).then(getVisibilityMetrics),
  ]);
  return {
    data: {
      today: day.current,
      yesterday: day.previous,
      dailyChanges: day.changes,
      current: range.current,
      previous: range.previous,
      changes: range.changes,
      definitions: range.definitions,
    },
    meta: { period: range.period },
  };
});

export const OPTIONS = corsPreflight;
