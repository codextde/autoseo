import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody } from "@/server/api/handler";
import { brandLookupInput, startBrandLookup } from "@/server/api/research";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";

/** POST /api/v1/projects/{projectId}/research/brand-lookup — start a paid brand lookup (seo.run). */
export const POST = apiRoute<ProjectParams>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, brandLookupInput);
  return { status: 202, data: await startBrandLookup(principal, project, body) };
});

export const OPTIONS = corsPreflight;
