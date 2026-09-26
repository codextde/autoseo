import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  agentEvents,
  agentJobs,
  agents,
  aiRuns,
  apiKeys,
  auditLogs,
  bookmarks,
  chatAttachments,
  chatFeedback,
  chatMessages,
  chats,
  feedback,
  invitations,
  jobs,
  loginTokens,
  notifications,
  oauthAuthorizationCodes,
  oauthClients,
  oauthGrants,
  oauthRefreshTokens,
  optimizeTasks,
  projectMembers,
  projectShares,
  projects,
  reports,
  reportTemplates,
  roles,
  seoSearchHistory,
  sessions,
  usageEvents,
  users,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema";
import { env } from "@/server/env";
import { logAudit } from "@/server/audit";
import { assertAdminsRemain, countInstanceAdmins } from "./members";
import { deleteUploadByUrl } from "./uploads";

/**
 * GDPR data export + erasure ("right to be forgotten") for one user. Used by Settings → Account
 * (self-service) and Admin → Users ("Erase user"). Workspace resources (projects, reports,
 * templates, tasks, content…) are kept and re-attributed to a "Deleted user" placeholder;
 * personal data (sessions, keys, chats, bookmarks, notifications, feedback, invitations…) is deleted
 * and audit-log entries are anonymized.
 */

export const DELETED_USER_LABEL = "Deleted user";
export const DELETED_USER_EMAIL = "deleted-user";

export class ErasureError extends Error {
  constructor(
    message: string,
    public code: "not_found" | "confirm_mismatch" | "blocked" = "blocked",
  ) {
    super(message);
  }
}

export type ErasureBlocker =
  | { code: "sole_owner"; message: string; workspaces: { id: string; name: string; members: number }[] }
  | { code: "last_admin"; message: string };

export type InventoryItem = {
  key: string;
  label: string;
  count: number;
  /** delete = removed; anonymize = kept without personal data; revoke = access removed; keep = workspace data re-attributed */
  action: "delete" | "anonymize" | "revoke" | "keep";
};

export type ErasureInventory = {
  user: { id: string; email: string; name: string | null; isInstanceAdmin: boolean };
  items: InventoryItem[];
  blockers: ErasureBlocker[];
};

/* ───────────────────────────── Pure helpers (unit tested) ───────────────────────────── */

/** Replaces every occurrence of `email` (case-insensitive) in a JSON value with the placeholder. */
export function anonymizeJson<T>(value: T, email: string, placeholder = DELETED_USER_EMAIL): T {
  if (!email) return value;
  const needle = email.toLowerCase();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (!v.toLowerCase().includes(needle)) return v;
      return v.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), placeholder);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * Workspaces that would be left without an owner while other people still work in them.
 * `ownedWorkspaces` = workspaces where the user is an owner, with counts of the *other* members/owners.
 */
export function findOwnershipBlockers(
  ownedWorkspaces: { id: string; name: string; otherOwners: number; otherMembers: number }[],
): { id: string; name: string; members: number }[] {
  return ownedWorkspaces
    .filter((w) => w.otherOwners === 0 && w.otherMembers > 0)
    .map((w) => ({ id: w.id, name: w.name, members: w.otherMembers }));
}

/** Strips secrets (hashes/tokens) from a row before it goes into an export. */
export function omitKeys<T extends Record<string, unknown>>(row: T, keys: readonly string[]): Partial<T> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k))) as Partial<T>;
}

/* ───────────────────────────── Inventory ───────────────────────────── */

async function loadUser(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new ErasureError("User not found.", "not_found");
  return user;
}

async function count(q: Promise<Array<{ n: number }>>) {
  const [row] = await q;
  return Number(row?.n ?? 0);
}

const n = sql<number>`count(*)::int`;

