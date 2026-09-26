import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { invitations, roles, workspaceMembers } from "@/server/db/schema";
import { ALL_PERMISSIONS, BUILTIN_ROLES, type Permission } from "@/server/auth/permissions";
import { getSetting } from "@/server/settings";
import { logAudit } from "@/server/audit";
import { OWNER_LOCKED } from "@/features/admin/roles-shared";
import { assertAdminsRemain, MemberError } from "./members";

type Actor = { id: string; email: string };

export { OWNER_LOCKED };

export async function listRolesWithCounts() {
  const rows = await db.select().from(roles).orderBy(asc(roles.sortOrder), asc(roles.createdAt));
  const counts = await db
    .select({ roleKey: workspaceMembers.roleKey, n: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .groupBy(workspaceMembers.roleKey);
  const byKey = new Map(counts.map((c) => [c.roleKey, Number(c.n)]));
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    description: r.description,
    permissions: r.permissions.filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p)),
    allProjects: r.allProjects,
    builtin: r.builtin,
    sortOrder: r.sortOrder,
    members: byKey.get(r.key) ?? 0,
  }));
}

function slugKey(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "_")
      .slice(0, 40) || "role"
  );
}

function cleanPermissions(list: string[]): Permission[] {
  return [...new Set(list)].filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
}

export async function createRole(
  input: { name: string; description?: string | null; permissions: string[]; allProjects: boolean },
  actor: Actor,
) {
  const name = input.name.trim();
  if (!name) throw new MemberError("Name is required.");
  let key = slugKey(name);
  const existing = new Set((await db.select({ key: roles.key }).from(roles)).map((r) => r.key));
  if (existing.has(key)) {
    let i = 2;
    while (existing.has(`${key}_${i}`)) i++;
    key = `${key}_${i}`;
  }
  const [maxRow] = await db.select({ m: sql<number>`coalesce(max(${roles.sortOrder}), 100)::int` }).from(roles);
  const [row] = await db
    .insert(roles)
    .values({
      key,
      name,
      description: input.description?.trim() || null,
      permissions: cleanPermissions(input.permissions),
      allProjects: input.allProjects,
      builtin: false,
      sortOrder: Math.max(100, Number(maxRow?.m ?? 100)) + 10,
    })
    .returning();
  void logAudit("role.created", { actor, targetType: "role", targetId: key, meta: { name, permissions: row!.permissions } });
  return row!;
}

export type RoleUpdate = { key: string; name?: string; description?: string | null; permissions?: string[]; allProjects?: boolean };

/** Applies several role edits atomically (matrix save). Rolls back if no admin would remain. */
export async function updateRoles(updates: RoleUpdate[], actor: Actor) {
  if (!updates.length) return;
  const current = new Map((await db.select().from(roles)).map((r) => [r.key, r]));
  await db.transaction(async (tx) => {
    for (const u of updates) {
      const role = current.get(u.key);
      if (!role) throw new MemberError(`Role "${u.key}" no longer exists.`);
      const set: Partial<typeof roles.$inferInsert> = {};
      if (u.name !== undefined) {
        if (!u.name.trim()) throw new MemberError("Role names can't be empty.");
        set.name = u.name.trim().slice(0, 60);
      }
      if (u.description !== undefined) set.description = u.description?.trim().slice(0, 300) || null;
      if (u.permissions !== undefined) {
        let perms = cleanPermissions(u.permissions);
        if (role.key === "owner") perms = [...new Set([...perms, ...OWNER_LOCKED])];
        set.permissions = perms;
      }
      if (u.allProjects !== undefined) set.allProjects = role.key === "owner" ? true : u.allProjects;
      if (Object.keys(set).length) await tx.update(roles).set(set).where(eq(roles.key, u.key));
    }
    await assertAdminsRemain(tx);
  });
  for (const u of updates) {
    const before = current.get(u.key)!;
    const added = u.permissions ? u.permissions.filter((p) => !before.permissions.includes(p)) : [];
    const removed = u.permissions ? before.permissions.filter((p) => !u.permissions!.includes(p)) : [];
    void logAudit("role.updated", {
      actor,
      targetType: "role",
      targetId: u.key,
      meta: {
        ...(u.name !== undefined && u.name !== before.name ? { name: { from: before.name, to: u.name } } : {}),
        ...(u.allProjects !== undefined && u.allProjects !== before.allProjects ? { allProjects: u.allProjects } : {}),
        ...(added.length ? { added } : {}),
        ...(removed.length ? { removed } : {}),
      },
    });
  }
}

export async function resetBuiltinRole(key: string, actor: Actor) {
  const def = BUILTIN_ROLES.find((r) => r.key === key);
  if (!def) throw new MemberError("Only built-in roles can be reset.");
  await db.transaction(async (tx) => {
    await tx
      .update(roles)
      .set({ name: def.name, description: def.description, permissions: def.permissions, allProjects: def.allProjects, builtin: true })
      .where(eq(roles.key, key));
    await assertAdminsRemain(tx);
  });
  void logAudit("role.reset", { actor, targetType: "role", targetId: key });
}

/** Deletes a custom role; members and pending invitations move to `reassignTo`. */
export async function deleteRole(key: string, reassignTo: string, actor: Actor) {
  const [role] = await db.select().from(roles).where(eq(roles.key, key)).limit(1);
  if (!role) throw new MemberError("Role not found.");
  if (role.builtin) throw new MemberError("Built-in roles can't be deleted (you can reset them instead).");
  if (reassignTo === key) throw new MemberError("Choose a different role for existing members.");
  const [target] = await db.select().from(roles).where(eq(roles.key, reassignTo)).limit(1);
  if (!target) throw new MemberError("The replacement role does not exist.");
  const auth = await getSetting("auth");
  if (auth.defaultRoleKey === key) throw new MemberError("This role is the default for self sign-ups. Pick another default in Admin → Authentication first.");
  let moved = 0;
  await db.transaction(async (tx) => {
    const res = await tx.update(workspaceMembers).set({ roleKey: reassignTo }).where(eq(workspaceMembers.roleKey, key)).returning();
    moved = res.length;
    await tx.update(invitations).set({ roleKey: reassignTo }).where(eq(invitations.roleKey, key));
    await tx.delete(roles).where(eq(roles.key, key));
    await assertAdminsRemain(tx);
  });
  void logAudit("role.deleted", { actor, targetType: "role", targetId: key, meta: { name: role.name, reassignedTo: reassignTo, moved } });
}
