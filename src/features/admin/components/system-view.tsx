"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bug,
  CalendarClock,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  HardDrive,
  Inbox,
  Lightbulb,
  Loader2,
  MessageSquare,
  RefreshCcw,
  Server,
  Trash2,
  Wrench,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/app/page";
import { StatCard } from "@/components/app/metrics";
import { ConfirmButton, CopyButton, TimeAgo } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable, type Column } from "@/components/app/data-table";
import { cn } from "@/lib/utils";
import type { FeedbackRow, SystemInfo } from "@/server/admin/system";
import { clearCachesAction, deleteFeedbackAction, runMaintenanceAction } from "../actions/system";

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function InfoGrid({ items }: { items: { label: string; value: React.ReactNode; mono?: boolean; copy?: string }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{i.label}</dt>
          <dd className={cn("flex min-w-0 items-center gap-1 text-sm", i.mono && "font-mono text-[12.5px]")}>
            <span className="truncate">{i.value}</span>
            {i.copy && <CopyButton value={i.copy} size="icon" className="size-6" />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type TableRow = SystemInfo["database"]["tables"][number];

export function SystemView({ info, feedback }: { info: SystemInfo; feedback: FeedbackRow[] }) {
  const [showAllTables, setShowAllTables] = useState(false);
  const { app, database, migrations, dataDir, worker } = info;
  const tables = showAllTables ? database.tables : database.tables.slice(0, 12);
  const totalRows = database.tables.reduce((a, t) => a + t.rows, 0);

  const tableColumns: Column<TableRow>[] = [
    { id: "name", header: "Table", cell: (t) => <span className="font-mono text-[12.5px]">{t.name}</span>, sortValue: (t) => t.name },
    { id: "rows", header: "Rows (est.)", align: "right", cell: (t) => t.rows.toLocaleString(), sortValue: (t) => t.rows },
    { id: "bytes", header: "Size", align: "right", cell: (t) => formatBytes(t.bytes), sortValue: (t) => t.bytes },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Version"
          icon={<Server className="size-3.5" />}
          value={<span className="text-xl">v{app.version}</span>}
          footer={<span className="font-mono">{app.commit === "dev" ? "development build" : app.commit.slice(0, 12)}</span>}
        />
        <StatCard label="Database" icon={<Database className="size-3.5" />} value={<span className="text-xl">{formatBytes(database.sizeBytes)}</span>} footer={`${database.tables.length} tables · ~${totalRows.toLocaleString()} rows`} />
        <StatCard
          label="Data directory"
          icon={<HardDrive className="size-3.5" />}
          value={<span className="text-xl">{formatBytes(dataDir.total.bytes)}</span>}
          footer={`${dataDir.total.files.toLocaleString()}${dataDir.total.truncated ? "+" : ""} files`}
        />
        <StatCard label="Uptime" icon={<Cpu className="size-3.5" />} value={<span className="text-xl">{formatUptime(app.uptimeSeconds)}</span>} footer={`${formatBytes(app.memoryRss)} memory`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Instance" icon={<Server className="size-4 text-muted-foreground" />}>
          <InfoGrid
            items={[
              { label: "Public URL", value: app.appUrl, mono: true, copy: app.appUrl },
              { label: "Domain (.env DOMAIN)", value: app.domain, mono: true },
              { label: "Version", value: `v${app.version}` },
              { label: "Commit", value: app.commit, mono: true, copy: app.commit !== "dev" ? app.commit : undefined },
              { label: "Build date", value: new Date(app.buildDate).getTime() > 0 ? new Date(app.buildDate).toLocaleString() : "—" },
              { label: "Environment", value: app.nodeEnv },
              { label: "Node.js", value: app.nodeVersion, mono: true },
              { label: "Host", value: `${app.hostname} · ${app.platform}` },
            ]}
          />
        </Panel>

        <Panel title="Database" icon={<Database className="size-4 text-muted-foreground" />}>
          <InfoGrid
            items={[
              { label: "Server", value: database.version },
              { label: "Database", value: database.name, mono: true },
              { label: "Size", value: formatBytes(database.sizeBytes) },
              {
                label: "Schema",
                value:
                  migrations.mode === "push" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle2 className="size-3.5 text-success" /> Development — schema synced with db:push
                    </span>
                  ) : migrations.pending.length ? (
                    <span className="inline-flex items-center gap-1.5 text-warning">
                      <AlertTriangle className="size-3.5" /> {migrations.pending.length} pending migration(s)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle2 className="size-3.5 text-success" /> Up to date
                    </span>
                  ),
              },
              { label: "Applied migrations", value: `${migrations.appliedCount} of ${migrations.journalCount} in journal` },
              { label: "Last applied", value: migrations.lastAppliedAt ? new Date(migrations.lastAppliedAt).toLocaleString() : "—" },
            ]}
          />
          {migrations.pending.length > 0 && (
            <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
              Pending: {migrations.pending.join(", ")} — they are applied automatically on the next restart.
            </p>
          )}
        </Panel>
      </div>

      <Panel
        title="Tables"
        description="Estimated live rows from pg_stat_user_tables (updated by autovacuum/analyze)."
        actions={
          database.tables.length > 12 && (
            <Button variant="ghost" size="sm" onClick={() => setShowAllTables((v) => !v)}>
              {showAllTables ? "Show top 12" : `Show all ${database.tables.length}`}
            </Button>
          )
        }
        contentClassName="p-0 sm:p-0"
      >
        <DataTable
          columns={tableColumns}
          data={tables}
          getRowId={(t) => t.name}
          paginate={false}
          dense
          stickyHeader={false}
          className="[&>div]:rounded-none [&>div]:border-0"
          mobileCard={(t) => (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate font-mono text-[12.5px]">{t.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular">
                {t.rows.toLocaleString()} rows · {formatBytes(t.bytes)}
              </span>
            </div>
          )}
        />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Data directory" description={dataDir.path} icon={<HardDrive className="size-4 text-muted-foreground" />}>
          {!dataDir.exists ? (
            <p className="text-sm text-muted-foreground">The data directory does not exist yet.</p>
          ) : (
            <ul className="space-y-2">
              {dataDir.top.map((e) => {
                const pct = dataDir.total.bytes ? (e.bytes / dataDir.total.bytes) * 100 : 0;
                return (
                  <li key={e.name} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-mono text-[12.5px]">{e.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular">
                        {formatBytes(e.bytes)} · {e.files.toLocaleString()} files
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-chart-3" style={{ width: `${Math.max(1, pct)}%` }} />
                    </div>
                  </li>
                );
              })}
              {dataDir.top.length === 0 && <li className="text-sm text-muted-foreground">Empty.</li>}
            </ul>
          )}
        </Panel>

        <Panel
          title="Background worker"
          description={`${worker.handlers.length} job types · ${worker.schedules.length} schedules (UTC)`}
          icon={<CalendarClock className="size-4 text-muted-foreground" />}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/jobs">Open queue</Link>
            </Button>
          }
        >
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Schedules</div>
              {worker.schedules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No schedules registered.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {worker.schedules.map((s) => (
                    <li key={s.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2">
                      <span className="min-w-0 truncate font-mono text-[12.5px]">{s.name}</span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <code className="rounded bg-muted px-1.5 py-0.5">{s.cron}</code>
                        {s.nextRun && (
                          <span>
                            next <TimeAgo date={s.nextRun} />
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Job types</div>
              <div className="flex flex-wrap gap-1.5">
                {worker.handlers.map((h) => (
                  <Link key={h.type} href={`/admin/jobs?type=${encodeURIComponent(h.type)}`}>
                    <Badge variant="outline" className="h-6 gap-1 font-mono text-[11px] font-normal hover:bg-muted" title={`concurrency ${h.concurrency} · timeout ${Math.round(h.timeoutMs / 60000)} min${h.retryable ? "" : " · no retries"}`}>
                      {h.type}
                      <span className="text-muted-foreground">×{h.concurrency}</span>
                    </Badge>
                  </Link>
                ))}
                {worker.handlers.length === 0 && <p className="text-sm text-muted-foreground">No job handlers registered.</p>}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <FeedbackInbox rows={feedback} />

      <DangerZone />
    </div>
  );
}

const KIND_META: Record<string, { label: string; icon: typeof Bug; cls: string }> = {
  bug: { label: "Bug", icon: Bug, cls: "bg-destructive/10 text-destructive" },
  idea: { label: "Idea", icon: Lightbulb, cls: "bg-warning/15 text-warning" },
  feedback: { label: "Feedback", icon: MessageSquare, cls: "bg-info/12 text-info" },
};

function FeedbackInbox({ rows }: { rows: FeedbackRow[] }) {
  const [items, setItems] = useState(rows);
  const [busy, setBusy] = useState<string | null>(null);
  const remove = async (ids: string[]) => {
    setBusy(ids.length === 1 ? ids[0]! : "all");
    try {
      const res = await deleteFeedbackAction(ids);
      if (!res.ok) return void toast.error(res.error);
      setItems((prev) => prev.filter((r) => !ids.includes(r.id)));
      toast.success(ids.length === 1 ? "Feedback deleted" : `${res.data} items deleted`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel
      title="Feedback inbox"
      description="Messages sent with the feedback button in the top bar."
      icon={<Inbox className="size-4 text-muted-foreground" />}
      actions={
        items.length > 0 && (
          <ConfirmButton
            title="Delete all feedback?"
            description={`This permanently deletes ${items.length} message(s).`}
            confirmLabel="Delete all"
            destructive
            onConfirm={() => remove(items.map((i) => i.id))}
          >
            <Button variant="ghost" size="sm" disabled={busy !== null}>
              <Trash2 className="size-3.5" /> Clear inbox
            </Button>
          </ConfirmButton>
        )
      }
    >
      {items.length === 0 ? (
        <EmptyState icon={Inbox} title="Inbox zero" description="No feedback yet. Users can send bugs, ideas and feedback from the top bar." compact />
      ) : (
        <ul className="-my-2 divide-y">
          {items.map((f) => {
            const meta = KIND_META[f.kind] ?? KIND_META.feedback!;
            const Icon = meta.icon;
            return (
              <li key={f.id} className="flex gap-3 py-3">
                <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", meta.cls)}>
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{f.userName || f.userEmail || "Deleted user"}</span>
                    {f.userEmail && f.userName && <span className="truncate">{f.userEmail}</span>}
                    <span>·</span>
                    <TimeAgo date={f.createdAt} />
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                      {meta.label}
                    </Badge>
                  </div>
                  <p className="text-sm break-words whitespace-pre-wrap">{f.message}</p>
                  {(f.path || f.projectName) && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {f.projectName && <span>{f.projectName}</span>}
                      {f.path && f.path.startsWith("/") && !f.path.startsWith("//") && (
                        <Link href={f.path} className="inline-flex max-w-full items-center gap-1 truncate font-mono hover:text-foreground">
                          <ExternalLink className="size-3 shrink-0" />
                          <span className="truncate">{f.path}</span>
                        </Link>
                      )}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  title="Delete"
                  disabled={busy !== null}
                  onClick={() => remove([f.id])}
                >
                  {busy === f.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function DangerZone() {
  const [busy, setBusy] = useState<"cache" | "maint" | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  return (
    <Panel title="Maintenance" description="Operational actions. Safe to run at any time." icon={<Wrench className="size-4 text-muted-foreground" />} className="border-destructive/25">
      <div className="divide-y">
        <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Clear caches</p>
            <p className="text-xs text-muted-foreground">Reloads settings from the database and empties the favicon cache (icons are re-fetched on demand).</p>
          </div>
          <ConfirmButton
            title="Clear caches?"
            description="Settings are re-read from the database and cached favicons are deleted."
            confirmLabel="Clear caches"
            onConfirm={async () => {
              setBusy("cache");
              try {
                const res = await clearCachesAction();
                if (!res.ok) return void toast.error(res.error);
                toast.success(`Caches cleared (${res.data.favicons} favicon files removed)`);
              } finally {
                setBusy(null);
              }
            }}
          >
            <Button variant="outline" size="sm" className="shrink-0" disabled={busy !== null}>
              {busy === "cache" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />} Clear caches
            </Button>
          </ConfirmButton>
        </div>
        <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Run maintenance now</p>
            <p className="text-xs text-muted-foreground">
              Purges expired sign-in tokens and sessions, expires invitations and pitch projects, prunes old audit entries and finished jobs.
              Runs automatically every hour / night.
            </p>
            {jobId && (
              <Link href={`/admin/jobs?type=core.maintenance`} className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
                View job <span className="font-mono">{jobId}</span>
              </Link>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("maint");
              try {
                const res = await runMaintenanceAction();
                if (!res.ok) return void toast.error(res.error);
                if (res.data.alreadyQueued) toast.info("Maintenance is already queued.");
                else {
                  setJobId(res.data.jobId);
                  toast.success("Maintenance job queued");
                }
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "maint" ? <Loader2 className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />} Run now
          </Button>
        </div>
      </div>
    </Panel>
  );
}
