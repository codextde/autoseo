"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db/client";
import { invitations, projectMembers, projectShares, projects, roles, users, workspaceMembers } from "@/server/db/schema";
import { actionUser, ActionError, runAction } from "@/server/auth/guards";
import { listUserSessions, revokeAllSessions, revokeSession } from "@/server/auth/session";
import { createInvitation } from "@/server/auth/membership";
import { isValidEmail, normalizeEmail } from "@/server/auth/domains";
import { rateLimit } from "@/server/rate-limit";
import { logAudit } from "@/server/audit";
import {
  actionManageProject,
  actionWorkspace,
  assertProjectsWithinReach,
  assertRoleWithinReach,
  reachableProjectIds,
  type WorkspaceAccess,
} from "@/server/admin/access";
import { removeAvatar, replaceAvatar, updateLocale, updateProfile } from "@/server/admin/account";
import {
  loadInvitation,
  MemberError,
  reissueInvitation,
  removeMember,
  revokeInvitation,
  setMemberRole,
  setProjectAccess,
} from "@/server/admin/members";
import { deleteProject, ProjectAdminError, setProjectArchived, updateProject } from "@/server/admin/projects";
import { UploadError } from "@/server/admin/uploads";

/** Maps domain errors of the shared services to user-facing action errors. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MemberError || err instanceof ProjectAdminError || err instanceof UploadError) {
      throw new ActionError(err.message, "invalid");
    }
    throw err;
  }
}

/* ─────────────────────────────── Account ─────────────────────────────── */

export async function updateProfileAction(input: { name: string }) {
  return runAction(async () => {
    const ctx = await actionUser();
    const name = z.string().trim().min(1, "Please enter your name").max(80).parse(input.name);
    await updateProfile(ctx.user.id, { name }, ctx.user);
    refresh();
    return true;
  });
}

export async function uploadAvatarAction(formData: FormData) {
  return runAction(async () => {
    const ctx = await actionUser();
    if (!rateLimit(`avatar:${ctx.user.id}`, 20, 60 * 60_000)) throw new ActionError("Too many uploads. Try again later.", "invalid");
    const file = formData.get("file");
    if (!(file instanceof File)) throw new ActionError("No file received.", "invalid");
    const url = await guarded(() => replaceAvatar(ctx.user.id, file, ctx.user));
    refresh();
    return { url };
  });
}

export async function removeAvatarAction() {
  return runAction(async () => {
    const ctx = await actionUser();
    await removeAvatar(ctx.user.id, ctx.user);
    refresh();
    return true;
  });
}

export async function updateLocaleAction(locale: string) {
  return runAction(async () => {
    const ctx = await actionUser();
    await updateLocale(ctx.user.id, z.enum(["en", "de"]).parse(locale), ctx.user);
    refresh();
    return true;
  });
}

export async function revokeMySessionAction(sessionId: string) {
  return runAction(async () => {
    const ctx = await actionUser();
    const id = z.string().min(1).max(64).parse(sessionId);
    if (id === ctx.sessionId) throw new ActionError("Use “Log out” to end the session on this device.", "invalid");
    const mine = await listUserSessions(ctx.user.id);
    const target = mine.find((s) => s.id === id);
    if (!target) throw new ActionError("Session not found.", "not_found");
    await revokeSession(ctx.user.id, id);
    void logAudit("session.revoked", { actor: ctx.user, targetType: "session", targetId: id, meta: { device: target.deviceLabel } });
    refresh();
    return true;
  });
}

export async function signOutOtherDevicesAction() {
  return runAction(async () => {
    const ctx = await actionUser();
    const before = await listUserSessions(ctx.user.id);
    await revokeAllSessions(ctx.user.id, ctx.sessionId);
    void logAudit("session.revoked_others", { actor: ctx.user, targetType: "user", targetId: ctx.user.id, meta: { count: before.length - 1 } });
    refresh();
    return { revoked: Math.max(0, before.length - 1) };
  });
}

/* ─────────────────────────────── Workspace ─────────────────────────────── */

async function loadRole(roleKey: string) {
  const [role] = await db.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
  if (!role) throw new ActionError("Unknown role.", "invalid");
  return role;
}

async function currentMemberRole(workspaceId: string, userId: string) {
  const [m] = await db
    .select({ roleKey: workspaceMembers.roleKey })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!m) throw new ActionError("Member not found.", "not_found");
  return loadRole(m.roleKey);
}

