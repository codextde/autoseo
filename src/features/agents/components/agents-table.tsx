"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpCircle, ChevronRight } from "lucide-react";
import { AgentOrb } from "@/components/agent-ui";
import { DataTable, type Column } from "@/components/app/data-table";
import { FilterBar, MultiSelect, SearchInput } from "@/components/app/filters";
import { TimeAgo } from "@/components/app/misc";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUrlListState, useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import type { AgentView } from "@/server/agents/queries";
import {
  AgentStatusChip,
  OsIcon,
  STATUS_META,
  osLabel,
  runtimeLabel,
  shortVersion,
  useAutoRefresh,
  type AgentStatusValue,
} from "./agent-meta";

export function CliVersions({
  agent,
  className,
}: {
  agent: Pick<AgentView, "claudeVersion" | "codexVersion" | "effectiveRuntime">;
  className?: string;
}) {
  const item = (name: string, key: "claude" | "codex", v: string | null) => (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] tabular ring-1 ring-inset",
        v
          ? "ring-border"
          : "text-muted-foreground/60 ring-transparent line-through decoration-muted-foreground/40",
        agent.effectiveRuntime === key && v && "bg-brand-soft/60 ring-brand/30",
      )}
      title={
        v
          ? `${name} ${v}${agent.effectiveRuntime === key ? " (in use)" : ""}`
          : `${name} not installed`
      }
    >
      {name} {v ? <span className="font-mono">{v}</span> : null}
    </span>
  );
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {item("Claude", "claude", agent.claudeVersion)}
      {item("Codex", "codex", agent.codexVersion)}
    </span>
  );
}

