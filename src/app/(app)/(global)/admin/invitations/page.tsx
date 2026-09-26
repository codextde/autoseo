import { requireAdmin } from "@/server/auth/guards";
import { listInvitations } from "@/server/admin/members";
import { getAdminInviteContext } from "@/server/admin/invite-context";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { InvitationsTable } from "@/features/admin/components/invitations-table";

export const metadata = { title: "Invitations · Admin" };

export default async function AdminInvitationsPage() {
  await requireAdmin();
  const [items, context] = await Promise.all([listInvitations(), getAdminInviteContext()]);
  return (
    <AdminPage
      title="Invitations"
      description="Only invited people can sign in. Invite by email in bulk, with a role, project access and an optional admin flag."
    >
      <InvitationsTable
        context={context}
        items={items.map((i) => ({
          id: i.id,
          email: i.email,
          workspaceId: i.workspaceId,
          workspaceName: i.workspaceName,
          roleKey: i.roleKey,
          projectIds: i.projectIds,
          makeInstanceAdmin: i.makeInstanceAdmin,
          status: i.status,
          expiresAt: i.expiresAt.toISOString(),
          lastSentAt: i.lastSentAt?.toISOString() ?? null,
          acceptedAt: i.acceptedAt?.toISOString() ?? null,
          createdAt: i.createdAt.toISOString(),
          invitedByEmail: i.invitedByEmail,
        }))}
      />
    </AdminPage>
  );
}
