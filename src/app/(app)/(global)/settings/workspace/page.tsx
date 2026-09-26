import { forbidden } from "next/navigation";
import { Building2 } from "lucide-react";
import { PageContainer, PageHeader, Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import { requireUser } from "@/server/auth/guards";
import { hasAllProjects, reachableProjectIds, workspaceAccess } from "@/server/admin/access";
import type { Permission } from "@/server/auth/permissions";
import { loadWorkspaceView } from "@/features/settings/workspace/queries";
import { MembersPanel } from "@/features/settings/workspace/members-panel";
import { InvitationsPanel } from "@/features/settings/workspace/invitations-panel";
import { SharingPanel } from "@/features/settings/workspace/sharing-panel";
import { RolesMatrix } from "@/features/settings/workspace/roles-matrix";
import { WorkspaceSwitcher } from "@/features/settings/workspace/workspace-switcher";

export const metadata = { title: "Workspace" };

export default async function WorkspaceSettingsPage({ searchParams }: PageProps<"/settings/workspace">) {
  const ctx = await requireUser();
  const sp = await searchParams;
  const wsParam = typeof sp.ws === "string" ? sp.ws : null;

  if (ctx.memberships.length === 0) {
    return (
      <PageContainer className="max-w-5xl">
        <PageHeader title="Workspace" />
        <Panel>
          <EmptyState
            icon={Building2}
            title="You're not a member of any workspace"
            description={
              ctx.isInstanceAdmin
                ? "Create or join a workspace in Admin → Workspaces & Projects."
                : "Ask your administrator to invite you to a workspace."
            }
            action={ctx.isInstanceAdmin ? { label: "Open admin", href: "/admin/workspaces" } : undefined}
          />
        </Panel>
      </PageContainer>
    );
  }

  const membership = ctx.memberships.find((m) => m.workspace.id === wsParam) ?? ctx.memberships[0]!;
  const can = (p: Permission) => ctx.isInstanceAdmin || membership.permissions.has(p);
  if (!can("team.view")) forbidden();

  const access = (await workspaceAccess(ctx, membership.workspace.id))!;
  const canManage = can("members.manage");
  const allProjects = hasAllProjects(access);
  const view = await loadWorkspaceView(membership.workspace.id, { reach: await reachableProjectIds(access), canManage });
  const assignable = view.roles
    .filter(
      (r) =>
        ctx.isInstanceAdmin ||
        (r.permissions.every((p) => membership.permissions.has(p as Permission)) &&
          (allProjects || !(r.allProjects || r.permissions.includes("projects.all")))),
    )
    .map((r) => r.key);
  const pendingCount = view.invitations.filter((i) => i.status === "pending").length;

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        title="Workspace"
        description={
          <>
            Manage who can access <span className="font-medium text-foreground">{membership.workspace.name}</span>, what they
            can do and which projects they see.
          </>
        }
        actions={
          <WorkspaceSwitcher
            current={membership.workspace.id}
            workspaces={ctx.memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, roleName: m.roleName }))}
          />
        }
      />
      <MembersPanel
        view={view}
        workspace={{ id: membership.workspace.id, name: membership.workspace.name }}
        canManage={canManage}
        currentUserId={ctx.user.id}
        assignable={assignable}
        pendingCount={pendingCount}
      />
      {(canManage || view.invitations.length > 0) && (
        <InvitationsPanel view={view} workspaceId={membership.workspace.id} canManage={canManage} canCopyLinks={ctx.isInstanceAdmin} />
      )}
      <SharingPanel view={view} workspaceId={membership.workspace.id} canManage={canManage} />
      <RolesMatrix roles={view.roles} currentRoleKey={membership.roleKey} isAdmin={ctx.isInstanceAdmin} />
    </PageContainer>
  );
}
