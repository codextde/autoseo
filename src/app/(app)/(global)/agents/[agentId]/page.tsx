import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/server/auth/guards";
import { getSetting } from "@/server/settings";
import { getManageableAgent } from "@/server/agents/service";
import {
  agentJobHistogram,
  agentJobStats,
  getAgentView,
  listAgentEvents,
  listAgentJobs,
  listCheckinHistory,
} from "@/server/agents/queries";
import { PageContainer, Panel, TabNav } from "@/components/app/page";
import { AgentOrb } from "@/components/agent-ui";
import { Badge } from "@/components/ui/badge";
import { AgentActions } from "@/features/agents/components/agent-actions";
import { AgentActivity } from "@/features/agents/components/agent-activity";
import { AgentJobsTable, JobDrawer } from "@/features/agents/components/agent-jobs";
import { AgentStatusChip } from "@/features/agents/components/agent-meta";
import { STATUS_META } from "@/features/agents/status";
import { AgentOverview } from "@/features/agents/components/agent-overview";
import { AgentSettingsForm } from "@/features/agents/components/agent-settings-form";
import { AutoRefresh, LiveTerminalPanel } from "@/features/agents/components/agent-detail-client";
import { PageCrumb } from "@/components/app/page-crumb";

const TABS = ["overview", "terminal", "jobs", "activity", "settings"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: PageProps<"/agents/[agentId]">) {
  const { agentId } = await params;
  // Only the name of an agent the viewer may manage; anything else gets the generic title.
  const ctx = await requireUser();
  const agent = await getManageableAgent(ctx, agentId).catch(() => null);
  return { title: `${agent?.name ?? "Agent"} · Local Agents` };
}

export default async function AgentDetailPage({ params, searchParams }: PageProps<"/agents/[agentId]">) {
  const ctx = await requireUser();
  const { agentId } = await params;
  const sp = await searchParams;
  const agent = await getManageableAgent(ctx, agentId);
  if (!agent) notFound();
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "overview";

  const [view, stats] = await Promise.all([getAgentView(agent), agentJobStats(agent.id)]);
  const base = `/agents/${agent.id}`;

  let content: React.ReactNode = null;
  if (tab === "overview") {
    const [histogram, recentJobs, recentEvents, history] = await Promise.all([
      agentJobHistogram(agent.id),
      listAgentJobs(agent.id, { limit: 8 }),
      listAgentEvents(agent.id, { limit: 10 }),
      listCheckinHistory(agent.id, 20),
    ]);
    content = <AgentOverview agent={view} stats={stats} histogram={histogram} recentJobs={recentJobs} recentEvents={recentEvents} history={history} />;
  } else if (tab === "terminal") {
    content = (
      <Panel contentClassName="p-3 sm:p-4">
        <LiveTerminalPanel agentId={agent.id} />
      </Panel>
    );
  } else if (tab === "jobs") {
    const jobs = await listAgentJobs(agent.id, { limit: 500 });
    content = (
      <>
        <AutoRefresh ms={8_000} />
        <AgentJobsTable jobs={jobs} />
      </>
    );
  } else if (tab === "activity") {
    const events = await listAgentEvents(agent.id, { limit: 500 });
    content = (
      <Panel>
        <AutoRefresh ms={15_000} />
        <AgentActivity events={events} />
      </Panel>
    );
  } else {
    const settings = await getSetting("agents");
    content = (
      <AgentSettingsForm
        key={view.id}
        agent={view}
        isAdmin={ctx.isInstanceAdmin}
        globalDefaults={{ maxParallel: settings.defaultMaxParallelJobs, workDir: settings.defaultWorkDir, allowAutoUpdate: settings.allowAutoUpdate }}
      />
    );
  }

  return (
    <PageContainer>
      <div className="space-y-3">
        <Link href="/agents" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3.5" /> Local agents
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <AgentOrb size={52} state={view.status === "online" && view.runningJobs > 0 ? "working" : STATUS_META[view.status].orb} />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <PageCrumb label={view.name} />
                <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{view.name}</h1>
                <AgentStatusChip status={view.status} busy={view.runningJobs > 0} />
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{view.hostname ?? "Not installed yet"}</span>
                {view.workspaceName && <span>· {view.workspaceName}</span>}
                {view.labels.map((l) => (
                  <Badge key={l} variant="outline" className="h-4 px-1 text-[10px] font-normal">
                    {l}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <AgentActions agent={view} />
        </div>
      </div>

      <TabNav
        active={tab}
        tabs={TABS.map((t) => ({
          key: t,
          href: t === "overview" ? base : `${base}?tab=${t}`,
          label: { overview: "Overview", terminal: "Live terminal", jobs: "Jobs", activity: "Activity", settings: "Settings" }[t],
          badge:
            t === "jobs" && stats.running ? (
              <span className="ml-1.5 rounded-full bg-info/15 px-1.5 text-[10px] font-medium text-info tabular">{stats.running}</span>
            ) : undefined,
        }))}
      />

      {content}
      <JobDrawer agentId={agent.id} />
    </PageContainer>
  );
}
