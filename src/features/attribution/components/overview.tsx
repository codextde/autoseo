"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Eye,
  Filter,
  LineChart,
  Plug,
  Settings2,
  Sparkles,
  Undo2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { FilterBar, MultiSelect, PeriodSelect, SearchInput } from "@/components/app/filters";
import { StackedBar } from "@/components/app/charts";
import { EmptyState } from "@/components/app/empty-state";
import { Meter } from "@/components/app/metrics";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUrlPatch, useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import type { AttributionDTO, AttributionSummary } from "@/server/attribution/service";
import type { AiTrafficRevenue } from "@/server/attribution/ga4";
import { setResponseStatusAction } from "../actions";
import { AttributionChart } from "./overview-chart";
import { ResponseDrawer } from "./response-drawer";
import { ChannelBadge, contactLabel, money, providerName, shortDate, SourceIcon } from "./shared";

export type OverviewProps = {
  projectId: string;
  canManage: boolean;
  summary: AttributionSummary;
  ga: AiTrafficRevenue;
  items: AttributionDTO[];
  total: number;
  page: number;
  pageSize: number;
  sources: Array<{ value: string; label: string; count: number; provider: string }>;
  hasAnyResponses: boolean;
  setupComplete: boolean;
  filters: { period: string; from?: string; to?: string; view: string; q: string; source: string; analytics: string };
};

const COLUMN_KEYS = ["form", "channel", "contact", "deal", "date"] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
const COLUMN_LABELS: Record<ColumnKey, string> = { form: "Form", channel: "Channel", contact: "Contact", deal: "Deal", date: "Date" };
const COLS_STORAGE = "autoseo.attribution.columns";

