"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { BookOpen, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageContainer, PageHeader, TabNav } from "@/components/app/page";
import type { PluginUrls } from "../setup-content";
import type { ApiKeyView, ApiUsage, OAuthGrantView } from "../types";
import type { PickerProject } from "./access-picker";
import { AgentSetupPanel } from "./agent-setup-panel";
import { ConnectedAppsPanel } from "./connected-apps-panel";
import { KeysPanel } from "./keys-panel";
import { McpPanel, type McpToolGroup } from "./mcp-panel";
import { SkillsCatalog, type SkillView } from "./skills-catalog";
import { UsagePanel } from "./usage-panel";

export type ApiSettingsProps = {
  appName: string;
  workspaces: { id: string; name: string }[];
  workspaceId: string;
  canManage: boolean;
  currentUserId: string;
  keys: ApiKeyView[];
  grants: OAuthGrantView[];
  usage: ApiUsage | null;
  projects: PickerProject[];
  rateLimit: number;
  urls: { origin: string; mcp: string; rest: string; openapi: string; docs: string };
  toolGroups: McpToolGroup[];
  tab: "overview" | "agents" | "skills";
  plugin: PluginUrls;
  skillCount: number;
  /** Only loaded for the Skills tab. */
  skills: SkillView[] | null;
};

const fade = (i: number) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, delay: i * 0.05 } });

export function ApiSettingsView(p: ApiSettingsProps) {
  const router = useRouter();
  const tabHref = (tab: string) => {
    const q = new URLSearchParams();
    if (tab !== "overview") q.set("tab", tab);
    if (p.workspaces.length > 1 && p.workspaceId) q.set("workspace", p.workspaceId);
    const qs = q.toString();
    return qs ? `/settings/api?${qs}` : "/settings/api";
  };
  return (
    <PageContainer>
      <PageHeader
        title="API & MCP"
        description="Connect AI assistants, BI tools and your own scripts to your AI visibility data — via the REST API or the MCP server."
        actions={
          <>
            {p.workspaces.length > 1 && (
              <Select value={p.workspaceId} onValueChange={(v) => router.push(`/settings/api?workspace=${encodeURIComponent(v)}`)}>
                <SelectTrigger className="h-8 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {p.workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" asChild>
              <a href={p.urls.openapi} target="_blank" rel="noopener noreferrer">
                <FileJson className="size-3.5" /> OpenAPI
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={p.urls.docs}>
                <BookOpen className="size-3.5" /> Docs
              </Link>
            </Button>
          </>
        }
      />

      <TabNav
        active={p.tab}
        tabs={[
          { key: "overview", label: "API & MCP", href: tabHref("overview") },
          { key: "agents", label: "Agent setup", href: tabHref("agents") },
          {
            key: "skills",
            label: "Skills",
            href: tabHref("skills"),
            badge: <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground tabular">{p.skillCount}</span>,
          },
        ]}
      />

      {p.tab === "overview" && (
        <>
          <motion.div {...fade(0)}>
            <KeysPanel keys={p.keys} canManage={p.canManage} workspaceId={p.workspaceId} projects={p.projects} restUrl={p.urls.rest} mcpUrl={p.urls.mcp} />
          </motion.div>

          <div className="grid gap-4 sm:gap-5 lg:grid-cols-5">
            <motion.div {...fade(1)} className={p.usage ? "min-w-0 lg:col-span-3" : "min-w-0 lg:col-span-5"}>
              <McpPanel mcpUrl={p.urls.mcp} docsUrl={p.urls.docs} toolGroups={p.toolGroups} />
            </motion.div>
            {p.usage && (
              <motion.div {...fade(2)} className="min-w-0 lg:col-span-2">
                <UsagePanel usage={p.usage} rateLimit={p.rateLimit} />
              </motion.div>
            )}
          </div>

          <motion.div {...fade(3)}>
            <ConnectedAppsPanel grants={p.grants} workspaceId={p.workspaceId} showUser={p.canManage} currentUserId={p.currentUserId} canManage={p.canManage} />
          </motion.div>
        </>
      )}

      {p.tab === "agents" && (
        <motion.div {...fade(0)}>
          <AgentSetupPanel urls={p.plugin} appName={p.appName} skillCount={p.skillCount} />
        </motion.div>
      )}

      {p.tab === "skills" && (
        <motion.div {...fade(0)}>
          <SkillsCatalog skills={p.skills ?? []} downloads={{ skillsZip: p.plugin.skillsZip, pluginZip: p.plugin.pluginZip }} />
        </motion.div>
      )}
    </PageContainer>
  );
}
