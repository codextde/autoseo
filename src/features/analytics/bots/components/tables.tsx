"use client";

import { ExternalLink } from "lucide-react";
import { DataTable, type Column, type SortState } from "@/components/app/data-table";
import { FilterBar, MultiSelect, SearchInput } from "@/components/app/filters";
import { TimeAgo } from "@/components/app/misc";
import { formatNumber } from "@/components/app/metrics";
import { Panel } from "@/components/app/page";
import { useUrlPatch, useUrlState, useUrlListState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import type { CrawledPage, PerformanceRow } from "@/server/analytics/bots/queries";
import { BotAvatar, BotStack } from "./bot-avatar";

type BotOption = { bot: string; visits: number };

function pageUrl(path: string, host: string | null, domain: string) {
  const h = host || domain;
  return `https://${h}${path.startsWith("/") ? path : `/${path}`}`;
}

function PageCell({ path, host, domain }: { path: string; host: string | null; domain: string }) {
  return (
    <a
      href={pageUrl(path, host, domain)}
      target="_blank"
      rel="noreferrer noopener"
      className="group inline-flex max-w-[28rem] items-center gap-1.5 font-medium hover:underline"
      title={pageUrl(path, host, domain)}
    >
      <span className="truncate">{path}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
    </a>
  );
}

function useTableUrlState(defaultSort: string) {
  const [patch, pending] = useUrlPatch();
  const [q] = useUrlState("q", "");
  const [bots] = useUrlListState("bots");
  const [status] = useUrlListState("status");
  const [sortId] = useUrlState("sort", defaultSort);
  const [dir] = useUrlState("dir", "desc");
  const [page] = useUrlState("page", "0");
  const sort: SortState = { id: sortId, dir: dir === "asc" ? "asc" : "desc" };
  return {
    q,
    bots,
    status,
    sort,
    page: Math.max(0, Number(page) || 0),
    pending,
    set: (v: Record<string, string | null>) => patch({ ...v, page: "page" in v ? v.page : null }),
  };
}

function botOptions(bots: BotOption[]) {
  return bots.map((b) => ({ value: b.bot, label: b.bot, count: b.visits, icon: <BotAvatar bot={b.bot} size="xs" withTooltip={false} /> }));
}

export function CrawledPagesTable({
  rows,
  total,
  pageSize,
  seenBots,
  domain,
}: {
  rows: CrawledPage[];
  total: number;
  pageSize: number;
  seenBots: BotOption[];
  domain: string;
}) {
  const s = useTableUrlState("visits");
  const columns: Column<CrawledPage>[] = [
    { id: "path", header: "Page", cell: (r) => <PageCell path={r.path} host={r.host} domain={domain} />, sortable: true },
    { id: "bots", header: "Bots", cell: (r) => <BotStack bots={r.bots} max={5} /> },
    { id: "visits", header: "Visits", cell: (r) => <span className="tabular">{formatNumber(r.visits)}</span>, align: "right", sortable: true },
    {
      id: "last",
      header: "Last Visited",
      cell: (r) => <TimeAgo date={r.lastVisited} className="text-muted-foreground" />,
      align: "right",
      sortable: true,
      hideBelow: "md",
    },
  ];
  return (
    <Panel
      title="Crawled Pages"
      description={`${formatNumber(total)} page${total === 1 ? "" : "s"} visited by crawlers`}
      contentClassName={cn("space-y-3 p-3 sm:p-4", s.pending && "opacity-70")}
    >
      <FilterBar
        search={<SearchInput value={s.q} onChange={(v) => s.set({ q: v || null })} placeholder="Search pages…" />}
        activeCount={s.bots.length}
      >
        <MultiSelect
          options={botOptions(seenBots)}
          value={s.bots}
          onChange={(v) => s.set({ bots: v.length ? v.join(",") : null })}
          placeholder="Filter Bots"
          label="Bots"
        />
      </FilterBar>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.path}
        sort={s.sort}
        onSortChange={(v) => s.set({ sort: v && v.id !== "visits" ? v.id : null, dir: v?.dir === "asc" ? "asc" : null })}
        total={total}
        page={s.page}
        pageSize={pageSize}
        onPageChange={(p) => s.set({ page: p ? String(p) : null })}
        empty={<p className="py-10 text-center text-sm text-muted-foreground">No crawled pages match these filters.</p>}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <PageCell path={r.path} host={r.host} domain={domain} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <BotStack bots={r.bots} max={5} />
              <span className="tabular">{formatNumber(r.visits)} visits</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Last visited <TimeAgo date={r.lastVisited} />
            </div>
          </div>
        )}
      />
    </Panel>
  );
}

const STATUS_CLASSES = [
  { value: "2xx", label: "2xx Success" },
  { value: "3xx", label: "3xx Redirect" },
  { value: "4xx", label: "4xx Client error" },
  { value: "5xx", label: "5xx Server error" },
];

