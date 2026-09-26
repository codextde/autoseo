import "server-only";
import { cache } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projectMembers, projects, roles, workspaceMembers, workspaces } from "@/server/db/schema";
import { getCurrentSession, type SessionUser } from "./session";
import type { Permission } from "./permissions";

export type Membership = {
  workspace: typeof workspaces.$inferSelect;
  roleKey: string;
  roleName: string;
  permissions: Set<Permission>;
  allProjects: boolean;
};

export type UserContext = {
  user: SessionUser;
  sessionId: string;
  memberships: Membership[];
  isInstanceAdmin: boolean;
};

export type ProjectContext = UserContext & {
  project: typeof projects.$inferSelect;
  membership: Membership;
  permissions: Set<Permission>;
};

export const loadRoles = cache(async () => {
  const rows = await db.select().from(roles);
  return new Map(rows.map((r) => [r.key, r]));
});

/** Full user context incl. workspace memberships and resolved role permissions. */
export const getUserContext = cache(async (): Promise<UserContext | null> => {
  const current = await getCurrentSession();
  if (!current) return null;
  const roleMap = await loadRoles();
  const rows = await db
    .select({ workspace: workspaces, roleKey: workspaceMembers.roleKey })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, current.user.id));

  const memberships: Membership[] = rows.map((r) => {
    const role = roleMap.get(r.roleKey);
    return {
      workspace: r.workspace,
      roleKey: r.roleKey,
      roleName: role?.name ?? r.roleKey,
      permissions: new Set((role?.permissions ?? []) as Permission[]),
      allProjects: role?.allProjects ?? false,
    };
  });

  const isInstanceAdmin =
    current.user.isInstanceAdmin || memberships.some((m) => m.permissions.has("admin.access"));

  return { user: current.user, sessionId: current.session.id, memberships, isInstanceAdmin };
});

/** Projects the user can access (across all workspaces). */
export const getAccessibleProjects = cache(async () => {
  const ctx = await getUserContext();
  if (!ctx) return [];
  const fullWorkspaceIds = ctx.memberships
    .filter((m) => m.allProjects || m.permissions.has("projects.all"))
    .map((m) => m.workspace.id);
  const partialWorkspaceIds = ctx.memberships
    .filter((m) => !(m.allProjects || m.permissions.has("projects.all")))
    .map((m) => m.workspace.id);

  const result: (typeof projects.$inferSelect)[] = [];
  if (fullWorkspaceIds.length) {
    result.push(
      ...(await db
        .select()
        .from(projects)
        .where(and(inArray(projects.workspaceId, fullWorkspaceIds), eq(projects.archived, false)))),
    );
  }
  if (partialWorkspaceIds.length) {
    const rows = await db
      .select({ project: projects })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(
        and(
          eq(projectMembers.userId, ctx.user.id),
          inArray(projects.workspaceId, partialWorkspaceIds),
          eq(projects.archived, false),
        ),
      );
    result.push(...rows.map((r) => r.project));
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
});

export function hasPermission(
  ctx: { permissions: Set<Permission> } | Membership,
  permission: Permission,
): boolean {
  return ctx.permissions.has(permission);
}

export const getProjectContext = cache(async (projectId: string): Promise<ProjectContext | null> => {
  const ctx = await getUserContext();
  if (!ctx) return null;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;
  const membership = ctx.memberships.find((m) => m.workspace.id === project.workspaceId);
  if (!membership) return null;
  if (!(membership.allProjects || membership.permissions.has("projects.all"))) {
    const [access] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, ctx.user.id)))
      .limit(1);
    if (!access) return null;
  }
  return { ...ctx, project, membership, permissions: membership.permissions };
});