const COLS_EVENT = "autoseo:attribution-columns";
function readCols(): string {
  try {
    return window.localStorage.getItem(COLS_STORAGE) ?? "[]";
  } catch {
    return "[]";
  }
}
function writeCols(v: string) {
  try {
    window.localStorage.setItem(COLS_STORAGE, v);
  } catch {
    // storage unavailable (private mode) — keep the in-memory toggle only
  }
  window.dispatchEvent(new Event(COLS_EVENT));
}
function subscribeCols(cb: () => void) {
  window.addEventListener(COLS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(COLS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function DeltaText({ value, format }: { value: number; format: (n: number) => string }) {
  if (!value || Number.isNaN(value)) return null;
  const up = value > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular", up ? "text-success" : "text-destructive")}>
      <Icon className="size-3" />
      {up ? "+" : "−"}
      {format(Math.abs(value))}
    </span>
  );
}

function KpiCard({ label, icon, children, className }: { label: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn("flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-soft", className)}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      {children}
    </motion.div>
  );
}

export function AttributionOverview(props: OverviewProps) {
  const { projectId, summary, ga, canManage, filters } = props;
  const [patch, pending] = useUrlPatch();
  const [openId, setOpenId] = useUrlState("r", "");
  const cur = summary.currency;
  const fmtMoney = (n: number) => money(n, cur);

  /* ───── columns (persisted per browser) ───── */
  const hiddenRaw = useSyncExternalStore(subscribeCols, readCols, () => "[]");
  const hidden = useMemo(() => {
    try {
      return new Set(JSON.parse(hiddenRaw) as ColumnKey[]);
    } catch {
      return new Set<ColumnKey>();
    }
  }, [hiddenRaw]);
  const toggleCol = (k: ColumnKey) => {
    const next = new Set(hidden);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    writeCols(JSON.stringify([...next]));
  };

  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const setStatus = (id: string, status: "active" | "dismissed") => {
    setBusyId(id);
    startTransition(async () => {
      const r = await setResponseStatusAction(projectId, id, status);
      setBusyId(null);
      if (!r.ok) toast.error(r.error);
      else toast.success(status === "dismissed" ? "Response excluded from analytics" : "Response restored");
    });
  };

  const aiShareOfDeals = summary.aiDealShare;
  const dealDelta = summary.aiDealValue - summary.previous.aiDealValue;
  const leadsDelta = summary.aiResponses - summary.previous.aiResponses;
  const gaDeltaPct = ga.connected && ga.previous > 0 ? ((ga.total - ga.previous) / ga.previous) * 100 : null;

  const columns = useMemo<Column<AttributionDTO>[]>(() => {
    const all: Array<Column<AttributionDTO> & { key: ColumnKey | "actions" }> = [
      {
        key: "form",
        id: "form",
        header: "Form",
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <SourceIcon provider={r.provider} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{providerName(r.provider)}</div>
              <div className="truncate text-xs text-muted-foreground">{r.formName ?? (r.provider === "website_widget" ? "Survey popup" : "—")}</div>
            </div>
          </div>
        ),
        className: "max-w-[260px]",
      },
      {
        key: "channel",
        id: "channel",
        header: "Channel",
        cell: (r) => (
          <div className="flex min-w-0 flex-col items-start gap-1">
            <ChannelBadge channel={r.channel} detail={r.channelDetail} />
            {(r.freetext || r.rawAnswer) &&
              ![r.channelLabel, r.channelDetailLabel].some((l) => l && l.toLowerCase() === (r.freetext ?? r.rawAnswer ?? "").toLowerCase()) && (
              <span className="max-w-[220px] truncate text-xs text-muted-foreground" title={r.rawAnswer ?? undefined}>
                “{r.freetext ?? r.rawAnswer}”
              </span>
            )}
          </div>
        ),
      },
      {
        key: "contact",
        id: "contact",
        header: "Contact",
        hideBelow: "md",
        cell: (r) => {
          const c = contactLabel(r.contact);
          return c ? <span className="font-mono text-xs text-muted-foreground">{c}</span> : <span className="text-muted-foreground">—</span>;
        },
      },
      {
        key: "deal",
        id: "deal",
        header: "Deal",
        align: "right",
        sortValue: (r) => r.dealValue ?? -1,
        cell: (r) =>
          r.dealValue != null ? (
            <div className="flex flex-col items-end">
              <span className="font-medium tabular">{money(r.dealValue, r.dealCurrency ?? cur)}</span>
              {r.valueSource === "conversion" && <span className="text-[11px] text-muted-foreground">from {r.conversion?.kind ?? "order"}</span>}
            </div>
          ) : r.conversion ? (
            <Badge variant="outline" className="h-5 text-[11px] font-normal">
              {r.conversion.kind}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "date",
        id: "date",
        header: "Date",
        sortValue: (r) => r.respondedAt,
        hideBelow: "sm",
        cell: (r) => <span className="text-sm whitespace-nowrap text-muted-foreground tabular" suppressHydrationWarning>
            {shortDate(r.respondedAt)}
          </span>,
      },
      {
        key: "actions",
        id: "actions",
        header: <span className="sr-only">Actions</span>,
        align: "right",
        cell: (r) => (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => setOpenId(r.id)}>
              <Eye className="size-3.5" /> View
            </Button>
            {canManage && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={busyId === r.id}
                    aria-label={r.status === "dismissed" ? "Restore" : "Dismiss"}
                    onClick={() => setStatus(r.id, r.status === "dismissed" ? "active" : "dismissed")}
                  >
                    {r.status === "dismissed" ? <Undo2 className="size-3.5" /> : <Ban className="size-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{r.status === "dismissed" ? "Restore to analytics" : "Dismiss (exclude from analytics)"}</TooltipContent>
              </Tooltip>
            )}
          </div>
        ),
      },
    ];
    return all.filter((c) => c.key === "actions" || !hidden.has(c.key as ColumnKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, busyId, canManage, cur]);

  const exportHref = useMemo(() => {
    const p = new URLSearchParams();
    p.set("period", filters.period);
    if (filters.from) p.set("from", filters.from);
    if (filters.to) p.set("to", filters.to);
    p.set("view", filters.view);
    if (filters.q) p.set("q", filters.q);
    if (filters.source) p.set("source", filters.source);
    p.set("analytics", filters.analytics);
    return `/api/attribution/export/${projectId}?${p.toString()}`;
  }, [filters, projectId]);

  const aiCount = summary.aiResponses;
  const from = props.page * props.pageSize;
  const pageCount = Math.max(1, Math.ceil(props.total / props.pageSize));
  const base = `/p/${projectId}/attribution`;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Period + count */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PeriodSelect
            value={filters.period}
            from={filters.from}
            to={filters.to}
            onChange={(p) => patch({ period: p === "30d" ? null : p, from: null, to: null, page: null })}
            onCustom={(r) => patch({ period: "custom", from: r.from, to: r.to, page: null })}
          />
          {pending && <span className="size-1.5 animate-pulse rounded-full bg-brand" aria-label="Loading" />}
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular">
          {summary.responses.toLocaleString("en-US")} responses
        </span>
      </div>

      {!props.hasAnyResponses && (
        <Panel contentClassName="p-0">
          <EmptyState
            icon={Sparkles}
            title={props.setupComplete ? "Waiting for the first response" : "Set up attribution"}
            description={
              props.setupComplete
                ? "Answers from your snippet, forms and integrations appear here as soon as they arrive."
                : "Ask “How did you hear about us?” on your site or connect your forms, CRM and shop — we merge answers with orders to show which revenue AI search drives."
            }
            action={canManage ? { label: props.setupComplete ? "Open setup" : "Start setup", href: `${base}?tab=setup` } : undefined}
          />
        </Panel>
      )}

      {/* Chart */}
      <Panel
        title="AI Search vs. other channels"
        description="Responses per day (bars) and deal value attributed to AI search (line)."
        contentClassName="p-3 sm:p-5"
      >
        <AttributionChart data={summary.timeseries} currency={cur} />
      </Panel>

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Deal Value · AI Search" icon={<Sparkles className="size-3.5 text-brand" />}>
          <div className="mt-2 flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight tabular">{fmtMoney(summary.aiDealValue)}</span>
            <DeltaText value={dealDelta} format={fmtMoney} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground tabular">
            {aiShareOfDeals.toFixed(0)}% of total · {fmtMoney(summary.dealValue)}
          </div>
          <StackedBar
            className="mt-3"
            parts={[
              { key: "ai", value: summary.aiDealValue, color: "var(--brand)", label: "AI Search" },
              { key: "other", value: Math.max(0, summary.otherDealValue), color: "var(--chart-8)", label: "Other" },
            ]}
          />
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-brand" /> AI Search
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-chart-8" /> Other · {fmtMoney(Math.max(0, summary.otherDealValue))}
            </span>
          </div>
          {summary.otherCurrencyDeals > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {summary.otherCurrencyDeals} deal{summary.otherCurrencyDeals === 1 ? "" : "s"} in other currencies not summed (reporting currency {cur}).
            </p>
          )}
        </KpiCard>

        <KpiCard label="AI Traffic Revenue" icon={<LineChart className="size-3.5 text-chart-1" />}>
          {ga.connected ? (
            <>
              <div className="mt-2 flex flex-wrap items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular">{money(ga.total, ga.currency)}</span>
                {gaDeltaPct != null && <DeltaText value={gaDeltaPct} format={(n) => `${n.toFixed(1)}%`} />}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                From AI-referred sessions in GA4 · {ga.sessions.toLocaleString("en-US")} sessions
              </div>
              <Link href={`/p/${projectId}/analytics/traffic`} className="mt-auto pt-3 text-xs font-medium text-foreground/80 hover:underline">
                View human traffic →
              </Link>
            </>
          ) : (
            <div className="mt-2 flex flex-1 flex-col">
              <p className="text-sm text-muted-foreground">
                {ga.status === "pending"
                  ? "Google Analytics is connected — pick a GA4 property to see revenue from AI-referred sessions."
                  : ga.status === "error"
                    ? `Google Analytics sync failed${ga.message ? `: ${ga.message}` : ""}.`
                    : "Connect GA4 to see the revenue of sessions referred by ChatGPT, Perplexity, Claude & co."}
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3 w-fit gap-1.5">
                <Link href={`/p/${projectId}/analytics/traffic?tab=settings`}>
                  <Plug className="size-3.5" /> {ga.status === "missing" ? "Connect GA4" : "Open analytics settings"}
                </Link>
              </Button>
            </div>
          )}
        </KpiCard>

        <KpiCard label="AI Search Leads" icon={<Sparkles className="size-3.5 text-brand" />} className="sm:col-span-2 xl:col-span-1">
          <div className="mt-2 flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight tabular">{summary.aiResponses.toLocaleString("en-US")}</span>
            <DeltaText value={leadsDelta} format={(n) => n.toLocaleString("en-US")} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground tabular">
            of {summary.responses.toLocaleString("en-US")} total · {summary.aiShare.toFixed(1)}%
          </div>
          <Meter className="mt-3" value={summary.aiShare} />
          {summary.byAiDetail.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {summary.byAiDetail.slice(0, 5).map((d) => (
                <span key={d.detail} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground tabular">
                  {d.label} · {d.responses}
                </span>
              ))}
            </div>
          )}
        </KpiCard>
      </div>

      {/* Responses */}
      <Panel
        title="Responses"
        description={`${aiCount.toLocaleString("en-US")} attribution responses collected from AI search · ${summary.responses.toLocaleString("en-US")} in total`}
        actions={
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={filters.view}
              onValueChange={(v) => v && patch({ view: v === "ai" ? null : v, page: null })}
            >
              <ToggleGroupItem value="ai" className="gap-1 px-2.5 text-xs">
                <Sparkles className="size-3" /> AI Search
              </ToggleGroupItem>
              <ToggleGroupItem value="all" className="px-2.5 text-xs">
                All
              </ToggleGroupItem>
            </ToggleGroup>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`${base}?tab=setup`}>
                <Settings2 className="size-3.5" /> Setup
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`${base}?tab=mapping`}>
                <Workflow className="size-3.5" /> Field Mapping
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`${base}?tab=integrations`}>
                <Plug className="size-3.5" /> Integrations
              </Link>
            </Button>
          </>
        }
      >
        <FilterBar
          className="mb-3"
          activeCount={(filters.source ? 1 : 0) + (filters.analytics !== "all" ? 1 : 0)}
          search={<SearchInput value={filters.q} onChange={(v) => patch({ q: v || null, page: null })} placeholder="Search responses, forms, orders or an email…" />}
          right={
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild variant="outline" size="icon" className="size-8">
                    <a href={exportHref} download aria-label="Download CSV">
                      <Download className="size-3.5" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Download CSV (emails stay hashed)</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="size-8" aria-label="Column settings">
                    <Columns3 className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>Columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {COLUMN_KEYS.map((k) => (
                    <DropdownMenuCheckboxItem key={k} checked={!hidden.has(k)} onCheckedChange={() => toggleCol(k)} onSelect={(e) => e.preventDefault()}>
                      {COLUMN_LABELS[k]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        >
          <MultiSelect
            single
            options={props.sources.map((s) => ({ value: s.value, label: s.label, count: s.count }))}
            value={filters.source ? [filters.source] : []}
            onChange={(v) => patch({ source: v[0] ?? null, page: null })}
            placeholder="All sources"
            icon={<Filter className="size-3.5 text-muted-foreground" />}
            className="min-w-36"
          />
          <Select value={filters.analytics} onValueChange={(v) => patch({ analytics: v === "all" ? null : v, page: null })}>
            <SelectTrigger size="sm" className="h-8 min-w-36 bg-background text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Analytics: all</SelectItem>
              <SelectItem value="included">Analytics: included</SelectItem>
              <SelectItem value="dismissed">Analytics: dismissed</SelectItem>
            </SelectContent>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          data={props.items}
          getRowId={(r) => r.id}
          paginate={false}
          onRowClick={(r) => setOpenId(r.id)}
          rowClassName={(r) => (r.status === "dismissed" ? "opacity-55" : undefined)}
          empty={
            <EmptyState
              compact
              icon={Sparkles}
              title={filters.view === "ai" ? "No AI search responses in this period" : "No responses in this period"}
              description={filters.view === "ai" ? "Switch to “All” to see every channel, or widen the date range." : "Widen the date range or clear the filters."}
            />
          }
          mobileCard={(r) => (
            <div className="flex items-start gap-3">
              <SourceIcon provider={r.provider} size="md" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{r.formName ?? providerName(r.provider)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
                    {shortDate(r.respondedAt)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ChannelBadge channel={r.channel} detail={r.channelDetail} />
                  {r.dealValue != null && <span className="text-sm font-medium tabular">{money(r.dealValue, r.dealCurrency ?? cur)}</span>}
                  {r.status === "dismissed" && <Badge variant="outline" className="h-5 text-[10px]">Dismissed</Badge>}
                </div>
                {contactLabel(r.contact) && <div className="truncate font-mono text-[11px] text-muted-foreground">{contactLabel(r.contact)}</div>}
              </div>
            </div>
          )}
        />
        {props.total > props.pageSize && (
          <div className="mt-3 flex flex-col items-center justify-between gap-2 text-xs text-muted-foreground sm:flex-row">
            <span className="tabular">
              Showing {from + 1} to {Math.min(props.total, from + props.pageSize)} of {props.total.toLocaleString("en-US")}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-7" disabled={props.page <= 0} onClick={() => patch({ page: props.page - 1 > 0 ? String(props.page - 1) : null })}>
                <ChevronLeft className="size-3.5" /> Previous
              </Button>
              <span className="px-2 tabular">
                {props.page + 1} / {pageCount}
              </span>
              <Button variant="outline" size="sm" className="h-7" disabled={props.page >= pageCount - 1} onClick={() => patch({ page: String(props.page + 1) })}>
                Next <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <ResponseDrawer projectId={projectId} id={openId || null} canManage={canManage} onClose={() => setOpenId(null)} />
    </div>
  );
}
