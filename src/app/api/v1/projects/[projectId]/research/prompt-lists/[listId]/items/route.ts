import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { listResearchItems, researchItemsQuery } from "@/server/api/research";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/research/prompt-lists/{listId}/items — researched prompts of a list. */
export const GET = apiRoute<{ projectId: string; listId: string }>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, researchItemsQuery.omit({ listId: true }));
  const r = await listResearchItems(project, { ...q, listId: params.listId });
  return { data: r.items, meta: { list: r.list, pagination: r.pagination } };
});

export const OPTIONS = corsPreflight;