function statusTone(status: string) {
  const c = status[0];
  if (c === "2") return "bg-success/12 text-success ring-success/25";
  if (c === "3") return "bg-info/12 text-info ring-info/25";
  if (c === "4") return "bg-warning/15 text-warning ring-warning/30";
  if (c === "5") return "bg-destructive/10 text-destructive ring-destructive/25";
  return "bg-muted text-muted-foreground ring-border";
}

export function StatusChip({ status, count, className }: { status: string; count: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset tabular", statusTone(status), className)}>
      {status}: {formatNumber(count)}
    </span>
  );
}

export function PerformanceTable({
  rows,
  total,
  pageSize,
  seenBots,
  summary,
  domain,
}: {
  rows: PerformanceRow[];
  total: number;
  pageSize: number;
  seenBots: BotOption[];
  summary: { status: string; count: number }[];
  domain: string;
}) {
  const s = useTableUrlState("total");
  const totalVisits = summary.reduce((a, b) => a + b.count, 0);
  const errors = summary.filter((x) => Number(x.status) >= 400).reduce((a, b) => a + b.count, 0);
  const columns: Column<PerformanceRow>[] = [
    { id: "path", header: "Page URL", cell: (r) => <PageCell path={r.path} host={r.host} domain={domain} />, sortable: true },
    { id: "bots", header: "Bots", cell: (r) => <BotStack bots={r.bots} max={4} />, hideBelow: "md" },
    {
      id: "breakdown",
      header: "Status Breakdown",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.breakdown.slice(0, 4).map((b) => (
            <StatusChip key={b.status} status={b.status} count={b.count} />
          ))}
          {r.breakdown.length > 4 && <span className="text-[11px] text-muted-foreground">+{r.breakdown.length - 4}</span>}
        </div>
      ),
    },
    {
      id: "errors",
      header: "Errors",
      cell: (r) => <span className={cn("tabular", r.errors > 0 ? "font-medium text-destructive" : "text-muted-foreground")}>{formatNumber(r.errors)}</span>,
      align: "right",
      sortable: true,
    },
    { id: "total", header: "Total Visits", cell: (r) => <span className="tabular">{formatNumber(r.total)}</span>, align: "right", sortable: true },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3 shadow-soft">
        <span className="mr-1 text-xs text-muted-foreground">
          <b className="text-foreground tabular">{formatNumber(totalVisits)}</b> visits ·{" "}
          <b className={cn("tabular", errors ? "text-destructive" : "text-foreground")}>{formatNumber(errors)}</b> errors
        </span>
        {summary.map((x) => (
          <StatusChip key={x.status} status={x.status} count={x.count} />
        ))}
        {!summary.length && <span className="text-xs text-muted-foreground">No requests in this period.</span>}
      </div>
      <Panel title="Performance" description="How your pages respond to AI crawlers" contentClassName={cn("space-y-3 p-3 sm:p-4", s.pending && "opacity-70")}>
        <FilterBar
          search={<SearchInput value={s.q} onChange={(v) => s.set({ q: v || null })} placeholder="Search pages…" />}
          activeCount={s.bots.length + s.status.length}
        >
          <MultiSelect
            options={botOptions(seenBots)}
            value={s.bots}
            onChange={(v) => s.set({ bots: v.length ? v.join(",") : null })}
            placeholder="Filter Bots"
            label="Bots"
          />
          <MultiSelect
            options={STATUS_CLASSES}
            value={s.status}
            onChange={(v) => s.set({ status: v.length ? v.join(",") : null })}
            placeholder="Filter Status"
            label="Status"
            searchable={false}
          />
        </FilterBar>
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(r) => r.path}
          sort={s.sort}
          onSortChange={(v) => s.set({ sort: v && v.id !== "total" ? v.id : null, dir: v?.dir === "asc" ? "asc" : null })}
          total={total}
          page={s.page}
          pageSize={pageSize}
          onPageChange={(p) => s.set({ page: p ? String(p) : null })}
          empty={<p className="py-10 text-center text-sm text-muted-foreground">No pages match these filters.</p>}
          mobileCard={(r) => (
            <div className="space-y-1.5">
              <PageCell path={r.path} host={r.host} domain={domain} />
              <div className="flex flex-wrap gap-1">
                {r.breakdown.slice(0, 4).map((b) => (
                  <StatusChip key={b.status} status={b.status} count={b.count} />
                ))}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <BotStack bots={r.bots} max={5} />
                <span className="tabular">
                  {formatNumber(r.total)} visits{r.errors ? ` · ${formatNumber(r.errors)} errors` : ""}
                </span>
              </div>
            </div>
          )}
        />
      </Panel>
    </div>
  );
}
