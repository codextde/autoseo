import "server-only";
import { requireProject } from "@/server/auth/guards";
import { isDataForSeoConfigured, seoContextFromProject } from "@/server/seo";

/** Common loader for every SEO page: project guard, SeoContext, DataForSEO status and permissions. */
export async function loadSeoPage(projectId: string) {
  const pctx = await requireProject(projectId);
  const ctx = seoContextFromProject(pctx);
  const configured = await isDataForSeoConfigured();
  return {
    ctx,
    configured,
    isAdmin: pctx.isInstanceAdmin,
    canRun: ctx.canRun,
    market: ctx.market,
    project: { id: pctx.project.id, name: pctx.project.name, domain: pctx.project.domain, country: pctx.project.country, language: pctx.project.language },
  };
}

export type SeoPageInfo = Awaited<ReturnType<typeof loadSeoPage>>;

/** Serializable subset passed to client views. */
export function clientPageInfo(info: SeoPageInfo) {
  return { projectId: info.project.id, projectDomain: info.project.domain, market: info.market, configured: info.configured, canRun: info.canRun, isAdmin: info.isAdmin };
}
export type ClientPageInfo = ReturnType<typeof clientPageInfo>;
