import "server-only";
import type { SeoContext } from "@/server/seo/context";
import { projectMarket } from "@/server/seo/lib/locations";
import type { ApiPrincipal, ApiProject } from "./auth";

/**
 * SEO service context for an API / MCP caller. Paid DataForSEO calls require the `seo.run` role
 * permission AND the credential's "spend" scope; without them services only answer from cache (and
 * raise PERMISSION on a miss).
 */
export function apiSeoContext(p: ApiPrincipal, project: ApiProject): SeoContext {
  return {
    projectId: project.id,
    workspaceId: project.workspaceId,
    userId: p.user.id,
    project: { name: project.name, domain: project.domain, country: project.country, language: project.language },
    market: projectMarket(project),
    canRun: p.permissions.has("seo.run") && p.scopes.has("spend"),
  };
}

/** Actor passed to audit / crawlability / research services. */
export function apiActor(p: ApiPrincipal, project: ApiProject) {
  return { projectId: project.id, workspaceId: project.workspaceId, userId: p.user.id };
}
