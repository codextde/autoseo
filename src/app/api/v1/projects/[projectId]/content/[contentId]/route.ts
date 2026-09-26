import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { contentDetailQuery, getContentForApi } from "@/server/api/optimize";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/content/{contentId} — body, meta, FAQs, JSON-LD, score. */
export const GET = apiRoute<{ projectId: string; contentId: string }>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, contentDetailQuery);
  return { data: await getContentForApi(project, params.contentId, { maxBodyChars: q.maxBodyChars ?? 400_000 }) };
});

export const OPTIONS = corsPreflight;
