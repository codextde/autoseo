import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { getLookupResult, lookupResultQuery } from "@/server/api/research";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/research/lookups/{lookupId} — status + result of a lookup. */
export const GET = apiRoute<{ projectId: string; lookupId: string }>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, lookupResultQuery);
  return { data: await getLookupResult(project, params.lookupId, { maxAnswerChars: q.maxAnswerChars ?? 200_000 }) };
});

export const OPTIONS = corsPreflight;
