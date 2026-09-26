"use server";

import { ActionError, actionProject, runAction, type ActionResult } from "@/server/auth/guards";
import { runToolInApp } from "@/server/free-tools/app";
import { seoContextFromProject } from "@/server/seo";
import { isFreeToolSlug } from "./lib/registry";

const CODE_MAP: Record<string, ActionError["code"]> = { invalid: "invalid", forbidden: "forbidden", not_found: "not_found" };

/**
 * Runs a free tool for a signed-in project member. DataForSEO-backed tools require `seo.run` (or instance admin) and
 * are charged to the project's workspace; the RDAP domain-age tool only needs project access.
 */
export async function runFreeToolAction(projectId: string, tool: string, input: Record<string, unknown>): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    if (typeof tool !== "string" || !isFreeToolSlug(tool)) throw new ActionError("Unknown tool.", "not_found");
    const pctx = await actionProject(projectId);
    const seo = seoContextFromProject(pctx);
    const res = await runToolInApp(
      { projectId: seo.projectId, workspaceId: seo.workspaceId, userId: seo.userId, canRun: seo.canRun },
      tool,
      input && typeof input === "object" ? input : {},
    );
    if (!res.ok) throw new ActionError(res.error, CODE_MAP[res.code ?? ""] ?? "error");
    return res.data;
  });
}
