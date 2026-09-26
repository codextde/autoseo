"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "motion/react";
import { ArrowUpDown, CircleCheck, Download, ListChecks, Loader2, RefreshCw, Sparkles, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar, MultiSelect, SearchInput } from "@/components/app/filters";
import { KpiStrip } from "@/components/app/metrics";
import { PageContainer, PageHeader, Panel } from "@/components/app/page";
import { TimeAgo } from "@/components/app/misc";
import { useUrlListState, useUrlState } from "@/hooks/use-url-state";
import { IntegrationConnect, PushToPmButton } from "@/features/optimize/integrations/components";
import { ProviderGlyph } from "@/features/optimize/integrations/components/provider-glyph";
import type { ConnectedIntegration } from "@/server/optimize/integrations/types";
import type { TaskListItem } from "@/server/optimize/tasks/service";
import { compareTasks, impactBand } from "@/server/optimize/tasks/scoring";
import {
  TASK_CATEGORY_LIST,
  TASK_CATEGORY_META,
  TASK_STATUS_META,
  TASKS_EMPTY_TEXT,
  type TaskCategoryKey,
  type TaskStatusKey,
} from "@/features/optimize/constants";
import { CategoryIcon, MemberAvatar, PriorityBadge, ScoreDots, type MemberLite } from "@/features/optimize/shared/task-ui";
import { safeHttpUrl } from "@/features/optimize/shared/safe-url";
import { assignTasksAction, reanalyzeTasksAction, setTaskStatusAction, taskRunStateAction } from "../actions";
import { StatusPill, StatusMenu } from "./status";
import { NewTaskDialog } from "./new-task-dialog";
import { RoutingSheet } from "./routing-sheet";
import type { OptimizeSettingsView, RunState } from "./types";

type Props = {
  projectId: string;
  tasks: TaskListItem[];
  members: MemberLite[];
  connected: ConnectedIntegration[];
  canEdit: boolean;
  canManage: boolean;
  currentUserId: string;
  runState: RunState;
  settings: OptimizeSettingsView;
};

const STATUS_FILTERS = [
  { key: "active", label: "Active" },
  { key: "done", label: "Done" },
  { key: "dismissed", label: "Dismissed" },
  { key: "all", label: "All" },
];

const SORTS = [
  { key: "priority", label: "Priority" },
  { key: "impact", label: "Impact" },
  { key: "effort", label: "Least effort" },
  { key: "newest", label: "Newest" },
  { key: "updated", label: "Recently updated" },
];

