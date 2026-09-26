import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projectMembers, projects, workspaces } from "@/server/db/schema";
import { actionUser, ActionError } from "@/server/auth/guards";
import type { Membership, UserContext } from "@/server/auth/context";
import type { Permission } from "@/server/auth/permissions";

export type WorkspaceAccess = {
  ctx: UserContext;
  workspace: typeof workspaces.$inferSelect;
  /** null when the user is an instance admin without membership in this workspace */
  membership: Membership | null;
  can: (p: Permission) => boolean;
};

/** Resolves the user's access to a workspace (instance admins can manage every workspace). */
export async function workspaceAccess(ctx: UserContext, workspaceId: string): Promise<WorkspaceAccess | null> {
  const membership = ctx.memberships.find((m) => m.workspace.id === workspaceId) ?? null;
  let workspace = membership?.workspace ?? null;
  if (!workspace && ctx.isInstanceAdmin) {
    [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  }
  if (!workspace) return null;
  return {
    ctx,
    workspace,
    membership,
    can: (p) => ctx.isInstanceAdmin || Boolean(membership?.permissions.has(p)),
  };
}

/** Server-action guard: requires `permission` in the given workspace (or instance admin). */
export async function actionWorkspace(workspaceId: string, permission?: Permission): Promise<WorkspaceAccess> {
  const ctx = await actionUser();
  const access = await workspaceAccess(ctx, workspaceId);
  if (!access) throw new ActionError("Workspace not found.", "not_found");
  if (permission && !access.can(permission)) throw new ActionError("You don't have permission to do this.", "forbidden");
  return access;
}

/**
 * Server-action guard for project management (rename, archive, delete…): requires `permission`
 * in the project's workspace. Works for archived projects too (unlike `actionProject`).
 */
export async function actionManageProject(projectId: string, permission: Permission = "projects.manage") {
  const ctx = await actionUser();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new ActionError("Project not found.", "not_found");
  const access = await workspaceAccess(ctx, project.workspaceId);
  if (!access) throw new ActionError("Project not found.", "not_found");
  if (!access.can(permission)) throw new ActionError("You don't have permission to do this.", "forbidden");
  const m = access.membership;
  if (!ctx.isInstanceAdmin && m && !(m.allProjects || m.permissions.has("projects.all"))) {
    const [row] = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, ctx.user.id)))
      .limit(1);
    if (!row) throw new ActionError("Project not found.", "not_found");
  }
  return { ...access, project };
}

/** True when the member sees every project of the workspace (role flag or `projects.all`). */
export function hasAllProjects(access: WorkspaceAccess) {
  if (access.ctx.isInstanceAdmin) return true;
  const m = access.membership;
  return Boolean(m && (m.allProjects || m.permissions.has("projects.all")));
}

/**
 * Project IDs of the workspace the caller can access, or `null` when they can access all of them.
 * Used to scope lists and to stop project-restricted managers from widening access.
 */
export async function reachableProjectIds(access: WorkspaceAccess): Promise<Set<string> | null> {
  if (hasAllProjects(access)) return null;
  const rows = await db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.userId, access.ctx.user.id), eq(projects.workspaceId, access.workspace.id)));
  return new Set(rows.map((r) => r.id));
}

/**
 * Prevents privilege escalation: non-instance-admins may only grant (or manage members holding)
 * roles whose permissions — including "all projects" — are a subset of their own.
 */
export function assertRoleWithinReach(
  access: WorkspaceAccess,
  role: { permissions: string[]; name: string; allProjects?: boolean },
) {
  if (access.ctx.isInstanceAdmin) return;
  const own = access.membership?.permissions ?? new Set<Permission>();
  const missing = role.permissions.filter((p) => !own.has(p as Permission));
  const widensProjects = (role.allProjects || role.permissions.includes("projects.all")) && !hasAllProjects(access);
  if (missing.length || widensProjects) {
    throw new ActionError(`You can't manage members with the “${role.name}” role — it has permissions you don't have.`, "forbidden");
  }
}

/** Throws when a project-restricted caller tries to grant projects they can't access themselves. */
export async function assertProjectsWithinReach(access: WorkspaceAccess, projectIds: string[]) {
  const reach = await reachableProjectIds(access);
  if (!reach) return;
  if (projectIds.some((id) => !reach.has(id))) {
    throw new ActionError("You can only grant access to projects you can access yourself.", "forbidden");
  }
}
