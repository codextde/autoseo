import { accessibleProjects } from "@/server/api/auth";
import { apiRoute, parseBody, parseQuery } from "@/server/api/handler";
import { projectCounts, projectDto } from "@/server/api/ai-data";
import { createProjectBody, createProjectFromApi } from "@/server/api/projects";
import { paginate } from "@/server/api/rest";
import { projectsListQuery } from "@/server/api/schemas";
import { corsPreflight } from "@/server/api/urls";
import { env } from "@/server/env";

/** GET /api/v1/projects — projects accessible with this credential. */
export const GET = apiRoute({ scope: "read" }, async ({ principal, url }) => {
  const q = parseQuery(url, projectsListQuery);
  let list = await accessibleProjects(principal);
  if (q.search) {
    const s = q.search.toLowerCase();
    list = list.filter((p) => p.name.toLowerCase().includes(s) || p.domain.includes(s));
  }
  const page = paginate(list, q.page, q.limit);
  const counts = await projectCounts(page.items.map((p) => p.id));
  return {
    data: page.items.map((p) => ({ ...projectDto(p, env.appUrl), activePrompts: counts.get(p.id)?.prompts ?? 0, competitors: counts.get(p.id)?.competitors ?? 0 })),
    meta: { pagination: page.pagination },
  };
});

/** POST /api/v1/projects — create a project (write scope + projects.manage). */
export const POST = apiRoute({ scope: "write", permission: "projects.manage", spend: true }, async ({ principal, req }) => {
  const body = await parseBody(req, createProjectBody);
  const project = await createProjectFromApi(principal, body);
  return { status: 201, data: projectDto(project, env.appUrl) };
});

export const OPTIONS = corsPreflight;