export function TasksView({ projectId, tasks, members, connected, canEdit, canManage, currentUserId, runState: initialRun, settings }: Props) {
  const router = useRouter();
  const [q, setQ] = useUrlState("q", "");
  const [status, setStatus] = useUrlState("status", "active");
  const [cats, setCats] = useUrlListState("category");
  const [who, setWho] = useUrlListState("assignee");
  const [impact, setImpact] = useUrlListState("impact");
  const [sort, setSort] = useUrlState("sort", "priority");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [run, setRun] = useState(initialRun);
  const [pending, start] = useTransition();
  const polling = useRef(false);
  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const inStatus = (t: TaskListItem) =>
    status === "all" ? true : status === "active" ? t.status === "open" || t.status === "in_progress" : t.status === status;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = tasks.filter((t) => {
      if (!inStatus(t)) return false;
      if (cats.length && !cats.includes(t.category)) return false;
      if (who.length) {
        const ok = who.some((w) => (w === "unassigned" ? !t.assigneeId : w === "me" ? t.assigneeId === currentUserId : t.assigneeId === w));
        if (!ok) return false;
      }
      if (impact.length && !impact.includes(impactBand(t.impact))) return false;
      if (needle && !`${t.title} ${t.summary} ${t.targetPrompts.join(" ")}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const by: Record<string, (a: TaskListItem, b: TaskListItem) => number> = {
      priority: compareTasks,
      impact: (a, b) => b.impact - a.impact || compareTasks(a, b),
      effort: (a, b) => a.effort - b.effort || compareTasks(a, b),
      newest: (a, b) => b.firstDetectedAt.localeCompare(a.firstDetectedAt),
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    };
    return [...list].sort(by[sort] ?? compareTasks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, q, status, cats, who, impact, sort, currentUserId]);

  const statusCounts = useMemo(() => {
    const c = { active: 0, done: 0, dismissed: 0, all: tasks.length };
    for (const t of tasks) {
      if (t.status === "open" || t.status === "in_progress") c.active++;
      else if (t.status === "done") c.done++;
      else c.dismissed++;
    }
    return c;
  }, [tasks]);

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) if (inStatus(t)) m.set(t.category, (m.get(t.category) ?? 0) + 1);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, status]);

  const [now] = useState(() => Date.now());
  const kpis = useMemo(() => {
    const since = now - 30 * 86400000;
    const open = tasks.filter((t) => t.status === "open").length;
    const prog = tasks.filter((t) => t.status === "in_progress").length;
    const high = tasks.filter((t) => (t.status === "open" || t.status === "in_progress") && t.impact >= 7).length;
    const done = tasks.filter((t) => t.status === "done" && t.resolvedAt && new Date(t.resolvedAt).getTime() > since);
    return [
      { key: "open", label: "Open", value: open },
      { key: "progress", label: "In progress", value: prog },
      { key: "high", label: "High impact", value: high, hint: "Active tasks with impact ≥ 7/10" },
      { key: "done", label: "Done · 30d", value: done.length },
      { key: "auto", label: "Auto-resolved · 30d", value: done.filter((t) => t.resolution === "auto").length, hint: "Resolved automatically after re-checks showed the fix is live" },
    ];
  }, [tasks, now]);

  /* Re-analyze + poll the job until it finishes */
  const poll = async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      for (let i = 0; i < 240; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const res = await taskRunStateAction(projectId);
        if (!res.ok) break;
        setRun(res.data);
        if (!res.data.running) {
          const s = res.data.lastRun?.stats;
          if (res.data.lastRun?.status === "failed") toast.error("Analysis failed", { description: res.data.lastRun.error ?? undefined });
          else
            toast.success("Analysis complete", {
              description: s ? `${s.created ?? 0} new · ${s.updated ?? 0} updated · ${s.resolved ?? 0} auto-resolved` : undefined,
            });
          router.refresh();
          break;
        }
      }
    } finally {
      polling.current = false;
    }
  };

  useEffect(() => {
    if (initialRun.running) void poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reanalyze = () =>
    start(async () => {
      const res = await reanalyzeTasksAction(projectId);
      if (!res.ok) return void toast.error(res.error);
      setRun((r) => ({ ...r, running: true }));
      toast("Re-analyzing your data…", { description: "Signals from tracking, citations, competitors, crawls and Search Console." });
      void poll();
    });

  const bulkStatus = (s: TaskStatusKey, ids = [...selected]) =>
    start(async () => {
      const res = await setTaskStatusAction(projectId, ids, s);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${res.data.changed} task${res.data.changed === 1 ? "" : "s"} → ${TASK_STATUS_META[s].label}`);
      setSelected(new Set());
      router.refresh();
    });

  const bulkAssign = (assigneeId: string | null, ids = [...selected]) =>
    start(async () => {
      const res = await assignTasksAction(projectId, ids, assigneeId);
      if (!res.ok) return void toast.error(res.error);
      toast.success(assigneeId ? `Assigned to ${memberMap.get(assigneeId)?.name ?? memberMap.get(assigneeId)?.email}` : "Unassigned");
      setSelected(new Set());
      router.refresh();
    });

  const columns: Column<TaskListItem>[] = [
    {
      id: "task",
      header: "Task",
      cell: (t) => (
        <div className="flex min-w-0 items-start gap-3 py-0.5">
          <CategoryIcon category={t.category} />
          <div className="min-w-0 flex-1">
            <Link href={`/p/${projectId}/tasks/${t.id}`} className="line-clamp-2 font-medium text-foreground hover:underline" onClick={(e) => e.stopPropagation()}>
              {t.title}
            </Link>
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{t.summary}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {t.datasets.slice(0, 3).map((d) => (
                <span key={d} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {d}
                </span>
              ))}
              {t.stepsTotal > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground tabular">
                  <ListChecks className="size-3" />
                  {t.stepsDone}/{t.stepsTotal}
                </span>
              )}
              {!t.signalActive && t.status !== "done" && t.source === "generator" && (
                <span className="rounded-md bg-success/12 px-1.5 py-0.5 text-[10px] font-medium text-success">Signal gone</span>
              )}
              {t.status === "done" && t.resolution === "auto" && (
                <span className="inline-flex items-center gap-1 rounded-md bg-success/12 px-1.5 py-0.5 text-[10px] font-medium text-success">
                  <Sparkles className="size-3" /> Auto-resolved
                </span>
              )}
              {t.external.map((e) =>
                safeHttpUrl(e.url) ? (
                  <a key={e.provider} href={safeHttpUrl(e.url)!} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()} className="inline-flex">
                    <ProviderGlyph provider={e.provider} size="xs" />
                  </a>
                ) : (
                  <ProviderGlyph key={e.provider} provider={e.provider} size="xs" />
                ),
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "priority",
      header: "Priority",
      sortValue: (t) => t.priority,
      cell: (t) => <PriorityBadge priority={t.priority} impact={t.impact} effort={t.effort} />,
      width: "96px",
    },
    {
      id: "impact",
      header: "Impact · Effort",
      hideBelow: "lg",
      sortValue: (t) => t.impact,
      cell: (t) => (
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="w-9">Impact</span>
            <ScoreDots value={t.impact} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-9">Effort</span>
            <ScoreDots value={t.effort} tone="muted" />
          </div>
        </div>
      ),
      width: "150px",
    },
    {
      id: "category",
      header: "Category",
      hideBelow: "xl",
      sortValue: (t) => t.category,
      cell: (t) => <span className="text-xs text-muted-foreground">{TASK_CATEGORY_META[t.category].label}</span>,
    },
    {
      id: "assignee",
      header: "Assignee",
      hideBelow: "md",
      cell: (t) => (
        <div onClick={(e) => e.stopPropagation()}>
          <AssigneeMenu members={members} value={t.assigneeId} disabled={!canEdit || pending} onChange={(id) => bulkAssign(id, [t.id])} memberMap={memberMap} />
        </div>
      ),
      width: "90px",
    },
    {
      id: "status",
      header: "Status",
      sortValue: (t) => ["open", "in_progress", "done", "dismissed"].indexOf(t.status),
      cell: (t) => (
        <div onClick={(e) => e.stopPropagation()}>
          {canEdit ? <StatusMenu value={t.status} onChange={(s) => bulkStatus(s, [t.id])} disabled={pending} /> : <StatusPill status={t.status} />}
        </div>
      ),
      width: "130px",
    },
    {
      id: "updated",
      header: "Detected",
      hideBelow: "xl",
      sortValue: (t) => t.lastDetectedAt,
      cell: (t) => <TimeAgo date={t.lastDetectedAt} className="text-xs text-muted-foreground" />,
    },
  ];

  const activeFilters = cats.length + who.length + impact.length + (status !== "active" ? 1 : 0);
  const hasTasks = tasks.length > 0;

  return (
    <PageContainer>
      <PageHeader
        title="Tasks"
        description="Prioritized, evidence-backed actions — generated only where several datasets agree."
        actions={
          <>
            <IntegrationConnect projectId={projectId} kind="pm" connected={connected} canManage={canManage} />
            <Button variant="outline" size="sm" asChild>
              <a href={`/p/${projectId}/tasks/export?status=${status}`} download>
                <Download className="size-3.5" /> Export
              </a>
            </Button>
            {canEdit && <RoutingSheet projectId={projectId} members={members} connected={connected} settings={settings} canManage={canManage} />}
            {canEdit && <NewTaskDialog projectId={projectId} members={members} />}
            {canEdit && (
              <Button size="sm" onClick={reanalyze} disabled={pending || run.running}>
                {run.running ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {run.running ? "Analyzing…" : "Re-analyze"}
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <KpiStrip items={kpis} className="flex-1" />
        <div className="flex items-center gap-2 text-xs text-muted-foreground lg:w-64 lg:flex-col lg:items-start lg:gap-0.5">
          {run.running ? (
            <span className="inline-flex items-center gap-1.5 text-info">
              <Loader2 className="size-3 animate-spin" /> Analyzing signals…
            </span>
          ) : run.lastRun ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <CircleCheck className="size-3 text-success" /> Last analysis <TimeAgo date={run.lastRun.finishedAt ?? run.lastRun.startedAt} />
              </span>
              <span className="tabular">
                {run.lastRun.stats?.created ?? 0} new · {run.lastRun.stats?.resolved ?? 0} auto-resolved
              </span>
            </>
          ) : (
            <span>Not analyzed yet</span>
          )}
        </div>
      </div>

      <Panel contentClassName="space-y-3 p-3 sm:p-4">
        <FilterBar
          activeCount={activeFilters}
          search={<SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search tasks…" />}
          right={
            <Select value={sort} onValueChange={(v) => setSort(v)}>
              <SelectTrigger size="sm" className="h-8 w-auto gap-1.5 text-xs">
                <ArrowUpDown className="size-3.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {SORTS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        >
          <div className="flex rounded-lg bg-muted p-0.5">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStatus(s.key)}
                className={
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                  (status === s.key ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")
                }
              >
                {s.label}
                <span className="ml-1 text-muted-foreground tabular">{statusCounts[s.key as keyof typeof statusCounts]}</span>
              </button>
            ))}
          </div>
          <MultiSelect
            options={TASK_CATEGORY_LIST.map((c) => ({
              value: c,
              label: TASK_CATEGORY_META[c].label,
              count: catCounts.get(c) ?? 0,
              icon: <CategoryIcon category={c} size="sm" className="size-4 rounded" />,
            }))}
            value={cats}
            onChange={setCats}
            placeholder="All Categories"
            label="Categories"
          />
          <MultiSelect
            options={[
              { value: "me", label: "Assigned to me" },
              { value: "unassigned", label: "Unassigned" },
              ...members.map((m) => ({ value: m.id, label: m.name ?? m.email, icon: <MemberAvatar member={m} size="xs" /> })),
            ]}
            value={who}
            onChange={setWho}
            placeholder="All Assignees"
            label="Assignees"
            icon={<UserRound className="size-3.5 text-muted-foreground" />}
          />
          <MultiSelect
            options={[
              { value: "high", label: "High impact (7–10)" },
              { value: "medium", label: "Medium impact (4–6)" },
              { value: "low", label: "Low impact (1–3)" },
            ]}
            value={impact}
            onChange={setImpact}
            placeholder="Any impact"
            label="Impact"
            searchable={false}
          />
        </FilterBar>

        {selected.size > 0 && canEdit && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/50 px-3 py-2 text-xs"
          >
            <span className="font-medium tabular">{selected.size} selected</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={pending}>
                  Set status
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(Object.keys(TASK_STATUS_META) as TaskStatusKey[]).map((s) => (
                  <DropdownMenuItem key={s} onClick={() => bulkStatus(s)}>
                    <StatusPill status={s} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={pending}>
                  Assign
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                <DropdownMenuItem onClick={() => bulkAssign(currentUserId)}>Assign to me</DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkAssign(null)}>Unassign</DropdownMenuItem>
                <DropdownMenuSeparator />
                {members.map((m) => (
                  <DropdownMenuItem key={m.id} onClick={() => bulkAssign(m.id)} className="gap-2">
                    <MemberAvatar member={m} size="xs" /> {m.name ?? m.email}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <PushToPmButton projectId={projectId} taskIds={[...selected]} connected={connected} canEdit={canEdit} onDone={() => setSelected(new Set())} />
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} className="ml-auto">
              <X className="size-3.5" /> Clear
            </Button>
          </motion.div>
        )}

        {hasTasks ? (
          <DataTable
            columns={columns}
            data={filtered}
            getRowId={(t) => t.id}
            selectable={canEdit}
            selected={selected}
            onSelectedChange={setSelected}
            onRowClick={(t) => router.push(`/p/${projectId}/tasks/${t.id}`)}
            pageSize={50}
            empty={<EmptyState compact title="No tasks match these filters" description="Clear filters or switch the status to see more." />}
            mobileCard={(t) => (
              <div className="flex gap-3">
                <CategoryIcon category={t.category} size="sm" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="font-medium leading-snug">{t.title}</div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{t.summary}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge priority={t.priority} />
                    <StatusPill status={t.status} />
                    <MemberAvatar member={t.assigneeId ? memberMap.get(t.assigneeId) : null} size="xs" />
                  </div>
                </div>
              </div>
            )}
          />
        ) : (
          <EmptyState
            icon={ListChecks}
            title={run.running ? "Analyzing your data…" : "No tasks yet"}
            description={TASKS_EMPTY_TEXT}
            action={
              canEdit && !run.running ? (
                <Button size="sm" onClick={reanalyze} disabled={pending}>
                  <RefreshCw className="size-3.5" /> Analyze now
                </Button>
              ) : undefined
            }
          />
        )}
      </Panel>
    </PageContainer>
  );
}

function AssigneeMenu({
  members,
  memberMap,
  value,
  onChange,
  disabled,
}: {
  members: MemberLite[];
  memberMap: Map<string, MemberLite>;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const current = value ? memberMap.get(value) : null;
  if (disabled) return <MemberAvatar member={current} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Change assignee">
          <MemberAvatar member={current} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">Assign to</DropdownMenuLabel>
        {members.map((m) => (
          <DropdownMenuItem key={m.id} onClick={() => onChange(m.id)} className="gap-2">
            <MemberAvatar member={m} size="xs" /> {m.name ?? m.email}
          </DropdownMenuItem>
        ))}
        {value && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange(null)}>Unassign</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type { TaskCategoryKey };
