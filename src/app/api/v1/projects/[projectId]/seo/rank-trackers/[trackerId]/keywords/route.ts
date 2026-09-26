import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody, parseQuery } from "@/server/api/handler";
import { apiSeoContext } from "@/server/api/module-context";
import { addKeywordsBody, addKeywordsWithApproval, removeKeywordsBody } from "@/server/api/seo-tracking";
import { corsPreflight } from "@/server/api/urls";
import { removeTrackingKeywords } from "@/server/seo";

type Params = { projectId: string; trackerId: string };

/** POST …/rank-trackers/{trackerId}/keywords — add keywords (scheduled trackers need maxEstimatedScheduledCheckCostUsd). */
export const POST = apiRoute<Params>({ scope: "write", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, addKeywordsBody);
  return { status: 201, data: await addKeywordsWithApproval(apiSeoContext(principal, project), params.trackerId, body) };
});

/** DELETE …/rank-trackers/{trackerId}/keywords — remove keywords (JSON body `{ keywordIds }` or `?keywordIds=a,b`). */
export const DELETE = apiRoute<Params>({ scope: "write", permission: "seo.run" }, async ({ principal, params, req, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = url.searchParams.has("keywordIds") ? parseQuery(url, removeKeywordsBody, ["keywordIds"]) : await parseBody(req, removeKeywordsBody);
  const res = await removeTrackingKeywords(apiSeoContext(principal, project), { configId: params.trackerId, keywordIds: body.keywordIds });
  return { data: { trackerId: params.trackerId, requested: body.keywordIds.length, ...res } };
});

export const OPTIONS = corsPreflight;
