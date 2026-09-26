import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { listIntegrations, toPublicIntegration } from "@/server/integrations/store";
import { getGoogleConnectionState } from "@/server/integrations/service";
import { listGoogleAccounts } from "@/server/integrations/google/accounts";
import { IntegrationsView } from "@/features/integrations/components/integrations-view";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage({ params }: PageProps<"/p/[projectId]/integrations">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  // Connection states first: they migrate legacy single-account grants into workspace accounts.
  const canManage = ctx.permissions.has("settings.manage") || ctx.isInstanceAdmin;
  const [gsc, ga4] = await Promise.all([
    getGoogleConnectionState(ctx.project.id, "gsc", { includeAccounts: canManage }),
    getGoogleConnectionState(ctx.project.id, "ga4", { includeAccounts: canManage }),
  ]);
  const [rows, allAccounts] = await Promise.all([listIntegrations(ctx.project.id), listGoogleAccounts(ctx.project.workspaceId)]);
  // Members without integration rights only see the Google accounts they linked themselves.
  const googleAccounts = canManage ? allAccounts : allAccounts.filter((a) => a.connectedBy?.id === ctx.user.id);
  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Settings"
        title="Integrations"
        description={`Connect analytics, search, bot traffic, reporting, project management, attribution and CMS tools to ${ctx.project.name}.`}
      />
      <IntegrationsView
        projectId={ctx.project.id}
        rows={rows.map(toPublicIntegration)}
        google={{ google_search_console: gsc, google_analytics: ga4 }}
        googleAccounts={googleAccounts}
        currentUserId={ctx.user.id}
        canManage={canManage}
      />
    </PageContainer>
  );
}