/** Workspace managers may only act on invitations they could have created themselves. */
async function assertInvitationWithinReach(access: WorkspaceAccess, invitationId: string) {
  const inv = await guarded(() => loadInvitation(invitationId, access.workspace.id));
  if (inv.makeInstanceAdmin && !access.ctx.isInstanceAdmin) {
    throw new ActionError("Only instance admins can manage invitations that grant admin access.", "forbidden");
  }
  assertRoleWithinReach(access, await loadRole(inv.roleKey));
  await assertProjectsWithinReach(access, inv.projectIds);
  return inv;
}

const inviteInput = z.object({
  workspaceId: z.string().min(1),
  emails: z.array(z.string().trim().min(3).max(254)).min(1, "Add at least one email").max(50),
  roleKey: z.string().min(1),
  projectIds: z.array(z.string()).max(500).default([]),
  message: z.string().trim().max(1000).optional().nullable(),
});

export async function inviteMembersAction(input: z.input<typeof inviteInput>) {
  return runAction(async () => {
    const data = inviteInput.parse(input);
    const access = await actionWorkspace(data.workspaceId, "members.manage");
    const role = await loadRole(data.roleKey);
    assertRoleWithinReach(access, role);
    await assertProjectsWithinReach(access, data.projectIds);
    const validProjects = data.projectIds.length
      ? (
          await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.workspaceId, data.workspaceId), inArray(projects.id, data.projectIds)))
        ).map((p) => p.id)
      : [];
    const results: { email: string; ok: boolean; error?: string; transport?: "smtp" | "log" }[] = [];
    const emails = [...new Set(data.emails.map(normalizeEmail))];
    for (const email of emails) {
      if (!isValidEmail(email)) {
        results.push({ email, ok: false, error: "Invalid email address" });
        continue;
      }
      if (
        !rateLimit(`invite:ws:${data.workspaceId}`, 100, 24 * 60 * 60_000) ||
        !rateLimit(`invite:addr:${email}`, 5, 24 * 60 * 60_000)
      ) {
        results.push({ email, ok: false, error: "Daily invitation limit reached" });
        continue;
      }
      try {
        const res = await createInvitation({
          workspaceId: data.workspaceId,
          email,
          roleKey: role.key,
          projectIds: validProjects,
          makeInstanceAdmin: false,
          message: data.message || null,
          invitedBy: { id: access.ctx.user.id, email: access.ctx.user.email, name: access.ctx.user.name },
        });
        results.push({ email, ok: true, transport: res.delivery.transport });
      } catch (err) {
        results.push({ email, ok: false, error: err instanceof Error ? err.message : "Failed" });
      }
    }
    refresh();
    return results;
  });
}

export async function changeMemberRoleAction(input: { workspaceId: string; userId: string; roleKey: string }) {
  return runAction(async () => {
    const data = z.object({ workspaceId: z.string(), userId: z.string(), roleKey: z.string() }).parse(input);
    const access = await actionWorkspace(data.workspaceId, "members.manage");
    assertRoleWithinReach(access, await currentMemberRole(data.workspaceId, data.userId));
    assertRoleWithinReach(access, await loadRole(data.roleKey));
    await guarded(() => setMemberRole(data.workspaceId, data.userId, data.roleKey, access.ctx.user));
    refresh();
    return true;
  });
}

export async function setMemberProjectsAction(input: { workspaceId: string; userId: string; projectIds: string[] }) {
  return runAction(async () => {
    const data = z
      .object({ workspaceId: z.string(), userId: z.string(), projectIds: z.array(z.string()).max(1000) })
      .parse(input);
    const access = await actionWorkspace(data.workspaceId, "members.manage");
    assertRoleWithinReach(access, await currentMemberRole(data.workspaceId, data.userId));
    // Project-restricted managers only toggle projects they can see; other grants stay as they are.
    let projectIds = data.projectIds;
    const reach = await reachableProjectIds(access);
    if (reach) {
      const current = await db
        .select({ id: projectMembers.projectId })
        .from(projectMembers)
        .innerJoin(projects, eq(projects.id, projectMembers.projectId))
        .where(and(eq(projectMembers.userId, data.userId), eq(projects.workspaceId, data.workspaceId)));
      projectIds = [
        ...new Set([...data.projectIds.filter((id) => reach.has(id)), ...current.map((c) => c.id).filter((id) => !reach.has(id))]),
      ];
    }
    const ids = await setProjectAccess(data.workspaceId, data.userId, projectIds, access.ctx.user);
    refresh();
    return ids;
  });
}

