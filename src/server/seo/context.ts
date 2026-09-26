import "server-only";
import type { ProjectContext } from "@/server/auth/context";
import { projectMarket, type Market } from "./lib/locations";

/**
 * Plain, framework-free context every SEO service takes (reused by server actions, jobs and the MCP server).
 * Build it with `seoContextFromProject` (web) or by hand (jobs / MCP, after authorizing the project).
 */
export type SeoContext = {
  projectId: string;
  workspaceId: string;
  userId: string | null;
  project: { name: string; domain: string; country: string; language: string };
  /** Project market (DataForSEO location/language) derived from project country + language. */
  market: Market;
  /**
   * Whether the caller may trigger paid DataForSEO calls (`seo.run`). When false, services only serve cached
   * results and throw `SeoError("PERMISSION")` on a cache miss.
   */
  canRun: boolean;
};

export function seoContextFromProject(ctx: ProjectContext): SeoContext {
  const p = ctx.project;
  return {
    projectId: p.id,
    workspaceId: p.workspaceId,
    userId: ctx.user.id,
    project: { name: p.name, domain: p.domain, country: p.country, language: p.language },
    market: projectMarket(p),
    canRun: ctx.isInstanceAdmin || ctx.permissions.has("seo.run"),
  };
}

/** Context for background jobs (system actor, always allowed to run what was already approved). */
export function systemSeoContext(project: {
  id: string;
  workspaceId: string;
  name: string;
  domain: string;
  country: string;
  language: string;
}, userId: string | null = null): SeoContext {
  return {
    projectId: project.id,
    workspaceId: project.workspaceId,
    userId,
    project: { name: project.name, domain: project.domain, country: project.country, language: project.language },
    market: projectMarket(project),
    canRun: true,
  };
}

export type SeoErrorCode =
  | "NOT_CONFIGURED"
  | "PERMISSION"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUDGET"
  | "AUTH_FAILED"
  | "INSUFFICIENT_FUNDS"
  | "UPSTREAM";

export class SeoError extends Error {
  constructor(
    public code: SeoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SeoError";
  }
}

export function assertCanRun(ctx: SeoContext, what = "run paid SEO research") {
  if (!ctx.canRun) throw new SeoError("PERMISSION", `You don't have permission to ${what} (requires "seo.run").`);
}
