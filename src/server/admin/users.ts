import "server-only";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  auditLogs,
  invitations,
  projectMembers,
  projects,
  roles,
  sessions,
  users,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema";
import { logAudit } from "@/server/audit";
import { assertAdminsRemain, listActiveSessions, MemberError } from "./members";

type Actor = { id: string; email: string };

export type AdminUserRow = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  status: "active" | "disabled";
  isInstanceAdmin: boolean;
  /** admin access via flag or a role with admin.access */
  hasAdminAccess: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  activeSessions: number;
  memberships: { workspaceId: string; workspaceName: string; roleKey: string; roleName: string }[];
};

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const rows = await db.select().from(users).orderBy(asc(users.email)).limit(5000);
  const mems = await db
    .select({
      userId: workspaceMembers.userId,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      roleKey: workspaceMembers.roleKey,
      roleName: roles.name,
      rolePerms: roles.permissions,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .leftJoin(roles, eq(roles.key, workspaceMembers.roleKey));
  const sess = await db
    .select({ userId: sessions.userId, n: sql<number>`count(*)::int` })
    .from(sessions)
    .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .groupBy(sessions.userId);
  const sessByUser = new Map(sess.map((s) => [s.userId, Number(s.n)]));
  const memByUser = new Map<string, typeof mems>();
  for (const m of mems) memByUser.set(m.userId, [...(memByUser.get(m.userId) ?? []), m]);
  return rows.map((u) => {
    const ms = memByUser.get(u.id) ?? [];
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatarUrl,
      status: u.status,
      isInstanceAdmin: u.isInstanceAdmin,
      hasAdminAccess: u.isInstanceAdmin || ms.some((m) => (m.rolePerms ?? []).includes("admin.access")),
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      activeSessions: sessByUser.get(u.id) ?? 0,
      memberships: ms.map((m) => ({
        workspaceId: m.workspaceId,
        workspaceName: m.workspaceName,
        roleKey: m.roleKey,
        roleName: m.roleName ?? m.roleKey,
      })),
    };
  });
}

export async function getAdminUserDetail(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new MemberError("User not found.");
  const allWorkspaces = await db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).orderBy(asc(workspaces.name));
  const mems = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, userId));
  const allProjects = await db
    .select({ id: projects.id, name: projects.name, domain: projects.domain, workspaceId: projects.workspaceId, archived: projects.archived })
    .from(projects)
    .orderBy(asc(projects.name));
  const access = await db.select({ projectId: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, userId));
  const accessSet = new Set(access.map((a) => a.projectId));
  const activeSessions = await listActiveSessions(userId);
  const recent = await db
    .select({ id: auditLogs.id, action: auditLogs.action, targetType: auditLogs.targetType, ip: auditLogs.ip, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(eq(auditLogs.actorId, userId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(12);
  const pendingInvites = await db
    .select({ id: invitations.id, workspaceId: invitations.workspaceId, roleKey: invitations.roleKey, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(and(eq(invitations.email, user.email), eq(invitations.status, "pending"), gt(invitations.expiresAt, new Date())));

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      status: user.status,
      isInstanceAdmin: user.isInstanceAdmin,
      locale: user.locale,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    },
    workspaces: allWorkspaces.map((ws) => {
      const m = mems.find((x) => x.workspaceId === ws.id);
      const wsProjects = allProjects.filter((p) => p.workspaceId === ws.id);
      return {
        id: ws.id,
        name: ws.name,
        roleKey: m?.roleKey ?? null,
        projects: wsProjects.map((p) => ({ id: p.id, name: p.name, domain: p.domain, archived: p.archived, hasAccess: accessSet.has(p.id) })),
      };
    }),
    sessions: activeSessions,
    recent,
    pendingInvites,
  };
}

export async function updateAdminUser(
  userId: string,
  patch: { name?: string | null; status?: "active" | "disabled"; isInstanceAdmin?: boolean },
  actor: Actor,
) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new MemberError("User not found.");
  if (userId === actor.id && patch.status === "disabled") throw new MemberError("You can't disable your own account.");
  const set: Partial<typeof users.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name?.trim() || null;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.isInstanceAdmin !== undefined) set.isInstanceAdmin = patch.isInstanceAdmin;
  if (!Object.keys(set).length) return;
  await db.transaction(async (tx) => {
    await tx.update(users).set(set).where(eq(users.id, userId));
    await assertAdminsRemain(tx);
    if (patch.status === "disabled") {
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    }
  });
  const events: string[] = [];
  if (patch.status && patch.status !== user.status) events.push(patch.status === "disabled" ? "user.disabled" : "user.enabled");
  if (patch.isInstanceAdmin !== undefined && patch.isInstanceAdmin !== user.isInstanceAdmin)
    events.push(patch.isInstanceAdmin ? "user.admin_granted" : "user.admin_revoked");
  if (patch.name !== undefined && (set.name ?? null) !== user.name) events.push("user.updated");
  for (const e of events) void logAudit(e, { actor, targetType: "user", targetId: userId, meta: { email: user.email } });
}

export async function revokeUserSession(userId: string, sessionId: string, actor: Actor) {
  const res = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (!res.length) throw new MemberError("Session not found or already signed out.");
  void logAudit("session.revoked", { actor, targetType: "user", targetId: userId, meta: { sessionId } });
}

export async function revokeAllUserSessions(userId: string, actor: Actor, exceptSessionId?: string) {
  const res = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        exceptSessionId ? sql`${sessions.id} <> ${exceptSessionId}` : sql`true`,
      ),
    )
    .returning({ id: sessions.id });
  void logAudit("user.sessions_revoked", { actor, targetType: "user", targetId: userId, meta: { count: res.length } });
  return res.length;
}
