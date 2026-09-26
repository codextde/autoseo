import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { apiSeoContext } from "@/server/api/module-context";
import { localRunQuery, waitForLocalRun } from "@/server/api/seo-tracking";
import { corsPreflight } from "@/server/api/urls";
import { deleteLocalRun, getLocalRun } from "@/server/seo";

type Params = { projectId: string; runId: string };

/** GET …/seo/local/runs/{runId} — status + result (free; `waitSeconds` long-polls pending runs). */
export const GET = apiRoute<Params>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, localRunQuery);
  const run = await waitForLocalRun(apiSeoContext(principal, project), params.runId, q.waitSeconds * 1000);
  return { status: run.status === "completed" || run.status === "failed" ? 200 : 202, data: run };
});

/** DELETE …/seo/local/runs/{runId} */
export const DELETE = apiRoute<Params>({ scope: "write", permission: "seo.run" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  const ctx = apiSeoContext(principal, project);
  await getLocalRun(ctx, params.runId);
  await deleteLocalRun(ctx, params.runId);
  return { data: { runId: params.runId, deleted: true } };
});

export const OPTIONS = corsPreflight;
