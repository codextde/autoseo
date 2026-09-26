import Link from "next/link";
import { Fingerprint, GitCommitHorizontal, Terminal } from "lucide-react";
import { requireAdmin } from "@/server/auth/guards";
import { getAdminSettings } from "@/server/admin/settings";
import { adminAgentOverview, listAgentsForUser } from "@/server/agents/queries";
import { agentHostUrl } from "@/server/agents/runtime";
import { Panel } from "@/components/app/page";
import { KpiStrip } from "@/components/app/metrics";
import { CopyButton } from "@/components/app/misc";
import { Button } from "@/components/ui/button";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { AdminAgentsSettings, type AgentsSettingsValues } from "@/features/agents/components/admin-agents-settings";
import { AgentsTable } from "@/features/agents/components/agents-table";

export const metadata = { title: "Local Agents · Admin" };

export default async function AdminAgentsPage() {
  const ctx = await requireAdmin();
  const [settings, agents, overview] = await Promise.all([getAdminSettings("agents"), listAgentsForUser(ctx, { all: true }), adminAgentOverview()]);
  const rt = overview.runtime;
  const host = agentHostUrl();
  const online = agents.filter((a) => a.status === "online" || a.status === "updating").length;
  const outdated = agents.filter((a) => a.outdated).length;

  return (
    <AdminPage
      title="Local agents"
      description="Instance-wide defaults for Claude Code / Codex agents, the current agent version and every agent on this instance."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/agents">
            <Terminal className="size-3.5" /> Manage my agents
          </Link>
        </Button>
      }
    >
      <KpiStrip
        items={[
          { key: "agents", label: "Agents", value: agents.length, sub: `${online} online` },
          { key: "outdated", label: "Outdated", value: outdated, sub: "not on the current version" },
          { key: "jobs", label: "Jobs · 24h", value: overview.jobs24h.total, sub: `${overview.jobs24h.succeeded} ok · ${overview.jobs24h.failed} failed` },
          { key: "queued", label: "Queued now", value: overview.jobs24h.queued, sub: "waiting for an agent" },
        ]}
      />

      <Panel title="Current agent version" icon={<GitCommitHorizontal className="size-4 text-muted-foreground" />} description="Every deploy is a new version; agents compare it at each check-in.">
        {rt ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Version</dt>
              <dd className="truncate font-mono">{rt.version}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Build commit</dt>
              <dd className="truncate font-mono">{rt.commit === "dev" ? "development (content hash)" : rt.commit}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Built</dt>
              <dd>{rt.builtAt ? new Date(rt.builtAt).toLocaleString() : "—"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                <Fingerprint className="size-3" /> SHA-256
              </dt>
              <dd className="flex items-center gap-1 font-mono text-xs">
                <span className="truncate">{rt.sha256.slice(0, 20)}…</span>
                <CopyButton value={rt.sha256} size="icon" className="size-6" />
              </dd>
            </div>
            <div className="min-w-0 sm:col-span-2 lg:col-span-4">
              <dt className="text-xs text-muted-foreground">Served from</dt>
              <dd className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                <span>{host}/install.sh</span>
                <span>{host}/install.ps1</span>
                <span>{host}/install/agent.mjs</span>
                <span>{host}/install/agent.sha256</span>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-destructive">The agent runtime file (agent/agent.mjs) is missing from this deployment.</p>
        )}
      </Panel>

      <AdminAgentsSettings initial={{ values: settings.values as AgentsSettingsValues, secrets: settings.secrets }} />

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold tracking-tight">All agents</h2>
        {agents.length ? (
          <AgentsTable agents={agents} showWorkspace />
        ) : (
          <Panel>
            <p className="py-6 text-center text-sm text-muted-foreground">
              No agents yet. Members with the “Install and manage local agents” permission add them under{" "}
              <Link href="/agents" className="font-medium text-foreground underline-offset-2 hover:underline">
                Local Agents
              </Link>
              .
            </p>
          </Panel>
        )}
      </section>
    </AdminPage>
  );
}
