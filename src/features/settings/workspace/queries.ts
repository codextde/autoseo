import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projectMembers, projectShares, projects, roles, users, workspaceMembers } from "@/server/db/schema";
import { listInvitations, listWorkspaceMembers } from "@/server/admin/members";
import { getSetting } from "@/server/settings";

export type ShareRow = {
  id: string;
  projectId: string;
  projectName: string;
  projectDomain: string;
  projectLogoUrl: string | null;
  email: string;
  status: "active" | "pending" | "revoked";
  createdAt: string;
  invitedByEmail: string | null;
};

export type RoleInfo = {
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
  allProjects: boolean;
  builtin: boolean;
};

export async function loadRoles(): Promise<RoleInfo[]> {
  const rows = await db.select().from(roles).orderBy(asc(roles.sortOrder), asc(roles.name));
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    description: r.description,
    permissions: r.permissions,
    allProjects: r.allProjects,
    builtin: r.builtin,
  }));
}

async function loadShares(workspaceId: string): Promise<ShareRow[]> {
  const rows = await db
    .select({ share: projectShares, project: projects })
    .from(projectShares)
    .innerJoin(projects, eq(projects.id, projectShares.projectId))
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(desc(projectShares.createdAt));
  if (!rows.length) return [];
  const emails = [...new Set(rows.map((r) => r.share.email))];
  const inviterIds = [...new Set(rows.map((r) => r.share.invitedBy).filter((x): x is string => Boolean(x)))];
  const [shareUsers, inviters] = await Promise.all([
    db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, emails)),
    inviterIds.length ? db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, inviterIds)) : [],
  ]);
  const userByEmail = new Map(shareUsers.map((u) => [u.email, u.id]));
  const inviterById = new Map(inviters.map((u) => [u.id, u.email]));
  const userIds = [...userByEmail.values()];
  const [access, memberships] = await Promise.all([
    userIds.length
      ? db
          .select({ userId: projectMembers.userId, projectId: projectMembers.projectId })
          .from(projectMembers)
          .where(inArray(projectMembers.userId, userIds))
      : [],
    userIds.length
      ? db
          .select({ userId: workspaceMembers.userId, allProjects: roles.allProjects })
          .from(workspaceMembers)
          .leftJoin(roles, eq(roles.key, workspaceMembers.roleKey))
          .where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.userId, userIds)))
      : [],
  ]);
  const accessSet = new Set(access.map((a) => `${a.userId}:${a.projectId}`));
  const allProjectUsers = new Set(memberships.filter((m) => m.allProjects).map((m) => m.userId));
  const memberUsers = new Set(memberships.map((m) => m.userId));
  return rows.map(({ share, project }) => {
    const uid = userByEmail.get(share.email);
    const hasAccess = Boolean(uid && memberUsers.has(uid) && (allProjectUsers.has(uid) || accessSet.has(`${uid}:${project.id}`)));
    const status: ShareRow["status"] = share.status === "revoked" ? "revoked" : hasAccess ? "active" : "pending";
    return {
      id: share.id,
      projectId: project.id,
      projectName: project.name,
      projectDomain: project.domain,
      projectLogoUrl: project.logoUrl,
      email: share.email,
      status,
      createdAt: share.createdAt.toISOString(),
      invitedByEmail: share.invitedBy ? (inviterById.get(share.invitedBy) ?? null) : null,
    };
  });
}

/**
 * Workspace settings data. `reach` (project IDs the viewer can access, null = all) scopes every
 * project-related list; invitations and shares are only loaded for members who can manage them.
 */
export async function loadWorkspaceView(workspaceId: string, opts: { reach: Set<string> | null; canManage: boolean }) {
  const inReach = (projectId: string) => !opts.reach || opts.reach.has(projectId);
  const [members, invitations, roleList, wsProjects, shares, auth] = await Promise.all([
    listWorkspaceMembers(workspaceId),
    opts.canManage ? listInvitations({ workspaceId, status: ["pending", "expired"] }) : Promise.resolve([]),
    loadRoles(),
    db
      .select({ id: projects.id, name: projects.name, domain: projects.domain, logoUrl: projects.logoUrl })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.archived, false)))
      .orderBy(asc(projects.name)),
    opts.canManage ? loadShares(workspaceId) : Promise.resolve([] as ShareRow[]),
    getSetting("auth"),
  ]);
  return {
    members: members.map((m) => ({
      ...m,
      projectIds: m.projectIds.filter(inReach),
      lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
      joinedAt: m.joinedAt.toISOString(),
    })),
    invitations: invitations
      .filter((i) => i.projectIds.every(inReach))
      .map((i) => ({
        id: i.id,
        email: i.email,
        roleKey: i.roleKey,
        projectIds: i.projectIds,
        status: i.status,
        expiresAt: i.expiresAt.toISOString(),
        lastSentAt: i.lastSentAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
        invitedByEmail: i.invitedByEmail,
      })),
    roles: roleList,
    projects: wsProjects.filter((p) => inReach(p.id)),
    shares: shares.filter((sh) => inReach(sh.projectId)),
    allowedDomains: auth.allowedDomains,
  };
}

export type WorkspaceView = Awaited<ReturnType<typeof loadWorkspaceView>>;