export async function removeMemberAction(input: { workspaceId: string; userId: string }) {
  return runAction(async () => {
    const data = z.object({ workspaceId: z.string(), userId: z.string() }).parse(input);
    const access = await actionWorkspace(data.workspaceId, "members.manage");
    if (data.userId === access.ctx.user.id) throw new ActionError("You can't remove yourself from the workspace.", "invalid");
    assertRoleWithinReach(access, await currentMemberRole(data.workspaceId, data.userId));
    await guarded(() => removeMember(data.workspaceId, data.userId, access.ctx.user));
    refresh();
    return true;
  });
}

export async function resendInvitationAction(input: { workspaceId: string; invitationId: string }) {
  return runAction(async () => {
    const data = z.object({ workspaceId: z.string(), invitationId: z.string() }).parse(input);
    const access = await actionWorkspace(data.workspaceId, "members.manage");
    await assertInvitationWithinReach(access, data.invitationId);
    if (!rateLimit(`invite-resend:${access.ctx.user.id}`, 30, 60 * 60_000)) throw new ActionError("Too many resends. Try again later.", "invalid");
    const res = await guarded(() =>
      reissueInvitation(data.invitationId, access.ctx.user, { send: true, workspaceId: data.workspaceId }),
    );
    refresh();
    return { transport: res.transport, delivered: res.delivered };
  });
}

export async function invitationLinkAction(input: { workspaceId: string; invitationId: string }) {
  return runAction(async () => {
    const data = z.object({ workspaceId: z.string(), invitationId: z.string() }).parse(input);
    const access = await actionWorkspace(data.workspaceId, "members.manage");
    // A copied link signs in whoever opens it as the invitee, so only instance admins may copy
    // links; everyone else relies on the emailed link reaching the right inbox.
    if (!access.ctx.isInstanceAdmin) {
      throw new ActionError("Only instance admins can copy invitation links. Use “Resend email” instead.", "forbidden");
    }
    await assertInvitationWithinReach(access, data.invitationId);
    const res = await guarded(() =>
      reissueInvitation(data.invitationId, access.ctx.user, {
        send: false,
        workspaceId: data.workspaceId,
        linkForAdmin: access.ctx.isInstanceAdmin,
      }),
    );
    refresh();
    if (!res.url) throw new ActionError("No shareable link for existing accounts.", "invalid");
    return { url: res.url };
  });
}

export async function revokeInvitationAction(input: { workspaceId: string; invitationId: string }) {
  return runAction(async () => {
    const data = z.object({ workspaceId: z.string(), invitationId: z.string() }).parse(input);
    const access = await actionWorkspace(data.workspaceId, "members.manage");
    await assertInvitationWithinReach(access, data.invitationId);
    await guarded(() => revokeInvitation(data.invitationId, access.ctx.user, data.workspaceId));
    refresh();
    return true;
  });
}

/* ─────────────────────────────── Project sharing ─────────────────────────────── */

export async function shareProjectAction(input: { workspaceId: string; projectId: string; email: string; message?: string }) {
  return runAction(async () => {
    const data = z
      .object({
        workspaceId: z.string(),
        projectId: z.string(),
        email: z.string().trim().max(254),
        message: z.string().trim().max(1000).optional(),
      })
      .parse(input);
    const access = await actionWorkspace(data.workspaceId, "members.manage");
    const email = normalizeEmail(data.email);
    if (!isValidEmail(email)) throw new ActionError("Please enter a valid email address.", "invalid");
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, data.projectId), eq(projects.workspaceId, data.workspaceId)))
      .limit(1);
    if (!project) throw new ActionError("Project not found.", "not_found");
    await assertProjectsWithinReach(access, [project.id]);
    if (email === access.ctx.user.email) throw new ActionError("You already have access to this project.", "invalid");
    if (!rateLimit(`share:${access.ctx.user.id}`, 50, 24 * 60 * 60_000) || !rateLimit(`share:addr:${email}`, 5, 24 * 60 * 60_000)) {
      throw new ActionError("Daily sharing limit reached.", "invalid");
    }

    // Existing workspace members just get project access.
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    let mode: "invited" | "granted" = "invited";
    if (existing) {
      const [member] = await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, data.workspaceId), eq(workspaceMembers.userId, existing.id)))
        .limit(1);
      if (member) {
        await db.insert(projectMembers).values({ projectId: project.id, userId: existing.id }).onConflictDoNothing();
        mode = "granted";
      }
    }
    if (mode === "invited") {
      try {
        await createInvitation({
          workspaceId: data.workspaceId,
          email,
          roleKey: "client",
          projectIds: [project.id],
          message: data.message || `You've been given access to ${project.name} (${project.domain}).`,
          invitedBy: { id: access.ctx.user.id, email: access.ctx.user.email, name: access.ctx.user.name },
        });
      } catch (err) {
        throw new ActionError(err instanceof Error ? err.message : "Could not create the invitation.", "invalid");
      }
    }
    // One share row per project+email; re-sharing re-activates a revoked share.
    const [share] = await db
      .select()
      .from(projectShares)
      .where(and(eq(projectShares.projectId, project.id), eq(projectShares.email, email)))
      .limit(1);
    if (share) {
      await db
        .update(projectShares)
        .set({ status: mode === "granted" ? "active" : "pending", invitedBy: access.ctx.user.id })
        .where(eq(projectShares.id, share.id));
    } else {
      await db.insert(projectShares).values({
        projectId: project.id,
        email,
        roleKey: "client",
        status: mode === "granted" ? "active" : "pending",
        invitedBy: access.ctx.user.id,
      });
    }
    void logAudit("project.shared", {
      actor: access.ctx.user,
      targetType: "project",
      targetId: project.id,
      projectId: project.id,
      workspaceId: data.workspaceId,
      meta: { email, mode },
    });
    refresh();
    return { mode };
  });
}

