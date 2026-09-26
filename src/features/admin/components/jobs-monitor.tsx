"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ListChecks, Loader2, RefreshCw, RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type Column } from "@/components/app/data-table";
import { FilterBar, MultiSelect, SearchInput } from "@/components/app/filters";
import { StatusBadge, TimeAgo } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlPatch, useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import type { JobDetail, JobListRow } from "@/server/admin/jobs";
import { cancelJobAction, getJobDetailAction, listJobsAction, retryJobAction } from "../actions/jobs";
import { JsonView } from "./jobs-json-view";

type Status = "all" | "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type JobsData = {
  items: JobListRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<Status, number>;
  types: { type: string; count: number }[];
};

const STATUS_TABS: { key: Status; label: string }[] = [
  { key: "all", label: "All" },
  { key: "queued", label: "Queued" },
  { key: "running", label: "Running" },
  { key: "succeeded", label: "Succeeded" },
  { key: "failed", label: "Failed" },
  { key: "cancelled", label: "Cancelled" },
];

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function canRetry(status: string) {
  return status === "failed" || status === "cancelled";
}
function canCancel(status: string) {
  return status === "queued" || status === "running";
}

export function JobsMonitor({ initial }: { initial: JobsData }) {
  const router = useRouter();
  const [status] = useUrlState("status", "all");
  const [type] = useUrlState("type", "");
  const [q] = useUrlState("q", "");
  const [pageParam] = useUrlState("page", "0");
  const [patch, navigating] = useUrlPatch();
  const [data, setData] = useState<JobsData>(initial);
  const [live, setLive] = useState(true);
  const [refreshing, startRefresh] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const page = Number(pageParam) || 0;

  // Server re-renders (filter changes) replace the polled data.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setData(initial);
  }

  const reload = useCallback(async () => {
    const res = await listJobsAction({
      status: status as Status,
      type: type || null,
      q: q || null,
      page,
    });
    if (res.ok) setData(res.data as JobsData);
  }, [status, type, q, page]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 5000);
    return () => clearInterval(t);
  }, [live, reload]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    const res = await fn();
    if (!res.ok) return void toast.error(res.error ?? "Failed");
    toast.success(success);
    await reload();
  };

  const columns: Column<JobListRow>[] = [
    {
      id: "type",
      header: "Job",
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-[12.5px] font-medium">{r.type}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{r.id}</div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      id: "project",
      header: "Project",
      hideBelow: "lg",
      cell: (r) =>
        r.projectId ? (
          <Link href={`/p/${r.projectId}`} onClick={(e) => e.stopPropagation()} className="truncate text-sm hover:underline">
            {r.projectName ?? r.projectId}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "attempts",
      header: "Attempts",
      align: "right",
      hideBelow: "md",
      cell: (r) => (
        <span className={cn("tabular", r.attempts >= r.maxAttempts && r.status === "failed" && "text-destructive")}>
          {r.attempts}/{r.maxAttempts}
        </span>
      ),
    },
    {
      id: "runAt",
      header: "Run at",
      hideBelow: "md",
      cell: (r) => <TimeAgo date={r.runAt} className="text-sm" />,
    },
    {
      id: "duration",
      header: "Duration",
      align: "right",
      cell: (r) => <span className="tabular">{formatDuration(r.durationMs)}</span>,
    },
    {
      id: "created",
      header: "Created",
      hideBelow: "lg",
      cell: (r) => <TimeAgo date={r.createdAt} className="text-sm text-muted-foreground" />,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {canRetry(r.status) && (
            <Button variant="ghost" size="icon-sm" title="Retry" onClick={() => act(() => retryJobAction(r.id), "Job re-queued")}>
              <RotateCcw className="size-3.5" />
            </Button>
          )}
          {canCancel(r.status) && (
            <Button variant="ghost" size="icon-sm" title="Cancel" onClick={() => act(() => cancelJobAction(r.id), "Job cancelled")}>
              <Square className="size-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="space-y-4">
      <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {STATUS_TABS.map((t) => {
          const active = status === t.key;
          const n = data.counts[t.key] ?? 0;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => patch({ status: t.key === "all" ? null : t.key, page: null })}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
                active ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted/60",
              )}
            >
              <span className="text-xs font-medium">{t.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-semibold tabular",
                  active
                    ? "bg-background/20"
                    : t.key === "failed" && n > 0
                      ? "bg-destructive/12 text-destructive"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {n.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      <FilterBar
        activeCount={type ? 1 : 0}
        search={<SearchInput value={q} onChange={(v) => patch({ q: v || null, page: null })} placeholder="Search id, type, error…" />}
        right={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Switch id="jobs-live" size="sm" checked={live} onCheckedChange={setLive} />
              <Label htmlFor="jobs-live" className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                {live && <span className="size-1.5 animate-pulse rounded-full bg-success" />}
                Live
              </Label>
            </div>
            <Button
              variant="outline"
              size="icon-sm"
              title="Refresh"
              onClick={() =>
                startRefresh(async () => {
                  await reload();
                  router.refresh();
                })
              }
            >
              <RefreshCw className={cn("size-3.5", (refreshing || navigating) && "animate-spin")} />
            </Button>
          </div>
        }
      >
        <MultiSelect
          single
          label="Type"
          placeholder="All job types"
          options={data.types.map((t) => ({
            value: t.type,
            label: t.type,
            count: t.count,
          }))}
          value={type ? [type] : []}
          onChange={(v) => patch({ type: v[0] ?? null, page: null })}
          className="min-w-44"
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data.items}
        getRowId={(r) => r.id}
        paginate={false}
        dense
        onRowClick={(r) => setOpenId(r.id)}
        empty={
          <EmptyState
            icon={ListChecks}
            title="No jobs match"
            description={
              status !== "all" || type || q
                ? "Try a different status, type or search."
                : "Background work (tracking runs, audits, reports, maintenance) will show up here."
            }
            compact
          />
        }
        mobileCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-mono text-[12.5px] font-medium">{r.type}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">{r.id}</div>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                Attempts{" "}
                <span className="text-foreground tabular">
                  {r.attempts}/{r.maxAttempts}
                </span>
              </span>
              <span>
                Duration <span className="text-foreground tabular">{formatDuration(r.durationMs)}</span>
              </span>
              <TimeAgo date={r.createdAt} />
            </div>
            {r.lastError && r.status === "failed" && <p className="line-clamp-2 text-xs text-destructive">{r.lastError}</p>}
          </div>
        )}
      />

      {data.total > data.pageSize && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular">
            {(page * data.pageSize + 1).toLocaleString()}–{Math.min(data.total, (page + 1) * data.pageSize).toLocaleString()} of{" "}
            {data.total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={page <= 0}
              onClick={() => patch({ page: page - 1 ? String(page - 1) : null })}
            >
              <ChevronLeft className="size-3.5" /> Prev
            </Button>
            <span className="px-2 tabular">
              {page + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={page >= pageCount - 1}
              onClick={() => patch({ page: String(page + 1) })}
            >
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <JobDetailSheet id={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-sm">{children}</div>
    </div>
  );
}

function JobDetailSheet({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => Promise<void> }) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl data-[side=right]:sm:max-w-xl">
        {id ? <JobDetailBody key={id} id={id} onChanged={onChanged} /> : <SheetTitle className="sr-only">Job</SheetTitle>}
      </SheetContent>
    </Sheet>
  );
}

function JobDetailBody({ id, onChanged }: { id: string; onChanged: () => Promise<void> }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await getJobDetailAction(id);
    if (res.ok) {
      setJob(res.data);
      setError(null);
    } else setError(res.error);
  }, [id]);

  useEffect(() => {
    let alive = true;
    void getJobDetailAction(id).then((res) => {
      if (!alive) return;
      if (res.ok) setJob(res.data);
      else setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const live = job?.status === "running" || job?.status === "queued";
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [live, load]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Failed");
      else {
        toast.success(msg);
        await Promise.all([load(), onChanged()]);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SheetHeader className="border-b p-4 pr-12">
        <SheetTitle className="font-mono text-sm break-all">{job?.type ?? "Job"}</SheetTitle>
        <SheetDescription className="font-mono text-xs break-all">{id}</SheetDescription>
      </SheetHeader>
      {error && <div className="p-4 text-sm text-destructive">{error}</div>}
      {!job && !error && (
        <div className="space-y-3 p-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {job && (
        <div className="space-y-5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={job.status} />
            <span className="text-xs text-muted-foreground tabular">
              Attempt {job.attempts}/{job.maxAttempts} · priority {job.priority}
            </span>
            <div className="ml-auto flex gap-2">
              {canRetry(job.status) && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => retryJobAction(job.id), "Job re-queued")}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Retry
                </Button>
              )}
              {canCancel(job.status) && (
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() => cancelJobAction(job.id), "Job cancelled")}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />} Cancel
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-3">
            <Field label="Created">
              <TimeAgo date={job.createdAt} />
            </Field>
            <Field label="Run at">
              <TimeAgo date={job.runAt} />
            </Field>
            <Field label="Started">
              <TimeAgo date={job.startedAt} />
            </Field>
            <Field label="Finished">
              <TimeAgo date={job.finishedAt} />
            </Field>
            <Field label="Duration">
              {formatDuration(
                job.startedAt && job.finishedAt ? new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime() : null,
              )}
            </Field>
            <Field label="Project">
              {job.projectId ? (
                <Link href={`/p/${job.projectId}`} className="hover:underline">
                  {job.projectName ?? job.projectId}
                </Link>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Locked by">
              <span className="font-mono text-xs">{job.lockedBy ?? "—"}</span>
            </Field>
            <Field label="Dedupe key">
              <span className="font-mono text-xs">{job.dedupeKey ?? "—"}</span>
            </Field>
          </div>

          {job.lastError && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold tracking-wider text-destructive uppercase">Last error</div>
              <pre className="max-h-60 overflow-auto rounded-lg border border-destructive/25 bg-destructive/5 p-3 font-mono text-[11.5px] break-words whitespace-pre-wrap text-destructive">
                {job.lastError}
              </pre>
            </div>
          )}
          <JsonView label="Payload" value={job.payload} emptyText="No payload" />
          <JsonView label="Progress" value={job.progress} emptyText="No progress reported" />
          <JsonView label="Result" value={job.result} emptyText={job.status === "succeeded" ? "No result returned" : "No result yet"} />
        </div>
      )}
    </>
  );
}