export async function getErasureBlockers(userId: string): Promise<ErasureBlocker[]> {
  const user = await loadUser(userId);
  const owned = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.roleKey, "owner")));
  const ownedStats = [];
  for (const w of owned) {
    const [row] = await db
      .select({
        otherMembers: sql<number>`count(*) filter (where ${users.status} = 'active')::int`,
        otherOwners: sql<number>`count(*) filter (where ${workspaceMembers.roleKey} = 'owner' and ${users.status} = 'active')::int`,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, w.id), ne(workspaceMembers.userId, userId)));
    ownedStats.push({ ...w, otherMembers: Number(row?.otherMembers ?? 0), otherOwners: Number(row?.otherOwners ?? 0) });
  }
  const blockers: ErasureBlocker[] = [];
  const soleOwned = findOwnershipBlockers(ownedStats);
  if (soleOwned.length) {
    blockers.push({
      code: "sole_owner",
      message: `Transfer ownership of ${soleOwned.map((w) => `“${w.name}”`).join(", ")} to another member first.`,
      workspaces: soleOwned,
    });
  }
  // Would the instance lose its last administrator?
  const adminRole = await db
    .select({ n })
    .from(workspaceMembers)
    .innerJoin(roles, eq(roles.key, workspaceMembers.roleKey))
    .where(and(eq(workspaceMembers.userId, userId), sql`${roles.permissions} @> '["admin.access"]'::jsonb`));
  const isAdmin = user.status === "active" && (user.isInstanceAdmin || Number(adminRole[0]?.n ?? 0) > 0);
  if (isAdmin && (await countInstanceAdmins()) <= 1) {
    blockers.push({ code: "last_admin", message: "This is the only instance administrator. Make someone else an admin first." });
  }
  return blockers;
}