export async function revokeShareAction(input: { workspaceId: string; shareId: string }) {
  return runAction(async () => {
    const data = z.object({ workspaceId: z.string(), shareId: z.string() }).parse(input);
    const access = await actionWorkspace(data.workspaceId, "members.manage");
    const [row] = await db
      .select({ share: projectShares, project: projects })
      .from(projectShares)
      .innerJoin(projects, eq(projects.id, projectShares.projectId))
      .where(and(eq(projectShares.id, data.shareId), eq(projects.workspaceId, data.workspaceId)))
      .limit(1);
    if (!row) throw new ActionError("Share not found.", "not_found");
    await db.update(projectShares).set({ status: "revoked" }).where(eq(projectShares.id, row.share.id));
    // Revoke pending invitations that only grant this project…
    const pending = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.workspaceId, data.workspaceId),
          eq(invitations.email, row.share.email),
          eq(invitations.status, "pending"),
        ),
      );
    for (const inv of pending) {
      if (inv.projectIds.length === 1 && inv.projectIds[0] === row.project.id) {
        await db.update(invitations).set({ status: "revoked" }).where(eq(invitations.id, inv.id));
      }
    }
    // …and drop the explicit project access of the shared user.
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, row.share.email)).limit(1);
    if (u) {
      await db
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, row.project.id), eq(projectMembers.userId, u.id)));
    }
    void logAudit("project.share_revoked", {
      actor: access.ctx.user,
      targetType: "project",
      targetId: row.project.id,
      projectId: row.project.id,
      workspaceId: data.workspaceId,
      meta: { email: row.share.email },
    });
    refresh();
    return true;
  });
}

/* ─────────────────────────────── Projects ─────────────────────────────── */

export async function updateProjectBasicsAction(input: { projectId: string; name: string; domain: string }) {
  return runAction(async () => {
    const data = z
      .object({ projectId: z.string(), name: z.string().trim().min(1).max(120), domain: z.string().trim().min(1).max(253) })
      .parse(input);
    const access = await actionManageProject(data.projectId);
    const updated = await guarded(() =>
      updateProject(data.projectId, { name: data.name, domain: data.domain }, access.ctx.user),
    );
    refresh();
    return { name: updated.name, domain: updated.domain };
  });
}

export async function setProjectArchivedAction(input: { projectId: string; archived: boolean }) {
  return runAction(async () => {
    const data = z.object({ projectId: z.string(), archived: z.boolean() }).parse(input);
    const access = await actionManageProject(data.projectId);
    await guarded(() => setProjectArchived(data.projectId, data.archived, access.ctx.user));
    refresh();
    return true;
  });
}

export async function deleteProjectAction(input: { projectId: string; confirm: string }) {
  return runAction(async () => {
    const data = z.object({ projectId: z.string(), confirm: z.string() }).parse(input);
    const access = await actionManageProject(data.projectId);
    if (data.confirm.trim().toLowerCase() !== access.project.domain.toLowerCase()) {
      throw new ActionError(`Type ${access.project.domain} to confirm.`, "invalid");
    }
    await guarded(() => deleteProject(data.projectId, access.ctx.user));
    refresh();
    return true;
  });
}
