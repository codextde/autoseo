import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projects, roles, workspaces } from "@/server/db/schema";
import { getSetting } from "@/server/settings";

/** Data the admin invite dialog needs (workspaces, roles, projects, domain policy). */
export async function getAdminInviteContext() {
  const [wsRows, roleRows, projectRows, auth] = await Promise.all([
    db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).orderBy(asc(workspaces.name)),
    db.select().from(roles).orderBy(asc(roles.sortOrder), asc(roles.name)),
    db
      .select({ id: projects.id, name: projects.name, domain: projects.domain, workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.archived, false))
      .orderBy(asc(projects.name)),
    getSetting("auth"),
  ]);
  return {
    workspaces: wsRows,
    roles: roleRows.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      allProjects: r.allProjects || r.permissions.includes("projects.all"),
      grantsAdmin: r.permissions.includes("admin.access"),
    })),
    projects: projectRows,
    allowedDomains: auth.allowedDomains,
    defaultRoleKey: auth.defaultRoleKey,
    inviteDays: auth.inviteDays,
  };
}
