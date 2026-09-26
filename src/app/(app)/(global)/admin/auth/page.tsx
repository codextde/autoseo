import { asc } from "drizzle-orm";
import { requireAdmin } from "@/server/auth/guards";
import { db } from "@/server/db/client";
import { roles } from "@/server/db/schema";
import { getAdminSettings } from "@/server/admin/settings";
import { emailDomain } from "@/server/auth/domains";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { AuthSettings } from "@/features/admin/components/auth-settings";

export const metadata = { title: "Authentication · Admin" };

export default async function AdminAuthPage() {
  const ctx = await requireAdmin();
  const [auth, security, roleRows] = await Promise.all([
    getAdminSettings("auth"),
    getAdminSettings("security"),
    db.select({ key: roles.key, name: roles.name }).from(roles).orderBy(asc(roles.sortOrder), asc(roles.name)),
  ]);
  return (
    <AdminPage
      title="Authentication"
      description="Magic-link sign-in, invitation policy, domain allow-list and session lifetime."
    >
      <AuthSettings auth={auth} security={security} roles={roleRows} ownDomain={emailDomain(ctx.user.email)} />
    </AdminPage>
  );
}
