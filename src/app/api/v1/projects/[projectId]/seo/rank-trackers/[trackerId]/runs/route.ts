import { getApiProject } from "@/server/api/auth";
import { ApiError } from "@/server/api/errors";
import { apiRoute, parseBody } from "@/server/api/handler";
import { apiSeoContext } from "@/server/api/module-context";
import { requireDataForSeo, runCheckBody } from "@/server/api/seo-tracking";
import { corsPreflight } from "@/server/api/urls";
import { getLatestRankRun, triggerRankCheck } from "@/server/seo";

type Params = { projectId: string; trackerId: string };

/** GET …/rank-trackers/{trackerId}/runs — latest run (status, progress, cost). */
export const GET = apiRoute<Params>({ scope: "read" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await getLatestRankRun(apiSeoContext(principal, project), params.trackerId) };
});

/** POST …/rank-trackers/{trackerId}/runs — start a paid live rank check (maxCostUsd approval). */
export const POST = apiRoute<Params>({ scope: "write", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, runCheckBody);
  await requireDataForSeo();
  const r = await triggerRankCheck(apiSeoContext(principal, project), { configId: params.trackerId, keywordIds: body.keywordIds, maxCostUsd: body.maxCostUsd });
  if (!r.ok) throw new ApiError("conflict", "A rank check is already running for this tracker (no charge).", { blockingRunId: r.blockingRunId });
  return { status: 202, data: { started: true, runId: r.runId } };
});

export const OPTIONS = corsPreflight;
