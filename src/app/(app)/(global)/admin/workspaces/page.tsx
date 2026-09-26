import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "@/server/auth/guards";
import { db } from "@/server/db/client";
import { roles, users } from "@/server/db/schema";
import { listProjectsAdmin, listWorkspacesAdmin } from "@/server/admin/workspaces";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { WorkspacesAdmin } from "@/features/admin/components/workspaces-admin";

export const metadata = { title: "Workspaces & Projects · Admin" };

export default async function AdminWorkspacesPage() {
  const ctx = await requireAdmin();
  const [workspaces, projects, userRows, [ownerRole]] = await Promise.all([
    listWorkspacesAdmin(),
    listProjectsAdmin(),
    db
      .select({ id: users.id, email: users.email, name: users.name, isInstanceAdmin: users.isInstanceAdmin })
      .from(users)
      .where(eq(users.status, "active"))
      .orderBy(asc(users.email)),
    db.select({ permissions: roles.permissions }).from(roles).where(eq(roles.key, "owner")).limit(1),
  ]);
  return (
    <AdminPage
      title="Workspaces & Projects"
      description="Workspaces group people and projects. Move projects between workspaces, archive them or manage pitch projects."
    >
      <WorkspacesAdmin
        currentUserId={ctx.user.id}
        users={userRows}
        ownerGrantsAdmin={Boolean(ownerRole?.permissions.includes("admin.access"))}
        workspaces={workspaces.map((w) => ({ ...w, createdAt: w.createdAt.toISOString() }))}
        projects={projects.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          pitchExpiresAt: p.pitchExpiresAt?.toISOString() ?? null,
        }))}
      />
    </AdminPage>
  );
}
