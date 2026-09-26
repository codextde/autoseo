"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowUpCircle,
  Ban,
  CheckCircle2,
  Circle,
  Eraser,
  FlaskConical,
  KeyRound,
  Pause,
  Play,
  Plug,
  PlugZap,
  Settings2,
  Sparkles,
  Terminal,
  Timer,
  XCircle,
} from "lucide-react";
import { TimeAgo } from "@/components/app/misc";
import { FilterBar, MultiSelect } from "@/components/app/filters";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlListState, useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import type { AgentEventView } from "@/server/agents/queries";

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  created: Sparkles,
  first_checkin: Plug,
  online: Plug,
  offline: PlugZap,
  updated: ArrowUpCircle,
  update_requested: ArrowUpCircle,
  update_started: ArrowUpCircle,
  update_failed: XCircle,
  update_blocked: AlertTriangle,
  job_started: Play,
  job_succeeded: CheckCircle2,
  job_failed: XCircle,
  job_timeout: Timer,
  job_cancelled: Ban,
  job_cancel_requested: Ban,
  job_requeued: AlertTriangle,
  test_requested: FlaskConical,
  test_passed: FlaskConical,
  test_failed: FlaskConical,
  cleanup: Eraser,
  cleanup_requested: Eraser,
  cleanup_failed: Eraser,
  reinstalled: KeyRound,
  settings_changed: Settings2,
  paused: Pause,
  resumed: Play,
  cli_changed: Terminal,
  cli_problem: AlertTriangle,
};

const LEVEL_TONE: Record<string, string> = {
  success: "text-success bg-success/10 ring-success/20",
  warning: "text-warning bg-warning/12 ring-warning/25",
  error: "text-destructive bg-destructive/10 ring-destructive/20",
  info: "text-muted-foreground bg-muted ring-border",
};

export const EVENT_GROUPS: Record<string, { label: string; types: string[] }> = {
  connection: { label: "Connection", types: ["created", "first_checkin", "online", "offline", "reinstalled"] },
  jobs: { label: "Jobs", types: ["job_started", "job_succeeded", "job_failed", "job_timeout", "job_cancelled", "job_cancel_requested", "job_requeued"] },
  tests: { label: "Self-tests", types: ["test_requested", "test_passed", "test_failed"] },
  updates: { label: "Updates", types: ["update_requested", "update_started", "updated", "update_failed", "update_blocked", "cli_changed"] },
  maintenance: { label: "Cleanup & settings", types: ["cleanup", "cleanup_requested", "cleanup_failed", "settings_changed", "paused", "resumed", "cli_problem"] },
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function ActivityList({ events, dense, onOpenJob }: { events: AgentEventView[]; dense?: boolean; onOpenJob?: (jobId: string) => void }) {
  const groups = useMemo(() => {
    const out: { day: string; items: AgentEventView[] }[] = [];
    for (const e of events) {
      const day = dayLabel(e.createdAt);
      const last = out.at(-1);
      if (last && last.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [events]);

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.day} className="space-y-1">
          {!dense && <div className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.day}</div>}
          <ol className="relative space-y-0.5">
            {g.items.map((e) => {
              const Icon = TYPE_ICON[e.type] ?? Circle;
              return (
                <li key={e.id} className="group flex min-w-0 items-start gap-3 rounded-lg px-1 py-1.5 hover:bg-muted/40">
                  <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", LEVEL_TONE[e.level] ?? LEVEL_TONE.info)}>
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm break-words">{e.message}</p>
                    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <TimeAgo date={e.createdAt} />
                      <span className="font-mono">{e.type}</span>
                      {e.jobId && onOpenJob && (
                        <button type="button" onClick={() => onOpenJob(e.jobId!)} className="font-mono text-foreground/80 underline-offset-2 hover:underline">
                          {e.jobId}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

export function AgentActivity({ events }: { events: AgentEventView[] }) {
  const [, setJob] = useUrlState("job", "");
  const [groups, setGroups] = useUrlListState("etype");
  const [levels, setLevels] = useUrlListState("elevel");
  const filtered = useMemo(() => {
    const types = new Set(groups.flatMap((g) => EVENT_GROUPS[g]?.types ?? []));
    return events.filter((e) => (!groups.length || types.has(e.type)) && (!levels.length || levels.includes(e.level)));
  }, [events, groups, levels]);

  return (
    <div className="space-y-3">
      <FilterBar activeCount={groups.length + levels.length}>
        <MultiSelect
          label="Type"
          value={groups}
          onChange={setGroups}
          options={Object.entries(EVENT_GROUPS).map(([value, g]) => ({ value, label: g.label, count: events.filter((e) => g.types.includes(e.type)).length }))}
        />
        <MultiSelect
          label="Level"
          value={levels}
          onChange={setLevels}
          options={["info", "success", "warning", "error"].map((l) => ({ value: l, label: l.charAt(0).toUpperCase() + l.slice(1), count: events.filter((e) => e.level === l).length }))}
        />
      </FilterBar>
      {filtered.length ? (
        <ActivityList events={filtered} onOpenJob={(id) => setJob(id)} />
      ) : (
        <EmptyState compact icon={Circle} title="No activity" description="Check-ins, updates, jobs and cleanups are logged here." />
      )}
    </div>
  );
}
