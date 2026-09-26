import "server-only";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  invitations,
  projectMembers,
  projects,
  roles,
  sessions,
  users,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema";
import { randomToken, sha256 } from "@/server/crypto";
import { getSetting } from "@/server/settings";
import { appUrl, sendMail } from "@/server/email";
import { invitationEmail } from "@/server/email/templates";
import { logAudit } from "@/server/audit";
import { rateLimit } from "@/server/rate-limit";

type Actor = { id: string; email: string; name?: string | null };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export class MemberError extends Error {}

/** Number of active users that can access the admin panel (flag or a role with admin.access). */
export async function countInstanceAdmins(exec: Executor = db): Promise<number> {
  const rows = (await exec.execute(sql`
    SELECT count(DISTINCT u.id)::int AS n FROM users u
    WHERE u.status = 'active' AND (
      u.is_instance_admin
      OR EXISTS (
        SELECT 1 FROM workspace_members wm JOIN roles r ON r.key = wm.role_key
        WHERE wm.user_id = u.id AND r.permissions @> '["admin.access"]'::jsonb
      )
    )`)) as unknown as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

export async function assertAdminsRemain(exec: Executor = db) {
  if ((await countInstanceAdmins(exec)) < 1) {
    throw new MemberError("This change would leave the instance without any administrator.");
  }
}

async function assertOwnerRemains(exec: Executor, workspaceId: string) {
  const [row] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.roleKey, "owner"), eq(users.status, "active")));
  if (Number(row?.n ?? 0) < 1) throw new MemberError("Every workspace needs at least one active owner.");
}

export async function roleExists(roleKey: string) {
  const [r] = await db.select({ key: roles.key }).from(roles).where(eq(roles.key, roleKey)).limit(1);
  return Boolean(r);
}

/** Adds a user to a workspace or changes their role there. */
export async function setMemberRole(workspaceId: string, userId: string, roleKey: string, actor: Actor) {
  if (!(await roleExists(roleKey))) throw new MemberError("Unknown role.");
  await db.transaction(async (tx) => {
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId, userId, roleKey })
      .onConflictDoUpdate({ target: [workspaceMembers.workspaceId, workspaceMembers.userId], set: { roleKey } });
    await assertOwnerRemains(tx, workspaceId);
    await assertAdminsRemain(tx);
  });
  void logAudit("member.role_changed", { actor, targetType: "user", targetId: userId, workspaceId, meta: { roleKey } });
}

/** Removes a user from a workspace (and their explicit project access there). */
export async function removeMember(workspaceId: string, userId: string, actor: Actor) {
  await db.transaction(async (tx) => {
    await tx
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    const wsProjects = tx.select({ id: projects.id }).from(projects).where(eq(projects.workspaceId, workspaceId));
    await tx
      .delete(projectMembers)
      .where(and(eq(projectMembers.userId, userId), inArray(projectMembers.projectId, wsProjects)));
    await assertOwnerRemains(tx, workspaceId);
    await assertAdminsRemain(tx);
  });
  void logAudit("member.removed", { actor, targetType: "user", targetId: userId, workspaceId });
}

/** Replaces a user's explicit project access within one workspace. */
export async function setProjectAccess(workspaceId: string, userId: string, projectIds: string[], actor: Actor) {
  const valid = projectIds.length
    ? await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.workspaceId, workspaceId), inArray(projects.id, projectIds)))
    : [];
  const validIds = valid.map((p) => p.id);
  await db.transaction(async (tx) => {
    const wsProjects = tx.select({ id: projects.id }).from(projects).where(eq(projects.workspaceId, workspaceId));
    await tx
      .delete(projectMembers)
      .where(and(eq(projectMembers.userId, userId), inArray(projectMembers.projectId, wsProjects)));
    for (const id of validIds) {
      await tx.insert(projectMembers).values({ projectId: id, userId }).onConflictDoNothing();
    }
  });
  void logAudit("member.project_access_changed", {
    actor,
    targetType: "user",
    targetId: userId,
    workspaceId,
    meta: { projectIds: validIds },
  });
  return validIds;
}

export type MemberRow = {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  status: "active" | "disabled";
  roleKey: string;
  roleName: string;
  allProjects: boolean;
  projectIds: string[];
  lastLoginAt: Date | null;
  joinedAt: Date;
};

export async function listWorkspaceMembers(workspaceId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({ member: workspaceMembers, user: users, role: roles })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .leftJoin(roles, eq(roles.key, workspaceMembers.roleKey))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(users.email));
  const access = rows.length
    ? await db
        .select({ userId: projectMembers.userId, projectId: projectMembers.projectId })
        .from(projectMembers)
        .innerJoin(projects, eq(projects.id, projectMembers.projectId))
        .where(and(eq(projects.workspaceId, workspaceId), inArray(projectMembers.userId, rows.map((r) => r.user.id))))
    : [];
  const byUser = new Map<string, string[]>();
  for (const a of access) byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), a.projectId]);
  return rows.map((r) => ({
    userId: r.user.id,
    email: r.user.email,
    name: r.user.name,
    avatarUrl: r.user.avatarUrl,
    status: r.user.status,
    roleKey: r.member.roleKey,
    roleName: r.role?.name ?? r.member.roleKey,
    allProjects: Boolean(r.role?.allProjects || (r.role?.permissions ?? []).includes("projects.all")),
    projectIds: byUser.get(r.user.id) ?? [],
    lastLoginAt: r.user.lastLoginAt,
    joinedAt: r.member.createdAt,
  }));
}