export async function getErasureInventory(userId: string): Promise<ErasureInventory> {
  const user = await loadUser(userId);
  const email = user.email;
  const emailLike = `%${email.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const [
    sessionCount,
    apiKeyCount,
    grantCount,
    agentCount,
    chatCount,
    messageCount,
    attachmentCount,
    bookmarkCount,
    notificationCount,
    feedbackCount,
    historyCount,
    invitationCount,
    shareCount,
    membershipCount,
    projectAccessCount,
    reportCount,
    sharedReportCount,
    templateCount,
    auditCount,
    usageCount,
    loginTokenCount,
  ] = await Promise.all([
    count(db.select({ n }).from(sessions).where(eq(sessions.userId, userId))),
    count(db.select({ n }).from(apiKeys).where(eq(apiKeys.userId, userId))),
    count(db.select({ n }).from(oauthGrants).where(eq(oauthGrants.userId, userId))),
    count(db.select({ n }).from(agents).where(eq(agents.userId, userId))),
    count(db.select({ n }).from(chats).where(eq(chats.userId, userId))),
    count(db.select({ n }).from(chatMessages).innerJoin(chats, eq(chats.id, chatMessages.chatId)).where(eq(chats.userId, userId))),
    count(db.select({ n }).from(chatAttachments).where(eq(chatAttachments.userId, userId))),
    count(db.select({ n }).from(bookmarks).where(eq(bookmarks.userId, userId))),
    count(db.select({ n }).from(notifications).where(eq(notifications.userId, userId))),
    count(db.select({ n }).from(feedback).where(eq(feedback.userId, userId))),
    count(db.select({ n }).from(seoSearchHistory).where(eq(seoSearchHistory.userId, userId))),
    count(db.select({ n }).from(invitations).where(or(eq(invitations.invitedBy, userId), eq(invitations.email, email)))),
    count(db.select({ n }).from(projectShares).where(eq(projectShares.email, email))),
    count(db.select({ n }).from(workspaceMembers).where(eq(workspaceMembers.userId, userId))),
    count(db.select({ n }).from(projectMembers).where(eq(projectMembers.userId, userId))),
    count(db.select({ n }).from(reports).where(eq(reports.createdBy, userId))),
    count(db.select({ n }).from(reports).where(and(eq(reports.createdBy, userId), eq(reports.shareEnabled, true)))),
    count(db.select({ n }).from(reportTemplates).where(eq(reportTemplates.createdBy, userId))),
    count(
      db
        .select({ n })
        .from(auditLogs)
        .where(or(eq(auditLogs.actorId, userId), eq(auditLogs.targetId, userId), sql`${auditLogs.meta}::text ilike ${emailLike}`)),
    ),
    count(db.select({ n }).from(usageEvents).where(eq(usageEvents.userId, userId))),
    count(db.select({ n }).from(loginTokens).where(or(eq(loginTokens.userId, userId), eq(loginTokens.email, email)))),
  ]);
  const items: InventoryItem[] = [
    { key: "sessions", label: "Signed-in devices (sessions)", count: sessionCount, action: "delete" },
    { key: "login_tokens", label: "Sign-in links & codes", count: loginTokenCount, action: "delete" },
    { key: "api_keys", label: "API keys & OAuth tokens", count: apiKeyCount, action: "delete" },
    { key: "oauth_grants", label: "Connected apps (OAuth grants)", count: grantCount, action: "delete" },
    { key: "agents", label: "Local agents owned", count: agentCount, action: "revoke" },
    { key: "chats", label: "Agent chats", count: chatCount, action: "delete" },
    { key: "chat_messages", label: "Chat messages", count: messageCount, action: "delete" },
    { key: "chat_attachments", label: "Chat attachments (files)", count: attachmentCount, action: "delete" },
    { key: "bookmarks", label: "Bookmarks", count: bookmarkCount, action: "delete" },
    { key: "notifications", label: "Notifications", count: notificationCount, action: "delete" },
    { key: "feedback", label: "Feedback messages", count: feedbackCount, action: "delete" },
    { key: "search_history", label: "SEO search history", count: historyCount, action: "delete" },
    { key: "invitations", label: "Invitations sent or received", count: invitationCount, action: "delete" },
    { key: "project_shares", label: "Project shares to this email", count: shareCount, action: "delete" },
    { key: "memberships", label: "Workspace memberships", count: membershipCount, action: "delete" },
    { key: "project_access", label: "Project access grants", count: projectAccessCount, action: "delete" },
    { key: "reports", label: "Reports created (kept, re-attributed)", count: reportCount, action: "keep" },
    { key: "report_shares", label: "Public report links", count: sharedReportCount, action: "revoke" },
    { key: "report_templates", label: "Report templates (kept, re-attributed)", count: templateCount, action: "keep" },
    { key: "audit_logs", label: "Audit-log entries", count: auditCount, action: "anonymize" },
    { key: "usage_events", label: "Usage & cost events", count: usageCount, action: "anonymize" },
  ];
  return {
    user: { id: user.id, email: user.email, name: user.name, isInstanceAdmin: user.isInstanceAdmin },
    items,
    blockers: await getErasureBlockers(userId),
  };
}

/* ───────────────────────────── Erasure ───────────────────────────── */

export type ErasureResult = { counts: Record<string, number>; files: number };

/**
 * Erases a user. `confirmEmail` must match the account email. Throws ErasureError when blocked
 * (sole owner of a workspace with other members, or the last administrator).
 */
export async function eraseUser(
  userId: string,
  opts: { confirmEmail: string; actor: { id: string; email: string } | null; initiatedBy: "self" | "admin" },
): Promise<ErasureResult> {
  const user = await loadUser(userId);
  if (opts.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw new ErasureError("Type the account's email address to confirm.", "confirm_mismatch");
  }
  const blockers = await getErasureBlockers(userId);
  if (blockers.length) throw new ErasureError(blockers.map((b) => b.message).join(" "), "blocked");

  const email = user.email;
  const emailLike = `%${email.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  // Files to remove after the database transaction commits.
  const attachmentFiles = await db
    .select({ projectId: chatAttachments.projectId, storageName: chatAttachments.storageName })
    .from(chatAttachments)
    .where(eq(chatAttachments.userId, userId));
  const ownedAgents = await db.select({ id: agents.id }).from(agents).where(eq(agents.userId, userId));

  const counts: Record<string, number> = {};
  const tally = (key: string, rows: unknown[]) => {
    counts[key] = (counts[key] ?? 0) + rows.length;
  };

  await db.transaction(async (tx) => {
    // Audit logs: keep the action, drop the person.
    const logs = await tx
      .select({ id: auditLogs.id, actorId: auditLogs.actorId, meta: auditLogs.meta })
      .from(auditLogs)
      .where(or(eq(auditLogs.actorId, userId), eq(auditLogs.targetId, userId), sql`${auditLogs.meta}::text ilike ${emailLike}`));
    for (const log of logs) {
      await tx
        .update(auditLogs)
        .set({
          meta: anonymizeJson(log.meta, email),
          ...(log.actorId === userId ? { actorId: null, actorEmail: DELETED_USER_EMAIL, ip: null } : {}),
        })
        .where(eq(auditLogs.id, log.id));
    }
    counts.audit_logs = logs.length;
    tally("audit_logs_email", await tx.update(auditLogs).set({ actorEmail: DELETED_USER_EMAIL, ip: null }).where(eq(auditLogs.actorEmail, email)).returning({ id: auditLogs.id }));

    // Reports & templates stay with the workspace; public links of the user's reports are revoked.
    tally(
      "report_shares",
      await tx
        .update(reports)
        .set({ shareEnabled: false, shareToken: null, sharePasswordHash: null })
        .where(and(eq(reports.createdBy, userId), sql`(${reports.shareEnabled} or ${reports.shareToken} is not null)`))
        .returning({ id: reports.id }),
    );
    tally(
      "reports",
      await tx.update(reports).set({ createdBy: null, createdByLabel: DELETED_USER_LABEL }).where(eq(reports.createdBy, userId)).returning({ id: reports.id }),
    );
    tally("report_templates", await tx.update(reportTemplates).set({ createdBy: null }).where(eq(reportTemplates.createdBy, userId)).returning({ id: reportTemplates.id }));

    // Invitations the user sent (not yet accepted) and every invitation/share addressed to them.
    tally(
      "invitations",
      await tx
        .delete(invitations)
        .where(or(and(eq(invitations.invitedBy, userId), ne(invitations.status, "accepted")), eq(invitations.email, email)))
        .returning({ id: invitations.id }),
    );
    tally("project_shares", await tx.delete(projectShares).where(eq(projectShares.email, email)).returning({ id: projectShares.id }));
    tally("login_tokens", await tx.delete(loginTokens).where(or(eq(loginTokens.userId, userId), eq(loginTokens.email, email))).returning({ id: loginTokens.id }));

    // OAuth artefacts without a user foreign key.
    tally("oauth_codes", await tx.delete(oauthAuthorizationCodes).where(eq(oauthAuthorizationCodes.userId, userId)).returning({ id: oauthAuthorizationCodes.id }));
    tally("oauth_refresh_tokens", await tx.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.userId, userId)).returning({ id: oauthRefreshTokens.id }));

    // User-authored personal data.
    tally("feedback", await tx.delete(feedback).where(eq(feedback.userId, userId)).returning({ id: feedback.id }));

    // Soft references (no foreign key) → anonymized.
    tally("usage_events", await tx.update(usageEvents).set({ userId: null }).where(eq(usageEvents.userId, userId)).returning({ id: usageEvents.id }));
    tally("jobs", await tx.update(jobs).set({ createdBy: null }).where(eq(jobs.createdBy, userId)).returning({ id: jobs.id }));
    tally("agent_jobs", await tx.update(agentJobs).set({ userId: null }).where(eq(agentJobs.userId, userId)).returning({ id: agentJobs.id }));
    tally("agent_events", await tx.update(agentEvents).set({ actorId: null }).where(eq(agentEvents.actorId, userId)).returning({ id: agentEvents.id }));
    tally("agents_update_requests", await tx.update(agents).set({ updateRequestedBy: null }).where(eq(agents.updateRequestedBy, userId)).returning({ id: agents.id }));
    tally("ai_runs", await tx.update(aiRuns).set({ createdBy: null }).where(eq(aiRuns.createdBy, userId)).returning({ id: aiRuns.id }));

    // Counts of rows removed by ON DELETE CASCADE with the user row.
    const cascade = async (key: string, q: Promise<Array<{ n: number }>>) => {
      counts[key] = await count(q);
    };
    await cascade("sessions", tx.select({ n }).from(sessions).where(eq(sessions.userId, userId)));
    await cascade("api_keys", tx.select({ n }).from(apiKeys).where(eq(apiKeys.userId, userId)));
    await cascade("oauth_grants", tx.select({ n }).from(oauthGrants).where(eq(oauthGrants.userId, userId)));
    await cascade("chats", tx.select({ n }).from(chats).where(eq(chats.userId, userId)));
    await cascade("chat_attachments", tx.select({ n }).from(chatAttachments).where(eq(chatAttachments.userId, userId)));
    await cascade("chat_feedback", tx.select({ n }).from(chatFeedback).where(eq(chatFeedback.userId, userId)));
    await cascade("bookmarks", tx.select({ n }).from(bookmarks).where(eq(bookmarks.userId, userId)));
    await cascade("notifications", tx.select({ n }).from(notifications).where(eq(notifications.userId, userId)));
    await cascade("search_history", tx.select({ n }).from(seoSearchHistory).where(eq(seoSearchHistory.userId, userId)));
    await cascade("memberships", tx.select({ n }).from(workspaceMembers).where(eq(workspaceMembers.userId, userId)));
    await cascade("project_access", tx.select({ n }).from(projectMembers).where(eq(projectMembers.userId, userId)));

    // Finally the account itself (cascades: sessions, api keys, grants, chats, bookmarks…; other
    // references such as createdBy/assignee are set to NULL by their foreign keys).
    await tx.delete(users).where(eq(users.id, userId));
    await assertAdminsRemain(tx);
  });

  // Local agents that belonged to the user are revoked (token invalid, unfinished jobs requeued).
  if (ownedAgents.length) {
    const { deleteAgent } = await import("@/server/agents/service");
    for (const a of ownedAgents) {
      const [row] = await db.select().from(agents).where(eq(agents.id, a.id)).limit(1);
      if (row) await deleteAgent(row);
    }
  }
  counts.agents = ownedAgents.length;

  // Files: avatar + chat attachments.
  let files = 0;
  if (user.avatarUrl) {
    await deleteUploadByUrl(user.avatarUrl, "avatars");
    files++;
  }
  for (const f of attachmentFiles) {
    if (!/^[A-Za-z0-9._-]+$/.test(f.storageName) || !/^[A-Za-z0-9_-]+$/.test(f.projectId)) continue;
    await fs.rm(path.join(env.dataDir, "chat", f.projectId, f.storageName), { force: true }).catch(() => {});
    files++;
  }

  // No personal data in the event: ids and counts only.
  void logAudit("user.erased", {
    actor: opts.actor,
    targetType: "user",
    targetId: userId,
    meta: { initiatedBy: opts.initiatedBy, counts, files },
  });
  return { counts, files };
}

