import { requireAdmin } from "@/server/auth/guards";
import { getAdminSettings } from "@/server/admin/settings";
import { localAgentOnline } from "@/server/admin/provider-tests";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { getSetting } from "@/server/settings";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { AiSettings } from "@/features/admin/components/ai-settings";

export const metadata = { title: "AI Providers · Admin" };

export default async function AdminAiPage() {
  await requireAdmin();
  const [ai, engines, dfs, agentOnline, agents] = await Promise.all([
    getAdminSettings("ai"),
    getAdminSettings("engines"),
    isDataForSeoConfigured(),
    localAgentOnline(),
    getSetting("agents"),
  ]);
  return (
    <AdminPage
      title="AI Providers"
      description="Local agents first, API keys as fallback — plus which backend answers prompts for each AI engine."
    >
      <AiSettings ai={ai} engines={engines} dataForSeoConfigured={dfs} agentOnline={agentOnline} agentsEnabled={agents.enabled} />
    </AdminPage>
  );
}
