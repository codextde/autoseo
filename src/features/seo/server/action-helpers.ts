import "server-only";
import { ActionError, actionProject, runAction, type ActionResult } from "@/server/auth/guards";
import type { Permission } from "@/server/auth/permissions";
import { seoContextFromProject, SeoError, toSeoError, type SeoContext } from "@/server/seo";

const CODE_MAP: Record<string, ActionError["code"]> = {
  PERMISSION: "forbidden",
  VALIDATION_ERROR: "invalid",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
};

/**
 * Wraps an SEO server action: authorizes project access (+ optional permission), builds the plain SeoContext and
 * converts SeoErrors into serializable ActionErrors.
 *
 * Permission model: viewing = project access; paid research / checks and every SEO config change (rank trackers,
 * saved-keyword tags, local runs) = `seo.run` (enforced here and again inside the services via `ctx.canRun`).
 */
export async function seoAction<T>(projectId: string, permission: Permission | undefined, fn: (ctx: SeoContext) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(async () => {
    const pctx = await actionProject(projectId, permission);
    try {
      return await fn(seoContextFromProject(pctx));
    } catch (err) {
      const e = toSeoError(err);
      if (e instanceof SeoError) throw new ActionError(e.message, CODE_MAP[e.code] ?? "error");
      throw e;
    }
  });
}
