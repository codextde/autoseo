import { requireUser } from "@/server/auth/guards";
import { getAccessibleProjects } from "@/server/auth/context";
import { getBranding } from "@/server/branding";
import { getSetting } from "@/server/settings";
import { getApiUsage, listApiKeys, listOAuthGrants } from "@/server/api/keys";
import { apiUrls } from "@/server/api/urls";
import { toolCatalog } from "@/server/mcp/server";
import { listSkills, SKILL_GROUP_LABELS, urlMarketplaceSupported } from "@/server/api/plugin";
import { pluginUrls } from "@/features/api-settings/setup-content";
import { ApiSettingsView } from "@/features/api-settings/components/api-settings-view";

export const metadata = { title: "API & MCP" };

export default async function ApiSettingsPage({ searchParams }: PageProps<"/settings/api">) {
  const ctx = await requireUser();
  const sp = await searchParams;
  const requested = typeof sp.workspace === "string" ? sp.workspace : null;
  const projects = await getAccessibleProjects();
  const lastProject = projects.find((p) => p.id === ctx.user.lastProjectId);
  const membership =
    ctx.memberships.find((m) => m.workspace.id === requested) ??
    ctx.memberships.find((m) => m.workspace.id === lastProject?.workspaceId) ??
    ctx.memberships[0];

  const [brand, security] = await Promise.all([getBranding(), getSetting("security")]);
  const urls = { origin: apiUrls.base, mcp: apiUrls.mcp, rest: apiUrls.rest, openapi: "/api/v1/openapi.json", docs: "/settings/api/docs" };
  const tab = sp.tab === "agents" || sp.tab === "skills" ? sp.tab : "overview";
  const allSkills = listSkills();
  const skills =
    tab === "skills"
      ? allSkills.map((s) => ({ slug: s.slug, title: s.title, description: s.description, group: s.group, groupLabel: SKILL_GROUP_LABELS[s.group], body: s.body, bytes: s.bytes }))
      : null;
  const plugin = pluginUrls(apiUrls.base, urlMarketplaceSupported(apiUrls.base));
  const shared = { tab, skills, plugin, skillCount: allSkills.length } as const;
  const toolGroups = toolCatalog().map((g) => ({
    id: g.id,
    label: g.label,
    tools: g.tools.map((t) => ({ name: t.name, title: t.title ?? t.name, scope: t.scope, paid: t.spend })),
  }));

  if (!membership) {
    return (
      <ApiSettingsView
        appName={brand.appName}
        workspaces={[]}
        workspaceId=""
        canManage={false}
        currentUserId={ctx.user.id}
        keys={[]}
        grants={[]}
        usage={null}
        projects={[]}
        rateLimit={security.apiRateLimitPerMinute}
        urls={urls}
        toolGroups={toolGroups}
        {...shared}
      />
    );
  }

  const workspaceId = membership.workspace.id;
  const canManage = membership.permissions.has("settings.manage");
  const [keys, grants, usage] = await Promise.all([
    canManage ? listApiKeys(workspaceId) : Promise.resolve([]),
    listOAuthGrants(workspaceId, canManage ? undefined : ctx.user.id),
    canManage ? getApiUsage(workspaceId) : Promise.resolve(null),
  ]);

  return (
    <ApiSettingsView
      appName={brand.appName}
      workspaces={ctx.memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name }))}
      workspaceId={workspaceId}
      canManage={canManage}
      currentUserId={ctx.user.id}
      keys={keys}
      grants={grants}
      usage={usage}
      projects={projects.filter((p) => p.workspaceId === workspaceId).map((p) => ({ id: p.id, name: p.name, domain: p.domain }))}
      rateLimit={security.apiRateLimitPerMinute}
      urls={urls}
      toolGroups={toolGroups}
      {...shared}
    />
  );
}
