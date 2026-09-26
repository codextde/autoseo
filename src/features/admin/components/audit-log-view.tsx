"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, FileText, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/app/data-table";
import { FilterBar, MultiSelect, PeriodSelect, SearchInput } from "@/components/app/filters";
import { TimeAgo } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { Panel } from "@/components/app/page";
import { useUrlPatch } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import type { AuditRow } from "@/server/admin/audit-log";
import { AUDIT_CATEGORIES, auditActionLabel } from "../audit-labels";
import { JsonView } from "./jobs-json-view";
import { NumberInput, Rows, SaveBar, SettingRow, useSettingsForm } from "./settings-kit";

type Facet = { value: string; count: number };

export type AuditViewProps = {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  facets: { categories: Facet[]; targetTypes: Facet[]; oldest: string | null; total: number };
  filters: { period: string; cat: string; actor: string; target: string; q: string; from: string; to: string };
};

const PERIODS = [
  { key: "1d", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "all", label: "All" },
];

const CATEGORY_TONE: Record<string, string> = {
  auth: "bg-info/12 text-info",
  settings: "bg-chart-4/12 text-chart-4",
  invitation: "bg-brand-soft text-brand",
  member: "bg-brand-soft text-brand",
  user: "bg-warning/15 text-warning",
  role: "bg-chart-1/12 text-chart-1",
  project: "bg-chart-3/12 text-chart-3",
  workspace: "bg-chart-3/12 text-chart-3",
};

function categoryOf(action: string) {
  return action.split(".")[0] ?? action;
}

