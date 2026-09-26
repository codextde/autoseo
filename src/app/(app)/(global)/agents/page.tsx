import { forbidden } from "next/navigation";
import { Cpu, KeyRound, RefreshCw, ShieldCheck, Terminal, Zap } from "lucide-react";
import { requireUser } from "@/server/auth/guards";
import { getAccessibleProjects } from "@/server/auth/context";
import { db } from "@/server/db/client";
import { workspaces as workspacesTable } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { listAgentsForUser } from "@/server/agents/queries";
import { manageableWorkspaceIds } from "@/server/agents/service";
import { PageContainer, PageHeader, Panel } from "@/components/app/page";
import { KpiStrip } from "@/components/app/metrics";
import { AgentOrb } from "@/components/agent-ui";
import { AgentsTable } from "@/features/agents/components/agents-table";
import { CreateAgentButton } from "@/features/agents/components/create-agent-dialog";

export const metadata = { title: "Local Agents" };

const STEPS = [
  {
    icon: Terminal,
    title: "Install with one command",
    text: "Run the one-liner on any Mac, Linux or Windows machine that has Claude Code or Codex. It sets up autostart and verifies the download.",
  },
  {
    icon: Zap,
    title: "AI work runs locally",
    text: "Prompt analysis, extraction and web research run as fresh CLI sessions on that machine — using your subscription and MCP servers.",
  },
  {
    icon: ShieldCheck,
    title: "Outbound only",
    text: "The agent polls this server over HTTPS. No open ports, token stored as SHA-256, self-updates on every deploy.",
  },
];

export default async function AgentsPage() {
  const ctx = await requireUser();
  const wsIds = manageableWorkspaceIds(ctx);
  if (!wsIds.length && !ctx.isInstanceAdmin) forbidden();

  const [agents, settings, projects] = await Promise.all([listAgentsForUser(ctx), getSetting("agents"), getAccessibleProjects()]);
  const lastProject = projects.find((p) => p.id === ctx.user.lastProjectId);
  let workspaces = ctx.memberships.filter((m) => wsIds.includes(m.workspace.id)).map((m) => ({ id: m.workspace.id, name: m.workspace.name }));
  if (ctx.isInstanceAdmin && !workspaces.length) {
    workspaces = (await db.select({ id: workspacesTable.id, name: workspacesTable.name }).from(workspacesTable)).slice(0, 200);
  }
  const defaultWorkspaceId = workspaces.find((w) => w.id === lastProject?.workspaceId)?.id ?? workspaces[0]?.id ?? null;
  const online = agents.filter((a) => a.status === "online" || a.status === "updating").length;
  const busy = agents.filter((a) => a.runningJobs > 0).length;
  const outdated = agents.filter((a) => a.outdated).length;
  const running = agents.reduce((n, a) => n + a.runningJobs, 0);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Settings"
        title="Local agents"
        description="Run AutoSEO's AI features with Claude Code or Codex on your own machines — API keys are only a fallback."
        actions={<CreateAgentButton workspaces={workspaces} defaultWorkspaceId={defaultWorkspaceId} />}
      />

      {!settings.enabled && (
        <div className="rounded-2xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm">
          Local agents are disabled instance-wide. Agents keep checking in but receive no AI work until an admin enables them in{" "}
          <span className="font-medium">Admin → Local Agents</span>.
        </div>
      )}

      {agents.length === 0 ? (
        <Panel contentClassName="p-0">
          <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
              <AgentOrb size={96} state="idle" />
              <h2 className="mt-5 text-xl font-semibold tracking-tight">Connect your first local agent</h2>
              <p className="mt-2 max-w-md text-sm text-balance text-muted-foreground">
                A tiny background service that lets AutoSEO use the Claude Code or Codex CLI already installed on your computer or a server. Needs Node.js 20+.
              </p>
              <div className="mt-5">
                <CreateAgentButton workspaces={workspaces} defaultWorkspaceId={defaultWorkspaceId} />
              </div>
            </div>
            <ol className="space-y-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-3 rounded-xl border bg-muted/30 p-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
                    <s.icon className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">
                      <span className="mr-1.5 text-muted-foreground tabular">{i + 1}.</span>
                      {s.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Panel>
      ) : (
        <>
          <KpiStrip
            items={[
              { key: "total", label: "Agents", value: agents.length, sub: `${agents.filter((a) => a.status === "pending").length} awaiting install` },
              { key: "online", label: "Online", value: online, sub: `${agents.length - online} offline / paused` },
              { key: "busy", label: "Running jobs", value: running, sub: `${busy} busy agent${busy === 1 ? "" : "s"}` },
              {
                key: "outdated",
                label: "Updates pending",
                value: outdated,
                sub: settings.allowAutoUpdate ? "auto-update on" : "auto-update off",
                hint: "Agents running an older version than this deploy. They update themselves on the next check-in unless auto-update is off.",
              },
            ]}
          />
          <AgentsTable agents={agents} showWorkspace={new Set(agents.map((a) => a.workspaceId)).size > 1} />
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: RefreshCw, text: "Agents self-update after each deploy (SHA-256 verified) unless --no-auto-update is set." },
              { icon: KeyRound, text: "Tokens never expire. Lost one? Reinstall issues a new token and revokes the old one." },
              { icon: Cpu, text: "Each job is a fresh CLI session in its own folder; old folders are cleaned up automatically." },
            ].map((t) => (
              <div key={t.text} className="flex items-start gap-2.5 rounded-xl border bg-card/60 p-3 text-xs text-muted-foreground">
                <t.icon className="mt-px size-3.5 shrink-0" />
                {t.text}
              </div>
            ))}
          </div>
        </>
      )}
    </PageContainer>
  );
}
