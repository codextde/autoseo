"use client";

import { useState } from "react";
import { Cpu, History, Radio, ScrollText, Server } from "lucide-react";
import { AgentOrb } from "@/components/agent-ui";
import { BarsChart } from "@/components/app/charts";
import { Panel } from "@/components/app/page";
import { TimeAgo, CopyButton } from "@/components/app/misc";
import { KpiStrip } from "@/components/app/metrics";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentEventView, AgentJobStats, AgentJobView, AgentView, CheckinHistoryView } from "@/server/agents/queries";
import { ActivityList } from "./agent-activity";
import { AgentJobsTable } from "./agent-jobs";
import { AgentStatusChip, CLI_MODE_LABEL, STATUS_META, formatBytes, formatMs, osLabel, runtimeLabel, useAutoRefresh, type AgentStatusValue } from "./agent-meta";
import { CliVersions } from "./agents-table";
import { LiveTerminal, type LiveStatusPayload } from "./live-terminal";
import { useUrlState } from "@/hooks/use-url-state";

export function AgentKpis({ agent, stats }: { agent: AgentView; stats: AgentJobStats }) {
  const done = stats.succeeded24h + stats.failed24h;
  return (
    <KpiStrip
      items={[
        { key: "status", label: "Status", value: <AgentStatusChip status={agent.status} busy={agent.runningJobs > 0} className="mt-0.5" />, sub: agent.lastSeenAt ? <TimeAgo date={agent.lastSeenAt} /> : "never seen" },
        { key: "jobs", label: "Jobs · 24h", value: stats.total24h, sub: `${stats.succeeded24h} ok · ${stats.failed24h} failed` },
        {
          key: "rate",
          label: "Success rate",
          value: done ? `${Math.round((stats.succeeded24h / done) * 100)}%` : "—",
          hint: "Succeeded / (succeeded + failed + timed out) in the last 24 hours.",
        },
        { key: "avg", label: "Avg duration", value: formatMs(stats.avgDurationMs), sub: "successful jobs" },
        { key: "running", label: "Running", value: `${stats.running} / ${agent.effectiveMaxParallel ?? "—"}`, sub: stats.queued ? `${stats.queued} queued` : "none queued" },
        {
          key: "disk",
          label: "Job folders",
          value: formatBytes(agent.workDirBytes),
          sub: agent.lastCleanupAt ? (
            <span>
              cleaned <TimeAgo date={agent.lastCleanupAt} />
            </span>
          ) : (
            "not cleaned yet"
          ),
        },
      ]}
    />
  );
}

function Row({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 py-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd className={cn("min-w-0 text-right break-words", mono && "font-mono text-xs")}>{children}</dd>
    </div>
  );
}

export function MachinePanel({ agent }: { agent: AgentView }) {
  const flags = agent.localFlags ?? {};
  return (
    <Panel title="Machine" icon={<Server className="size-4 text-muted-foreground" />} contentClassName="py-1 sm:py-1">
      <dl className="divide-y">
        <Row k="Host">{agent.hostname ?? "—"}</Row>
        {agent.ownerName && <Row k="Owner">{agent.ownerName}</Row>}
        <Row k="System">{agent.os ? `${osLabel(agent.os, agent.arch)}${agent.osRelease ? ` · ${agent.osRelease}` : ""}` : "—"}</Row>
        <Row k="Node.js" mono>
          {agent.nodeVersion ?? "—"}
        </Row>
        <Row k="CLIs">
          <CliVersions agent={agent} className="justify-end" />
        </Row>
        <Row k="Runtime">
          {runtimeLabel(agent.effectiveRuntime)}{" "}
          <span className="text-xs text-muted-foreground">({agent.runtimeSetting ? `dashboard: ${runtimeLabel(agent.runtimeSetting)}` : `flag: ${runtimeLabel(flags.runtime ?? "detect")}`})</span>
        </Row>
        <Row k="CLI mode">
          <Badge variant="outline" className="font-normal whitespace-normal">
            {CLI_MODE_LABEL[agent.cliProfile] ?? agent.cliProfile}
          </Badge>
        </Row>
        <Row k="Agent version" mono>
          {agent.agentVersion ?? "—"}
          {agent.outdated && <div className="text-[11px] text-info">latest {agent.latestVersion}</div>}
        </Row>
        <Row k="Auto-update">
          {flags.noAutoUpdate ? (
            <span className="text-warning">off (--no-auto-update)</span>
          ) : agent.autoUpdate ? (
            "on"
          ) : (
            "off (dashboard)"
          )}
        </Row>
        <Row k="Work dir" mono>
          {agent.effectiveWorkDir ?? "—"}
        </Row>
        <Row k="Local policy">
          <span className="text-xs">
            Full mode {flags.allowFull ? <span className="text-foreground">allowed{flags.mcpServers ? ` (MCP: ${flags.mcpServers})` : ""}</span> : "off"} · Codex
            shell {flags.allowCodexShell ? "allowed" : "off"} · dashboard work dirs {flags.allowRemoteWorkdir ? "allowed" : "below base only"}
          </span>
        </Row>
        <Row k="Autostart">{flags.autostart ? { launchd: "launchd (macOS)", systemd: "systemd user unit", cron: "cron @reboot", task: "Scheduled Task", none: "none" }[flags.autostart] ?? flags.autostart : "—"}</Row>
        <Row k="Token">
          <span className="font-mono text-xs">{agent.tokenPrefix}…</span>{" "}
          <span className="text-xs text-muted-foreground">
            issued <TimeAgo date={agent.tokenIssuedAt} />
          </span>
        </Row>
        <Row k="Last IP" mono>
          {agent.lastIp ?? "—"}
        </Row>
        <Row k="Agent ID">
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            {agent.id}
            <CopyButton value={agent.id} size="icon" className="size-6" />
          </span>
        </Row>
      </dl>
    </Panel>
  );
}