/* ───────────────────────────── Data export ───────────────────────────── */

/** Everything we store about a user, as a JSON-serializable object (no secrets or token hashes). */
export async function buildUserExport(userId: string) {
  const user = await loadUser(userId);
  const memberships = await db
    .select({ workspaceId: workspaces.id, workspaceName: workspaces.name, roleKey: workspaceMembers.roleKey, joinedAt: workspaceMembers.createdAt })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId));
  const projectAccess = await db
    .select({ projectId: projects.id, name: projects.name, domain: projects.domain, grantedAt: projectMembers.createdAt })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(eq(projectMembers.userId, userId));
  const sessionRows = await db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.createdAt));
  const keyRows = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(desc(apiKeys.createdAt));
  const grantRows = await db
    .select({ grant: oauthGrants, clientName: oauthClients.name })
    .from(oauthGrants)
    .leftJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(eq(oauthGrants.userId, userId));
  const chatRows = await db.select().from(chats).where(eq(chats.userId, userId)).orderBy(desc(chats.createdAt));
  const chatIds = chatRows.map((c) => c.id);
  const messageRows = chatIds.length
    ? await db.select().from(chatMessages).where(inArray(chatMessages.chatId, chatIds)).orderBy(chatMessages.createdAt)
    : [];
  const attachmentRows = await db.select().from(chatAttachments).where(eq(chatAttachments.userId, userId));
  const chatFeedbackRows = await db.select().from(chatFeedback).where(eq(chatFeedback.userId, userId));
  const agentRows = await db
    .select({ id: agents.id, name: agents.name, hostname: agents.hostname, os: agents.os, workspaceId: agents.workspaceId, createdAt: agents.createdAt })
    .from(agents)
    .where(eq(agents.userId, userId));
  const [bookmarkRows, notificationRows, feedbackRows, historyRows, auditRows, reportRows, templateRows, sentInvites, taskRows, usageRows] =
    await Promise.all([
      db.select().from(bookmarks).where(eq(bookmarks.userId, userId)),
      db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)),
      db.select().from(feedback).where(eq(feedback.userId, userId)).orderBy(desc(feedback.createdAt)),
      db.select().from(seoSearchHistory).where(eq(seoSearchHistory.userId, userId)).orderBy(desc(seoSearchHistory.createdAt)),
      db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          targetType: auditLogs.targetType,
          targetId: auditLogs.targetId,
          workspaceId: auditLogs.workspaceId,
          projectId: auditLogs.projectId,
          ip: auditLogs.ip,
          meta: auditLogs.meta,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(eq(auditLogs.actorId, userId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(20_000),
      db
        .select({
          id: reports.id,
          title: reports.title,
          projectId: reports.projectId,
          shareEnabled: reports.shareEnabled,
          createdAt: reports.createdAt,
          updatedAt: reports.updatedAt,
        })
        .from(reports)
        .where(eq(reports.createdBy, userId)),
      db
        .select({ id: reportTemplates.id, name: reportTemplates.name, kind: reportTemplates.kind, workspaceId: reportTemplates.workspaceId, createdAt: reportTemplates.createdAt })
        .from(reportTemplates)
        .where(eq(reportTemplates.createdBy, userId)),
      // Invitations the user sent — without the invitees' addresses (third-party data).
      db
        .select({ id: invitations.id, workspaceId: invitations.workspaceId, roleKey: invitations.roleKey, status: invitations.status, createdAt: invitations.createdAt })
        .from(invitations)
        .where(eq(invitations.invitedBy, userId)),
      db
        .select({ id: optimizeTasks.id, title: optimizeTasks.title, projectId: optimizeTasks.projectId, createdAt: optimizeTasks.createdAt })
        .from(optimizeTasks)
        .where(or(eq(optimizeTasks.createdBy, userId), eq(optimizeTasks.assigneeId, userId))),
      db
        .select({
          provider: usageEvents.provider,
          feature: usageEvents.feature,
          endpoint: usageEvents.endpoint,
          costUsd: usageEvents.costUsd,
          projectId: usageEvents.projectId,
          createdAt: usageEvents.createdAt,
        })
        .from(usageEvents)
        .where(eq(usageEvents.userId, userId))
        .orderBy(desc(usageEvents.createdAt))
        .limit(20_000),
    ]);

  return {
    format: "autoseo.user-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
      status: user.status,
      isInstanceAdmin: user.isInstanceAdmin,
      preferences: user.preferences,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    memberships,
    projectAccess,
    sessions: sessionRows.map((s) => omitKeys(s, ["tokenHash"])),
    apiKeys: keyRows.map((k) => omitKeys(k, ["keyHash"])),
    connectedApps: grantRows.map((g) => ({ ...g.grant, clientName: g.clientName })),
    agents: agentRows,
    chats: chatRows.map((c) => ({
      ...c,
      messages: messageRows
        .filter((m) => m.chatId === c.id)
        .map((m) => ({ id: m.id, role: m.role, content: m.content, status: m.status, createdAt: m.createdAt })),
    })),
    chatAttachments: attachmentRows.map((a) => omitKeys(a, ["storageName"])),
    chatFeedback: chatFeedbackRows,
    bookmarks: bookmarkRows,
    notifications: notificationRows,
    feedback: feedbackRows,
    searchHistory: historyRows,
    auditLog: auditRows,
    reportsCreated: reportRows,
    reportTemplatesCreated: templateRows,
    invitationsSent: sentInvites,
    tasks: taskRows,
    usageEvents: usageRows,
  };
}

/** For "Delete my account" when ownership has to be handed over first. */
export async function listTransferCandidates(workspaceId: string, userId: string) {
  return db
    .select({ id: users.id, email: users.email, name: users.name, roleKey: workspaceMembers.roleKey })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), ne(workspaceMembers.userId, userId), eq(users.status, "active")))
    .orderBy(users.email);
}
