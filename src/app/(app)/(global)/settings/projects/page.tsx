import { PageContainer, PageHeader } from "@/components/app/page";
import { requireUser } from "@/server/auth/guards";
import { listVisibleProjects } from "@/server/admin/account";
import { ProjectsManager } from "@/features/settings/projects/projects-manager";

export const metadata = { title: "Projects" };

export default async function ProjectsSettingsPage() {
  const ctx = await requireUser();
  const projects = await listVisibleProjects(ctx);
  const canCreate = ctx.isInstanceAdmin || ctx.memberships.some((m) => m.permissions.has("projects.manage"));
  const workspaceCount = new Set(projects.map((p) => p.workspaceId)).size;

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="Manage projects" description="All websites you have access to, across your workspaces." />
      <ProjectsManager
        canCreate={canCreate}
        showWorkspace={workspaceCount > 1 || ctx.memberships.length > 1}
        projects={projects.map((p) => ({
          id: p.id,
          name: p.name,
          domain: p.domain,
          logoUrl: p.logoUrl,
          country: p.country,
          archived: p.archived,
          isPitch: p.isPitch,
          pitchExpiresAt: p.pitchExpiresAt?.toISOString() ?? null,
          createdAt: p.createdAt.toISOString(),
          workspaceName: p.workspaceName,
          canManage: p.canManage,
        }))}
      />
    </PageContainer>
  );
}