function DiffTable({ diff }: { diff: Record<string, { from: unknown; to: unknown }> }) {
  const entries = Object.entries(diff);
  if (!entries.length) return null;
  const show = (v: unknown) => (typeof v === "string" ? v || "“”" : JSON.stringify(v));
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Field</th>
            <th className="px-3 py-1.5 text-left font-medium">Before</th>
            <th className="px-3 py-1.5 text-left font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-t align-top">
              <td className="px-3 py-1.5 font-mono font-medium">{k}</td>
              <td className="max-w-64 px-3 py-1.5 font-mono break-all text-destructive/90 line-through decoration-destructive/40">{show(v.from)}</td>
              <td className="max-w-64 px-3 py-1.5 font-mono break-all text-success">{show(v.to)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Expanded({ row }: { row: AuditRow }) {
  const meta = row.meta ?? {};
  const diff = (meta as { diff?: Record<string, { from: unknown; to: unknown }> }).diff;
  const secretsChanged = (meta as { secretsChanged?: string[] }).secretsChanged;
  const rest = { ...meta } as Record<string, unknown>;
  delete rest.diff;
  return (
    <div className="space-y-3 p-3 sm:p-4">
      <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <div>
          <span className="text-muted-foreground">Event id </span>
          <span className="font-mono">{row.id}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Time </span>
          {new Date(row.createdAt).toLocaleString()}
        </div>
        {row.ip && (
          <div>
            <span className="text-muted-foreground">IP </span>
            <span className="font-mono">{row.ip}</span>
          </div>
        )}
        {row.workspaceName && (
          <div>
            <span className="text-muted-foreground">Workspace </span>
            {row.workspaceName}
          </div>
        )}
      </div>
      {diff && <DiffTable diff={diff} />}
      {secretsChanged && secretsChanged.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-success" /> Secrets changed (values never logged):
          {secretsChanged.map((s) => (
            <Badge key={s} variant="outline" className="font-mono text-[10px]">
              {s}
            </Badge>
          ))}
        </p>
      )}
      <JsonView label="Details" value={rest} emptyText="No additional details" maxHeight={240} />
    </div>
  );
}

export function AuditLogView({ items, total, page, pageSize, facets, filters }: AuditViewProps) {
  const [patch, pending] = useUrlPatch();
  const params = useSearchParams();
  const exportHref = `/admin/audit-log/export${params.toString() ? `?${params.toString()}` : ""}`;

  const categoryOptions = (() => {
    const known = new Map<string, string>(AUDIT_CATEGORIES.map((c) => [c.key, c.label]));
    const seen = new Set<string>();
    const out: { value: string; label: string; count?: number }[] = [];
    for (const f of facets.categories) {
      out.push({ value: f.value, label: known.get(f.value) ?? f.value, count: f.count });
      seen.add(f.value);
    }
    for (const c of AUDIT_CATEGORIES) if (!seen.has(c.key)) out.push({ value: c.key, label: c.label, count: 0 });
    return out;
  })();

  const columns: Column<AuditRow>[] = [
    {
      id: "time",
      header: "Time",
      width: "120px",
      cell: (r) => <TimeAgo date={r.createdAt} className="text-sm text-muted-foreground" />,
    },
    {
      id: "actor",
      header: "Actor",
      cell: (r) =>
        r.actorEmail ? (
          <span className="block max-w-56 truncate text-sm">{r.actorEmail}</span>
        ) : (
          <span className="text-sm text-muted-foreground">System</span>
        ),
    },
    {
      id: "action",
      header: "Action",
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
              CATEGORY_TONE[categoryOf(r.action)] ?? "bg-muted text-muted-foreground",
            )}
          >
            {categoryOf(r.action)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{auditActionLabel(r.action)}</span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">{r.action}</span>
          </span>
        </div>
      ),
    },
    {
      id: "target",
      header: "Target",
      hideBelow: "md",
      cell: (r) => (
        <div className="min-w-0 text-sm">
          {r.projectName ? (
            <Link href={`/p/${r.projectId}`} className="block max-w-48 truncate hover:underline">
              {r.projectName}
            </Link>
          ) : r.targetType ? (
            <span className="block max-w-48 truncate">
              <span className="text-muted-foreground">{r.targetType}</span>{" "}
              <span className="font-mono text-xs">{r.targetId}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    { id: "ip", header: "IP", hideBelow: "lg", cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.ip ?? "—"}</span> },
  ];

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <FilterBar
        activeCount={[filters.cat, filters.target, filters.actor].filter(Boolean).length}
        search={<SearchInput value={filters.q} onChange={(v) => patch({ q: v || null, page: null })} placeholder="Search actions, targets, details…" />}
        right={
          <div className="flex items-center gap-2">
            {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
              <a href={exportHref} download>
                <Download className="size-3.5" /> <span className="hidden sm:inline">Export</span> CSV
              </a>
            </Button>
          </div>
        }
      >
        <PeriodSelect
          value={filters.period}
          presets={PERIODS}
          from={filters.from || undefined}
          to={filters.to || undefined}
          onChange={(p) => patch({ period: p === "30d" ? null : p, from: null, to: null, page: null })}
          onCustom={(r) => patch({ period: "custom", from: r.from, to: r.to, page: null })}
        />
        <MultiSelect
          single
          label="Category"
          placeholder="All categories"
          options={categoryOptions}
          value={filters.cat ? [filters.cat] : []}
          onChange={(v) => patch({ cat: v[0] ?? null, page: null })}
          className="min-w-36"
        />
        <MultiSelect
          single
          label="Target"
          placeholder="All targets"
          options={facets.targetTypes.map((t) => ({ value: t.value, label: t.value, count: t.count }))}
          value={filters.target ? [filters.target] : []}
          onChange={(v) => patch({ target: v[0] ?? null, page: null })}
          className="min-w-32"
        />
        <SearchInput
          value={filters.actor}
          onChange={(v) => patch({ actor: v || null, page: null })}
          placeholder="Actor email…"
          className="w-full sm:w-44"
        />
      </FilterBar>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="tabular">
          {total.toLocaleString()} event{total === 1 ? "" : "s"}
        </span>
        {facets.oldest && (
          <span>
            Oldest entry <TimeAgo date={facets.oldest} />
          </span>
        )}
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(r) => r.id}
        paginate={false}
        dense
        renderExpanded={(r) => <Expanded row={r} />}
        empty={
          <EmptyState
            icon={FileText}
            title="No audit events"
            description="Nothing matches these filters. Sign-ins, settings changes, invitations and project changes are recorded here."
            compact
          />
        }
        mobileCard={(r) => (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{auditActionLabel(r.action)}</div>
                <div className="truncate text-xs text-muted-foreground">{r.actorEmail ?? "System"}</div>
              </div>
              <TimeAgo date={r.createdAt} className="shrink-0 text-xs text-muted-foreground" />
            </summary>
            <div className="-mx-3 mt-2 border-t">
              <Expanded row={r} />
            </div>
          </details>
        )}
      />

      {total > pageSize && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular">
            {(page * pageSize + 1).toLocaleString()}–{Math.min(total, (page + 1) * pageSize).toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7" disabled={page <= 0} onClick={() => patch({ page: page - 1 > 0 ? String(page - 1) : null })}>
              <ChevronLeft className="size-3.5" /> Prev
            </Button>
            <span className="px-2 tabular">
              {page + 1} / {pageCount}
            </span>
            <Button variant="outline" size="sm" className="h-7" disabled={page >= pageCount - 1} onClick={() => patch({ page: String(page + 1) })}>
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type SecurityValues = { allowIframeEmbedding: boolean; apiRateLimitPerMinute: number; auditLogRetentionDays: number; jobRetentionDays: number };

export function AuditRetentionPanel({ initial, totalEvents }: { initial: { values: SecurityValues; secrets: Record<string, boolean> }; totalEvents: number }) {
  const form = useSettingsForm<SecurityValues>("security", initial);
  return (
    <>
      <Panel title="Retention" description="Older entries are deleted by the daily maintenance job (03:40 UTC).">
        <Rows>
          <SettingRow
            label="Keep audit log entries for"
            description={`Minimum 7 days. ${totalEvents.toLocaleString()} entries are currently stored.`}
            htmlFor="audit-retention"
          >
            <NumberInput
              id="audit-retention"
              value={form.values.auditLogRetentionDays}
              onChange={(v) => form.set("auditLogRetentionDays", v)}
              min={7}
              max={3650}
              suffix="days"
            />
          </SettingRow>
        </Rows>
      </Panel>
      <SaveBar dirty={form.dirty} saving={form.saving} onSave={() => void form.save()} onReset={form.reset} count={form.changedCount} />
    </>
  );
}
