import "server-only";
import { getProjectContext, type ProjectContext } from "@/server/auth/context";
import { ActionError } from "@/server/auth/guards";

/** "One deck, every client": resolves ?client=<projectId> to a project the user can access. */
export async function resolveDataProject(projectId: string, client: string | string[] | undefined): Promise<string> {
  const id = Array.isArray(client) ? client[0] : client;
  if (!id || id === projectId || !/^[a-z]{3}_[a-z0-9]{6,40}$/i.test(id)) return projectId;
  const ctx = await getProjectContext(id);
  return ctx ? ctx.project.id : projectId;
}

/**
 * Workspace-wide report resources (agency brand kit, "My Templates", workspace-level assets) affect
 * every project, so project-restricted members may not change them: require `settings.manage` or
 * all-projects access on top of `reports.manage`.
 */
export function canManageWorkspaceReports(ctx: ProjectContext): boolean {
  return (
    ctx.permissions.has("reports.manage") &&
    (ctx.permissions.has("settings.manage") || ctx.permissions.has("projects.all") || ctx.membership.allProjects)
  );
}

export function assertWorkspaceReports(ctx: ProjectContext) {
  if (!canManageWorkspaceReports(ctx)) {
    throw new ActionError("Only workspace admins can change workspace-wide brand kits, templates and shared images.", "forbidden");
  }
}
