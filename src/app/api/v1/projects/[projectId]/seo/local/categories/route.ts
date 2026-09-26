import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { apiSeoContext } from "@/server/api/module-context";
import { categoriesQuery } from "@/server/api/seo-tracking";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";
import { listBusinessCategories } from "@/server/seo";

/** GET …/seo/local/categories — Google Business category slugs with business counts (free, cached). */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, categoriesQuery);
  const res = await listBusinessCategories(apiSeoContext(principal, project), { query: q.query, limit: q.limit });
  return { data: res.categories, meta: { total: res.total } };
});

export const OPTIONS = corsPreflight;