export function VersionCell({
  agent,
}: {
  agent: Pick<
    AgentView,
    "agentVersion" | "latestVersion" | "outdated" | "updateRequestedAt"
  >;
}) {
  if (!agent.agentVersion)
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs">
        {shortVersion(agent.agentVersion)}
      </span>
      {agent.outdated && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-0.5 rounded-full bg-info/12 px-1.5 py-0.5 text-[10px] font-medium text-info">
              <ArrowUpCircle className="size-3" />
              {agent.updateRequestedAt ? "Queued" : "Update"}
            </span>
          </TooltipTrigger>
          <TooltipContent>Latest: {agent.latestVersion}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

export function AgentsTable({
  agents,
  showWorkspace,
}: {
  agents: AgentView[];
  showWorkspace?: boolean;
}) {
  const router = useRouter();
  useAutoRefresh(10_000);
  const [q, setQ] = useUrlState("q", "");
  const [statuses, setStatuses] = useUrlListState("status");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return agents.filter((a) => {
      if (statuses.length && !statuses.includes(a.status)) return false;
      if (!needle) return true;
      return [a.name, a.hostname, a.os, ...a.labels, a.workspaceName].some(
        (v) => v?.toLowerCase().includes(needle),
      );
    });
  }, [agents, q, statuses]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of agents) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [agents]);

  const columns: Column<AgentView>[] = [
    {
      id: "name",
      header: "Agent",
      sortValue: (a) => a.name.toLowerCase(),
      cell: (a) => (
        <div className="flex min-w-0 items-center gap-3">
          <AgentOrb
            size={28}
            state={
              a.status === "online" && a.runningJobs > 0
                ? "working"
                : STATUS_META[a.status].orb
            }
          />
          <div className="min-w-0">
            <Link
              href={`/agents/${a.id}`}
              className="block truncate font-medium hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {a.name}
            </Link>
            <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span className="truncate">
                {a.hostname ?? "not installed yet"}
              </span>
              {a.labels.slice(0, 3).map((l) => (
                <Badge
                  key={l}
                  variant="outline"
                  className="h-4 px-1 text-[10px] font-normal"
                >
                  {l}
                </Badge>
              ))}
              {a.shared && (
                <Badge
                  variant="outline"
                  className="h-4 px-1 text-[10px] font-normal"
                >
                  shared
                </Badge>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (a) =>
        ["online", "updating", "paused", "offline", "pending"].indexOf(
          a.status,
        ),
      cell: (a) => (
        <AgentStatusChip status={a.status} busy={a.runningJobs > 0} />
      ),
    },
    ...(showWorkspace
      ? [
          {
            id: "workspace",
            header: "Workspace",
            hideBelow: "lg" as const,
            sortValue: (a: AgentView) => a.workspaceName ?? "",
            cell: (a: AgentView) => (
              <span className="text-sm">{a.workspaceName ?? "—"}</span>
            ),
          },
        ]
      : []),
    {
      id: "os",
      header: "System",
      hideBelow: "md",
      sortValue: (a) => a.os ?? "",
      cell: (a) =>
        a.os ? (
          <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
            <OsIcon os={a.os} className="text-muted-foreground" />
            {osLabel(a.os, a.arch)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "runtime",
      header: "Runtime",
      hideBelow: "md",
      sortValue: (a) => a.effectiveRuntime ?? "",
      cell: (a) => (
        <div className="text-sm whitespace-nowrap">
          {runtimeLabel(a.effectiveRuntime)}
          <div className="text-[11px] text-muted-foreground">
            {a.runtimeSetting
              ? `set: ${runtimeLabel(a.runtimeSetting)}`
              : "agent default"}
          </div>
        </div>
      ),
    },
    {
      id: "clis",
      header: "CLI versions",
      hideBelow: "lg",
      cell: (a) => <CliVersions agent={a} />,
    },
    {
      id: "version",
      header: "Agent version",
      hideBelow: "xl",
      sortValue: (a) => a.agentVersion ?? "",
      cell: (a) => <VersionCell agent={a} />,
    },
    {
      id: "jobs",
      header: "Jobs",
      align: "right",
      hideBelow: "sm",
      sortValue: (a) => a.runningJobs,
      cell: (a) => (
        <span className="tabular">
          <span className={cn(a.runningJobs > 0 && "font-medium text-info")}>
            {a.runningJobs}
          </span>
          <span className="text-muted-foreground">
            {" "}
            / {a.effectiveMaxParallel ?? a.maxParallel ?? "—"}
          </span>
        </span>
      ),
    },
    {
      id: "seen",
      header: "Last check-in",
      align: "right",
      hideBelow: "sm",
      sortValue: (a) =>
        a.lastCheckinAt ? new Date(a.lastCheckinAt).getTime() : 0,
      cell: (a) => (
        <TimeAgo
          date={a.lastCheckinAt}
          className="text-sm text-muted-foreground"
        />
      ),
    },
    {
      id: "go",
      header: "",
      width: "32px",
      cell: () => <ChevronRight className="size-4 text-muted-foreground" />,
    },
  ];

  const statusOptions = (Object.keys(STATUS_META) as AgentStatusValue[]).map(
    (s) => ({ value: s, label: STATUS_META[s].label, count: counts[s] ?? 0 }),
  );

  return (
    <div className="space-y-3">
      <FilterBar
        search={
          <SearchInput
            value={q}
            onChange={(v) => setQ(v || null)}
            placeholder="Search name, host, label…"
          />
        }
        activeCount={statuses.length}
      >
        <MultiSelect
          label="Status"
          options={statusOptions}
          value={statuses}
          onChange={setStatuses}
        />
      </FilterBar>
      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(a) => a.id}
        onRowClick={(a) => router.push(`/agents/${a.id}`)}
        initialSort={{ id: "status", dir: "asc" }}
        paginate={filtered.length > 50}
        empty={
          <div className="py-12 text-center text-sm text-muted-foreground">
            No agents match these filters.
          </div>
        }
        mobileCard={(a) => (
          <Link href={`/agents/${a.id}`} className="flex items-center gap-3">
            <AgentOrb
              size={34}
              state={
                a.status === "online" && a.runningJobs > 0
                  ? "working"
                  : STATUS_META[a.status].orb
              }
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{a.name}</span>
                <AgentStatusChip status={a.status} busy={a.runningJobs > 0} />
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                {a.os && (
                  <span className="inline-flex items-center gap-1">
                    <OsIcon os={a.os} /> {osLabel(a.os)}
                  </span>
                )}
                <span>{runtimeLabel(a.effectiveRuntime)}</span>
                <span className="tabular">
                  {a.runningJobs}/{a.effectiveMaxParallel ?? "—"} jobs
                </span>
                <TimeAgo date={a.lastCheckinAt} />
              </div>
              <CliVersions agent={a} />
            </div>
          </Link>
        )}
      />
    </div>
  );
}
