import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projects, users, workspaceMembers, workspaces } from "@/server/db/schema";
import { createWorkspace } from "@/server/auth/membership";
import { logAudit } from "@/server/audit";
import { assertAdminsRemain, MemberError } from "./members";
import { projectCountsByWorkspace } from "./projects";

type Actor = { id: string; email: string };

export async function listWorkspacesAdmin() {
  const rows = await db.select().from(workspaces).orderBy(asc(workspaces.createdAt));
  const members = await db
    .select({ workspaceId: workspaceMembers.workspaceId, n: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .groupBy(workspaceMembers.workspaceId);
  const owners = await db
    .select({ workspaceId: workspaceMembers.workspaceId, email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.roleKey, "owner"));
  const memberCount = new Map(members.map((m) => [m.workspaceId, Number(m.n)]));
  const projectCounts = await projectCountsByWorkspace(rows.map((r) => r.id));
  return rows.map((w, i) => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    createdAt: w.createdAt,
    isDefault: i === 0,
    members: memberCount.get(w.id) ?? 0,
    owners: owners.filter((o) => o.workspaceId === w.id).map((o) => o.email),
    projects: projectCounts.get(w.id) ?? { active: 0, archived: 0 },
  }));
}

export async function listProjectsAdmin() {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      domain: projects.domain,
      logoUrl: projects.logoUrl,
      country: projects.country,
      workspaceId: projects.workspaceId,
      workspaceName: workspaces.name,
      archived: projects.archived,
      isPitch: projects.isPitch,
      pitchExpiresAt: projects.pitchExpiresAt,
      trackingFrequency: projects.trackingFrequency,
      createdAt: projects.createdAt,
      createdByEmail: users.email,
    })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .leftJoin(users, eq(users.id, projects.createdBy))
    .orderBy(desc(projects.createdAt));
}

export async function createWorkspaceAdmin(name: string, ownerUserId: string, actor: Actor) {
  const trimmed = name.trim();
  if (!trimmed) throw new MemberError("Name is required.");
  const [owner] = await db.select().from(users).where(eq(users.id, ownerUserId)).limit(1);
  if (!owner) throw new MemberError("Owner not found.");
  const ws = await createWorkspace(trimmed.slice(0, 80));
  await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: owner.id, roleKey: "owner" });
  void logAudit("workspace.created", { actor, targetType: "workspace", targetId: ws.id, workspaceId: ws.id, meta: { name: ws.name, owner: owner.email } });
  return ws;
}

export async function renameWorkspace(id: string, name: string, actor: Actor) {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) throw new MemberError("Name is required.");
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  if (!ws) throw new MemberError("Workspace not found.");
  await db.update(workspaces).set({ name: trimmed }).where(eq(workspaces.id, id));
  void logAudit("workspace.renamed", { actor, targetType: "workspace", targetId: id, workspaceId: id, meta: { from: ws.name, to: trimmed } });
}

/** Deletes a workspace with all its projects and memberships. The oldest (default) workspace can't be deleted. */
export async function deleteWorkspaceAdmin(id: string, confirmName: string, actor: Actor) {
  const all = await db.select().from(workspaces).orderBy(asc(workspaces.createdAt));
  const ws = all.find((w) => w.id === id);
  if (!ws) throw new MemberError("Workspace not found.");
  if (all[0]?.id === id) throw new MemberError("The default workspace can't be deleted (new self sign-ups join it).");
  if (confirmName.trim() !== ws.name) throw new MemberError("Type the workspace name to confirm.");
  const counts = (await projectCountsByWorkspace([id])).get(id) ?? { active: 0, archived: 0 };
  await db.transaction(async (tx) => {
    await tx.delete(workspaces).where(eq(workspaces.id, id));
    await assertAdminsRemain(tx);
  });
  void logAudit("workspace.deleted", {
    actor,
    targetType: "workspace",
    targetId: id,
    meta: { name: ws.name, projects: counts.active + counts.archived },
  });
}
