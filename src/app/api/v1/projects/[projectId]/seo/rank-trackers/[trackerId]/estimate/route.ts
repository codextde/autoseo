import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { apiSeoContext } from "@/server/api/module-context";
import { estimateQuery } from "@/server/api/seo-tracking";
import { corsPreflight } from "@/server/api/urls";
import { estimateRankTrackerCost } from "@/server/seo";

/** GET …/rank-trackers/{trackerId}/estimate — live + scheduled check cost (USD). */
export const GET = apiRoute<{ projectId: string; trackerId: string }>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, estimateQuery);
  return { data: { trackerId: params.trackerId, ...(await estimateRankTrackerCost(apiSeoContext(principal, project), params.trackerId, q.additionalKeywordCount)) } };
});

export const OPTIONS = corsPreflight;