export type InvitationRow = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  roleKey: string;
  projectIds: string[];
  makeInstanceAdmin: boolean;
  message: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: Date;
  lastSentAt: Date | null;
  acceptedAt: Date | null;
  createdAt: Date;
  invitedByEmail: string | null;
};

export async function listInvitations(opts: { workspaceId?: string; status?: string[] } = {}): Promise<InvitationRow[]> {
  const conds = [];
  if (opts.workspaceId) conds.push(eq(invitations.workspaceId, opts.workspaceId));
  const rows = await db
    .select({ inv: invitations, ws: workspaces, inviter: users.email })
    .from(invitations)
    .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
    .leftJoin(users, eq(users.id, invitations.invitedBy))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(invitations.createdAt))
    .limit(1000);
  const now = Date.now();
  return rows
    .map((r) => ({
      id: r.inv.id,
      workspaceId: r.inv.workspaceId,
      workspaceName: r.ws.name,
      email: r.inv.email,
      roleKey: r.inv.roleKey,
      projectIds: r.inv.projectIds,
      makeInstanceAdmin: r.inv.makeInstanceAdmin,
      message: r.inv.message,
      // Pending invitations past their expiry are shown as expired even before the cleanup job ran.
      status: (r.inv.status === "pending" && r.inv.expiresAt.getTime() < now ? "expired" : r.inv.status) as InvitationRow["status"],
      expiresAt: r.inv.expiresAt,
      lastSentAt: r.inv.lastSentAt,
      acceptedAt: r.inv.acceptedAt,
      createdAt: r.inv.createdAt,
      invitedByEmail: r.inviter,
    }))
    .filter((r) => !opts.status?.length || opts.status.includes(r.status));
}

/** True when an account with this email exists (invitation links must not be exposed for it). */
export async function userExists(email: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  return Boolean(u);
}

export async function loadInvitation(id: string, workspaceId?: string) {
  const [inv] = await db
    .select()
    .from(invitations)
    .where(workspaceId ? and(eq(invitations.id, id), eq(invitations.workspaceId, workspaceId)) : eq(invitations.id, id))
    .limit(1);
  if (!inv) throw new MemberError("Invitation not found.");
  return inv;
}

/**
 * Issues a fresh link for an invitation (old link stops working), extends its validity and
 * optionally emails it again. Returns the new URL so admins can copy it.
 */
export async function reissueInvitation(
  id: string,
  actor: Actor,
  opts: { send: boolean; workspaceId?: string; /** must be true to get a copyable link (instance admins only) */ linkForAdmin?: boolean },
) {
  if (!opts.send && !opts.linkForAdmin) throw new MemberError("Only instance admins can copy invitation links.");
  const inv = await loadInvitation(id, opts.workspaceId);
  if (inv.status === "accepted") throw new MemberError("This invitation was already accepted.");
  if (inv.status === "revoked") throw new MemberError("This invitation was revoked. Create a new one.");
  const existingAccount = await userExists(inv.email);
  if (!opts.send && existingAccount) {
    // Accepting an invitation link signs the holder in; a copyable link for an existing account
    // would let whoever copies it act as that person. Existing users get access at next sign-in.
    throw new MemberError(
      `${inv.email} already has an account — they get access automatically at their next sign-in. Use “Resend email” to notify them.`,
    );
  }
  if (opts.send && !rateLimit(`invite:addr:${inv.email}`, 5, 24 * 60 * 60_000)) {
    throw new MemberError(`${inv.email} already received several invitation emails today. Try again tomorrow.`);
  }
  const authSettings = await getSetting("auth");
  const token = randomToken(32);
  await db
    .update(invitations)
    .set({
      tokenHash: sha256(token),
      status: "pending",
      expiresAt: new Date(Date.now() + authSettings.inviteDays * 86_400_000),
      lastSentAt: opts.send ? new Date() : inv.lastSentAt,
    })
    .where(eq(invitations.id, inv.id));
  const url = appUrl(`/invite/${encodeURIComponent(token)}`);
  let transport: "smtp" | "log" | null = null;
  let delivered = false;
  if (opts.send) {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, inv.workspaceId)).limit(1);
    const mail = await invitationEmail({
      url,
      inviterName: actor.name || actor.email,
      workspaceName: ws?.name ?? "the workspace",
      message: inv.message,
      days: authSettings.inviteDays,
    });
    const res = await sendMail({ to: inv.email, ...mail });
    transport = res.transport;
    delivered = res.delivered;
  }
  void logAudit(opts.send ? "invitation.resent" : "invitation.link_regenerated", {
    actor,
    targetType: "invitation",
    targetId: inv.id,
    workspaceId: inv.workspaceId,
    meta: { email: inv.email, transport },
  });
  // The link is only handed back to instance admins, and only for people without an account.
  return { url: existingAccount || !opts.linkForAdmin ? null : url, transport, delivered };
}

export async function revokeInvitation(id: string, actor: Actor, workspaceId?: string) {
  const inv = await loadInvitation(id, workspaceId);
  if (inv.status !== "pending") throw new MemberError("Only pending invitations can be revoked.");
  await db.update(invitations).set({ status: "revoked" }).where(eq(invitations.id, inv.id));
  void logAudit("invitation.revoked", { actor, targetType: "invitation", targetId: inv.id, workspaceId: inv.workspaceId, meta: { email: inv.email } });
}

/** Sessions (devices) of a user that are still valid. */
export async function listActiveSessions(userId: string) {
  return db
    .select({
      id: sessions.id,
      deviceLabel: sessions.deviceLabel,
      userAgent: sessions.userAgent,
      ip: sessions.ip,
      lastSeenAt: sessions.lastSeenAt,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), sql`${sessions.revokedAt} IS NULL`, gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
}
