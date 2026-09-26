import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { apiSeoContext } from "@/server/api/module-context";
import { createTrackerBody, listTrackers, trackerView } from "@/server/api/seo-tracking";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";
import { createRankConfig } from "@/server/seo";

/** GET /api/v1/projects/{projectId}/seo/rank-trackers — active rank trackers with keyword counts. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await listTrackers(apiSeoContext(principal, project)) };
});

/** POST /api/v1/projects/{projectId}/seo/rank-trackers — create a tracker (free; no check runs). */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, createTrackerBody);
  const config = await createRankConfig(apiSeoContext(principal, project), {
    ...body,
    domain: body.domain ?? project.domain,
    locationName: body.locationName ?? null,
  });
  return { status: 201, data: trackerView(config) };
});

export const OPTIONS = corsPreflight;