export function VersionHistory({ history }: { history: CheckinHistoryView[] }) {
  if (!history.length) return <p className="py-6 text-center text-sm text-muted-foreground">No check-ins yet.</p>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-1 py-1.5 font-medium">Since</th>
            <th className="px-1 py-1.5 font-medium">Agent</th>
            <th className="px-1 py-1.5 font-medium">Claude Code</th>
            <th className="px-1 py-1.5 font-medium">Codex</th>
            <th className="px-1 py-1.5 font-medium">Node</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {history.map((h, i) => {
            const prev = history[i + 1];
            const diff = (a: string | null, b: string | null | undefined) => prev && a !== b;
            return (
              <tr key={h.id}>
                <td className="px-1 py-1.5 whitespace-nowrap text-muted-foreground">
                  <TimeAgo date={h.createdAt} />
                </td>
                <td className={cn("px-1 py-1.5 font-mono text-xs", diff(h.agentVersion, prev?.agentVersion) && "font-semibold text-info")}>{h.agentVersion ?? "—"}</td>
                <td className={cn("px-1 py-1.5 font-mono text-xs", diff(h.claudeVersion, prev?.claudeVersion) && "font-semibold text-info")}>{h.claudeVersion ?? "—"}</td>
                <td className={cn("px-1 py-1.5 font-mono text-xs", diff(h.codexVersion, prev?.codexVersion) && "font-semibold text-info")}>{h.codexVersion ?? "—"}</td>
                <td className={cn("px-1 py-1.5 font-mono text-xs", diff(h.nodeVersion, prev?.nodeVersion) && "font-semibold text-info")}>{h.nodeVersion ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Overview tab: KPIs, live terminal, machine facts, charts, recent jobs & activity. */
export function AgentOverview({
  agent,
  stats,
  histogram,
  recentJobs,
  recentEvents,
  history,
}: {
  agent: AgentView;
  stats: AgentJobStats;
  histogram: { hour: string; succeeded: number; failed: number }[];
  recentJobs: AgentJobView[];
  recentEvents: AgentEventView[];
  history: CheckinHistoryView[];
}) {
  useAutoRefresh(10_000);
  const [, setJob] = useUrlState("job", "");
  const [live, setLive] = useState<LiveStatusPayload | null>(null);
  const status = (live?.status as AgentStatusValue | undefined) ?? agent.status;
  const running = live?.jobs ?? [];

  return (
    <div className="space-y-5">
      <AgentKpis agent={{ ...agent, status }} stats={stats} />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-5">
        <Panel
          className="xl:col-span-3"
          title="Live terminal"
          icon={<Radio className="size-4 text-muted-foreground" />}
          description="Agent log and job output, streamed in real time."
          actions={
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <AgentOrb size={22} state={status === "online" && running.length ? "working" : STATUS_META[status].orb} />
              {running.length ? `${running.length} running` : "idle"}
            </span>
          }
        >
          <LiveTerminal agentId={agent.id} jobs={running} onStatus={setLive} minHeight={340} />
        </Panel>
        <div className="xl:col-span-2">
          <MachinePanel agent={agent} />
        </div>
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Panel title="Jobs · last 24 hours" icon={<Cpu className="size-4 text-muted-foreground" />}>
          <BarsChart
            data={histogram.map((h) => ({ ...h, date: h.hour }))}
            series={[
              { key: "succeeded", label: "Succeeded", color: "var(--success)" },
              { key: "failed", label: "Failed", color: "var(--destructive)" },
            ]}
            stacked
            height={200}
            xFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit" })}
          />
        </Panel>
        <Panel title="Recent jobs" icon={<ScrollText className="size-4 text-muted-foreground" />} contentClassName="p-2 sm:p-3">
          <AgentJobsTable jobs={recentJobs} compact />
        </Panel>
        <Panel title="Recent activity" icon={<History className="size-4 text-muted-foreground" />}>
          {recentEvents.length ? (
            <ActivityList events={recentEvents} dense onOpenJob={(id) => setJob(id)} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
          )}
        </Panel>
        <Panel title="CLI & agent versions" icon={<History className="size-4 text-muted-foreground" />} description="Reported at every check-in; one row per change.">
          <VersionHistory history={history} />
        </Panel>
      </div>
    </div>
  );
}
