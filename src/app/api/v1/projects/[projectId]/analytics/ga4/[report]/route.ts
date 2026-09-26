import { getApiProject } from "@/server/api/auth";
import { apiRoute } from "@/server/api/handler";
import { ApiError } from "@/server/api/errors";
import { GA4_REPORT_DEFS, GA4_REPORT_KEYS, runGa4, type Ga4ReportKey } from "@/server/api/analytics";
import { corsPreflight } from "@/server/api/urls";

/** Query string → object ("true"/"false" become booleans; numbers are coerced by the schemas). */
function queryObject(url: URL): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of url.searchParams) out[k] = v === "true" ? true : v === "false" ? false : v;
  return out;
}

/**
 * GET /api/v1/projects/{projectId}/analytics/ga4/{report} — the 10 open-seo GA4 reports (minus the
 * GSC × GA4 join, served at …/search-console/opportunities). Requires Google Analytics connected.
 */
export const GET = apiRoute<{ projectId: string; report: string }>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  if (!GA4_REPORT_KEYS.includes(params.report as Ga4ReportKey)) {
    throw new ApiError("not_found", `Unknown GA4 report "${params.report}". Available: ${GA4_REPORT_KEYS.join(", ")}.`);
  }
  const def = GA4_REPORT_DEFS[params.report as Ga4ReportKey];
  const input = def.input.parse(queryObject(url)) as Record<string, unknown>;
  const run = def.run as (projectId: string, i: Record<string, unknown>) => Promise<unknown>;
  const r = (await runGa4(project.id, () => run(project.id, input))) as { rows?: unknown[] } & Record<string, unknown>;
  if (Array.isArray(r.rows)) {
    const { rows, ...meta } = r;
    return { data: rows, meta: { report: params.report, ...meta } };
  }
  return { data: r, meta: { report: params.report } };
});

export const OPTIONS = corsPreflight;
