import "server-only";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  invitations,
  projectMembers,
  projects,
  roles,
  users,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema";
import { randomToken, sha256 } from "@/server/crypto";
import { getSetting } from "@/server/settings";
import { sendMail, appUrl } from "@/server/email";
import { invitationEmail } from "@/server/email/templates";
import { logAudit } from "@/server/audit";
import { BUILTIN_ROLES } from "./permissions";
import { isEmailDomainAllowed, isValidEmail, normalizeEmail } from "./domains";
import { createSession, getCurrentSession } from "./session";

/** Inserts/refreshes the built-in roles (idempotent, keeps admin edits to permissions). */
export async function ensureBuiltinRoles() {
  const existing = await db.select().from(roles);
  const keys = new Set(existing.map((r) => r.key));
  for (const role of BUILTIN_ROLES) {
    if (!keys.has(role.key)) {
      await db.insert(roles).values({
        key: role.key,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        allProjects: role.allProjects,
        builtin: true,
        sortOrder: role.sortOrder,
      });
    }
  }
}

export async function getDefaultWorkspace() {
  const [ws] = await db.select().from(workspaces).orderBy(asc(workspaces.createdAt)).limit(1);
  return ws ?? null;
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 48) || "workspace"
  );
}

export async function createWorkspace(name: string) {
  let slug = slugify(name);
  const [clash] = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (clash) slug = `${slug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const [ws] = await db.insert(workspaces).values({ name, slug }).returning();
  return ws!;
}

/**
 * Accepts all pending invitations for an email: creates the user if needed, adds workspace
 * memberships and project access. Returns the user or null when there was nothing to accept.
 */
export async function acceptInvitationForUser(rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  const pending = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.email, email), eq(invitations.status, "pending"), gt(invitations.expiresAt, new Date())));
  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (pending.length === 0) return user ?? null;

  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email, name: email.split("@")[0], isInstanceAdmin: pending.some((p) => p.makeInstanceAdmin) })
      .returning();
  } else if (pending.some((p) => p.makeInstanceAdmin) && !user.isInstanceAdmin) {
    await db.update(users).set({ isInstanceAdmin: true }).where(eq(users.id, user.id));
  }

  for (const inv of pending) {
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: inv.workspaceId, userId: user!.id, roleKey: inv.roleKey })
      // Existing members keep their role — role changes happen in member management only.
      .onConflictDoNothing();
    if (inv.projectIds.length) {
      const valid = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(inArray(projects.id, inv.projectIds), eq(projects.workspaceId, inv.workspaceId)));
      for (const p of valid) {
        await db.insert(projectMembers).values({ projectId: p.id, userId: user!.id }).onConflictDoNothing();
      }
    }
    await db
      .update(invitations)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(invitations.id, inv.id));
    void logAudit("invitation.accepted", {
      actor: { id: user!.id, email },
      targetType: "invitation",
      targetId: inv.id,
      workspaceId: inv.workspaceId,
    });
  }
  return user!;
}

/** Self-registration for allowed-domain emails when enabled in Admin → Authentication. */
export async function ensureDomainSignupUser(rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  const auth = await getSetting("auth");
  if (!auth.allowDomainSignup && auth.requireInvitation) return null;
  if (!(await isEmailDomainAllowed(email))) return null;
  const ws = await getDefaultWorkspace();
  if (!ws) return null;
  const [user] = await db
    .insert(users)
    .values({ email, name: email.split("@")[0] })
    .onConflictDoNothing()
    .returning();
  const final = user ?? (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (!final) return null;
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: ws.id, userId: final.id, roleKey: auth.defaultRoleKey })
    .onConflictDoNothing();
  void logAudit("auth.domain_signup", { actor: { id: final.id, email }, workspaceId: ws.id });
  return final;
}

export async function createInvitation(opts: {
  workspaceId: string;
  email: string;
  roleKey: string;
  projectIds?: string[];
  makeInstanceAdmin?: boolean;
  message?: string | null;
  invitedBy: { id: string; email: string; name?: string | null };
}) {
  const email = normalizeEmail(opts.email);
  if (!isValidEmail(email)) throw new Error(`Invalid email: ${opts.email}`);
  if (!(await isEmailDomainAllowed(email))) {
    const { allowedDomains } = await getSetting("auth");
    throw new Error(`Only emails from ${allowedDomains.map((d) => `@${d}`).join(", ")} can be invited.`);
  }
  const [role] = await db.select().from(roles).where(eq(roles.key, opts.roleKey)).limit(1);
  if (!role) throw new Error("Unknown role.");

  const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existingUser) {
    const [member] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, opts.workspaceId), eq(workspaceMembers.userId, existingUser.id)))
      .limit(1);
    if (member) throw new Error("This person is already a member of the workspace.");
  }

  const authSettings = await getSetting("auth");
  const token = randomToken(32);
  // Revoke older pending invites for the same email+workspace
  await db
    .update(invitations)
    .set({ status: "revoked" })
    .where(
      and(
        eq(invitations.email, email),
        eq(invitations.workspaceId, opts.workspaceId),
        eq(invitations.status, "pending"),
      ),
    );
  const [invite] = await db
    .insert(invitations)
    .values({
      workspaceId: opts.workspaceId,
      email,
      roleKey: opts.roleKey,
      projectIds: opts.projectIds ?? [],
      makeInstanceAdmin: opts.makeInstanceAdmin ?? false,
      tokenHash: sha256(token),
      invitedBy: opts.invitedBy.id,
      message: opts.message ?? null,
      expiresAt: new Date(Date.now() + authSettings.inviteDays * 24 * 60 * 60 * 1000),
      lastSentAt: new Date(),
    })
    .returning();

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, opts.workspaceId)).limit(1);
  const url = appUrl(`/invite/${encodeURIComponent(token)}`);
  const mail = await invitationEmail({
    url,
    inviterName: opts.invitedBy.name || opts.invitedBy.email,
    workspaceName: ws?.name ?? "the workspace",
    message: opts.message,
    days: authSettings.inviteDays,
  });
  const delivery = await sendMail({ to: email, ...mail });
  void logAudit("invitation.created", {
    actor: opts.invitedBy,
    targetType: "invitation",
    targetId: invite!.id,
    workspaceId: opts.workspaceId,
    meta: { email, roleKey: opts.roleKey, transport: delivery.transport },
  });
  return { invite: invite!, url, delivery };
}

/** Accepting an invitation link logs the user in directly (the link proves email ownership). */
export async function acceptInvitationToken(token: string) {
  const [invite] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, sha256(token)))
    .limit(1);
  if (!invite || invite.status !== "pending") return { ok: false as const, error: "This invitation is invalid or was already used." };
  if (invite.expiresAt < new Date()) {
    await db.update(invitations).set({ status: "expired" }).where(eq(invitations.id, invite.id));
    return { ok: false as const, error: "This invitation has expired. Ask for a new one." };
  }
  if (!(await isEmailDomainAllowed(invite.email))) {
    return { ok: false as const, error: "This email domain is no longer allowed." };
  }
  const [existing] = await db.select().from(users).where(eq(users.email, invite.email)).limit(1);
  if (existing) {
    // An invite link must never act as a login for an existing account. Accept it only for the
    // signed-in owner of that email; otherwise they sign in normally (login auto-accepts invites).
    const current = await getCurrentSession();
    if (!current || current.user.id !== existing.id) {
      return { ok: false as const, error: "You already have an account. Sign in with this email to accept the invitation.", needsLogin: true as const };
    }
    await acceptInvitationForUser(invite.email);
    return { ok: true as const, user: existing };
  }
  const user = await acceptInvitationForUser(invite.email);
  if (!user) return { ok: false as const, error: "Could not accept the invitation." };
  if (user.status !== "active") return { ok: false as const, error: "This account is disabled." };
  await createSession(user.id);
  return { ok: true as const, user };
}

export async function peekInvitation(token: string) {
  const [row] = await db
    .select({ invite: invitations, workspace: workspaces })
    .from(invitations)
    .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
    .where(eq(invitations.tokenHash, sha256(token)))
    .limit(1);
  return row ?? null;
}
