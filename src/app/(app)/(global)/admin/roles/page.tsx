import { Info } from "lucide-react";
import { requireAdmin } from "@/server/auth/guards";
import { listRolesWithCounts } from "@/server/admin/roles";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { RolesEditor } from "@/features/admin/components/roles-editor";

export const metadata = { title: "Roles & Permissions · Admin" };

export default async function AdminRolesPage() {
  await requireAdmin();
  const roles = await listRolesWithCounts();
  return (
    <AdminPage
      title="Roles & Permissions"
      description="Roles are sets of permissions. Every workspace member has one role; instance admins additionally manage this panel."
    >
      <div className="flex items-start gap-2.5 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground shadow-soft">
        <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
        <p>
          Built-in roles can be edited and reset to their defaults. The Owner role always keeps workspace and member management,
          and changes that would leave the instance without any administrator are rejected.
        </p>
      </div>
      <RolesEditor initialRoles={roles} />
    </AdminPage>
  );
}
