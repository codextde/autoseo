import Link from "next/link";
import { asc } from "drizzle-orm";
import { MailPlus } from "lucide-react";
import { requireAdmin } from "@/server/auth/guards";
import { db } from "@/server/db/client";
import { roles, workspaces } from "@/server/db/schema";
import { listAdminUsers } from "@/server/admin/users";
import { Button } from "@/components/ui/button";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { UsersTable } from "@/features/admin/components/users-table";

export const metadata = { title: "Users · Admin" };

export default async function AdminUsersPage() {
  const ctx = await requireAdmin();
  const [users, roleRows, wsRows] = await Promise.all([
    listAdminUsers(),
    db.select().from(roles).orderBy(asc(roles.sortOrder), asc(roles.name)),
    db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).orderBy(asc(workspaces.name)),
  ]);
  return (
    <AdminPage
      title="Users"
      description="Everyone who can sign in to this instance. Open a user to change their access, workspaces, projects and devices."
      actions={
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/admin/invitations?new=1">
            <MailPlus className="size-3.5" /> Invite people
          </Link>
        </Button>
      }
    >
      <UsersTable
        currentUserId={ctx.user.id}
        users={users.map((u) => ({
          ...u,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        }))}
        roles={roleRows.map((r) => ({
          key: r.key,
          name: r.name,
          allProjects: r.allProjects || r.permissions.includes("projects.all"),
        }))}
        workspaces={wsRows}
      />
    </AdminPage>
  );
}
