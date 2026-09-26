import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { apiSeoContext } from "@/server/api/module-context";
import { trackerResults, trackerResultsQuery, trackerView } from "@/server/api/seo-tracking";
import { corsPreflight } from "@/server/api/urls";
import { archiveRankConfig } from "@/server/seo";

type Params = { projectId: string; trackerId: string };

/** GET …/seo/rank-trackers/{trackerId} — positions per keyword (desktop/mobile) vs. the comparison period + latest run. */
export const GET = apiRoute<Params>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, trackerResultsQuery);
  return { data: await trackerResults(apiSeoContext(principal, project), params.trackerId, q.comparePeriod) };
});

/** DELETE …/seo/rank-trackers/{trackerId} — archive (scheduled checks stop, history kept). */
export const DELETE = apiRoute<Params>({ scope: "write", permission: "seo.run" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  const config = await archiveRankConfig(apiSeoContext(principal, project), params.trackerId);
  return { data: trackerView(config) };
});

export const OPTIONS = corsPreflight;
