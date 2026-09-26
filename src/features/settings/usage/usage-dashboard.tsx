"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Activity, CalendarDays, Coins, Gauge, Receipt, Wallet } from "lucide-react";
import { Panel } from "@/components/app/page";
import { StatCard, Meter, formatNumber } from "@/components/app/metrics";
import { BarsChart, DonutChart, RankedBars, CHART_COLORS } from "@/components/app/charts";
import { DataTable, type Column } from "@/components/app/data-table";
import { PeriodSelect } from "@/components/app/filters";
import { EmptyState } from "@/components/app/empty-state";
import { Favicon } from "@/components/app/favicon";
import { useUrlPatch } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import type { BudgetStatus, UsageSummary } from "@/server/admin/usage";
import { featureLabel, formatUsd, providerLabel } from "./labels";
import { Segmented } from "../account/segmented";

type ProjectRow = UsageSummary["byProject"][number];

export function UsageDashboard({
  summary,
  budget,
  period,
  from,
  to,
  scope,
  canSwitchScope,
  isAdmin,
}: {
  summary: UsageSummary;
  /** Instance-wide budgets — only passed for instance admins. */
  budget: BudgetStatus | null;
  period: string;
  from?: string;
  to?: string;
  scope: "workspace" | "instance";
  canSwitchScope: boolean;
  isAdmin: boolean;
}) {
  const [patch] = useUrlPatch();
  const hasData = summary.totals.events > 0;
  const chartData = useMemo(() => summary.byDay.map((d) => ({ date: d.date, cost: Number(d.cost.toFixed(4)) })), [summary.byDay]);
  const providers = summary.byProvider.map((p, i) => ({
    name: providerLabel(p.key),
    value: Number(p.cost.toFixed(4)),
    color: CHART_COLORS[i % CHART_COLORS.length],
    events: p.events,
  }));
  const totalCost = summary.totals.cost;

  const projectColumns: Column<ProjectRow>[] = [
    {
      id: "project",
      header: "Project",
      sortValue: (r) => r.name ?? "",
      cell: (r) =>
        r.key === "__other" ? (
          <span className="text-muted-foreground">{r.name}</span>
        ) : r.key ? (
          <Link href={`/p/${r.key}`} className="flex min-w-0 items-center gap-2 hover:underline">
            <Favicon domain={r.domain} fallback={r.name ?? "?"} />
            <span className="truncate font-medium">{r.name ?? "Deleted project"}</span>
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">{r.domain}</span>
          </Link>
        ) : (
          <span className="text-muted-foreground">Workspace-wide (no project)</span>
        ),
    },
    { id: "events", header: "Calls", align: "right", sortValue: (r) => r.events, cell: (r) => formatNumber(r.events) },
    {
      id: "share",
      header: "Share",
      align: "right",
      hideBelow: "sm",
      sortValue: (r) => r.cost,
      cell: (r) => (
        <div className="ml-auto flex w-28 items-center gap-2">
          <Meter value={totalCost ? (r.cost / totalCost) * 100 : 0} />
          <span className="w-9 text-xs text-muted-foreground tabular">{totalCost ? Math.round((r.cost / totalCost) * 100) : 0}%</span>
        </div>
      ),
    },
    { id: "cost", header: "Cost", align: "right", sortValue: (r) => r.cost, cell: (r) => <span className="font-medium">{formatUsd(r.cost)}</span> },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <PeriodSelect
          value={period}
          from={from}
          to={to}
          onChange={(p) => patch({ period: p === "30d" ? null : p, from: null, to: null })}
          onCustom={(r) => patch({ period: "custom", from: r.from, to: r.to })}
        />
        {canSwitchScope && (
          <Segmented
            size="sm"
            value={scope}
            onChange={(v) => patch({ scope: v === "workspace" ? null : v })}
            options={[
              { value: "workspace", label: "This workspace" },
              { value: "instance", label: "Whole instance" },
            ]}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today" icon={<CalendarDays className="size-3.5" />} value={formatUsd(summary.today)} />
        <StatCard label="This month" icon={<Receipt className="size-3.5" />} value={formatUsd(summary.month)} />
        <StatCard label="Last 30 days" icon={<Coins className="size-3.5" />} value={formatUsd(summary.last30)} />
        <StatCard
          label="Selected period"
          icon={<Activity className="size-3.5" />}
          value={formatUsd(totalCost)}
          footer={`${formatNumber(summary.totals.events)} billable calls`}
        />
      </div>

      {budget && <BudgetPanel budget={budget} isAdmin={isAdmin} />}

      {!hasData ? (
        <Panel>
          <EmptyState
            icon={Wallet}
            title="No usage recorded in this period"
            description="Costs appear here as soon as DataForSEO, AI API providers or local agents are used — e.g. keyword research, rank checks, AI visibility tracking or site audits. Local agents run on your own subscription and are tracked at $0."
            action={isAdmin ? { label: "Configure providers", href: "/admin/data" } : undefined}
          />
        </Panel>
      ) : (
        <>
          <Panel title="Cost per day" description="USD, provider-reported cost of paid API calls.">
            <BarsChart data={chartData} series={[{ key: "cost", label: "Cost (USD)", color: "var(--chart-2)" }]} height={240} />
          </Panel>
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
            <Panel title="By provider">
              <div className="grid items-center gap-4 sm:grid-cols-[180px_1fr]">
                <DonutChart
                  data={providers}
                  height={180}
                  format="decimal"
                  center={
                    <div className="text-center">
                      <div className="text-lg font-semibold tabular">{formatUsd(totalCost)}</div>
                      <div className="text-[11px] text-muted-foreground">total</div>
                    </div>
                  }
                />
                <ul className="space-y-2 text-sm">
                  {providers.map((p) => (
                    <li key={p.name} className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                        <span className="truncate">{p.name}</span>
                        <span className="text-xs text-muted-foreground tabular">{formatNumber(p.events)} calls</span>
                      </span>
                      <span className="font-medium tabular">{formatUsd(p.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
            <Panel title="By feature" description="What the money was spent on.">
              <RankedBars
                items={summary.byFeature.slice(0, 10).map((f) => ({
                  key: f.key,
                  label: featureLabel(f.key),
                  value: f.cost,
                  sub: `${formatNumber(f.events)} calls`,
                  right: formatUsd(f.cost),
                }))}
              />
            </Panel>
          </div>
          <Panel title="By project" contentClassName="p-0 sm:p-0">
            <DataTable
              className="[&>div]:rounded-none [&>div]:border-0"
              columns={projectColumns}
              data={summary.byProject}
              getRowId={(r) => r.key || "none"}
              initialSort={{ id: "cost", dir: "desc" }}
              pageSize={25}
              mobileCard={(r) => (
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <Favicon domain={r.domain} fallback={r.name ?? "?"} />
                    <span className="truncate font-medium">{r.name ?? (r.key ? "Deleted project" : "Workspace-wide")}</span>
                  </span>
                  <span className="shrink-0 text-right text-sm">
                    <span className="font-medium tabular">{formatUsd(r.cost)}</span>
                    <span className="block text-xs text-muted-foreground">{formatNumber(r.events)} calls</span>
                  </span>
                </div>
              )}
            />
          </Panel>
          {summary.byEndpoint.length > 0 && (
            <Panel title="Top cost drivers" description="Most expensive endpoints and models in this period.">
              <RankedBars
                items={summary.byEndpoint.map((e) => ({
                  key: `${e.provider}:${e.key}`,
                  label: <span className="font-mono text-xs">{e.key}</span>,
                  value: e.cost,
                  sub: providerLabel(e.provider),
                  right: formatUsd(e.cost),
                }))}
              />
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

export function BudgetPanel({ budget, isAdmin, className }: { budget: BudgetStatus; isAdmin: boolean; className?: string }) {
  const items = [
    { key: "daily", label: "Daily budget", ...budget.daily },
    { key: "monthly", label: "Monthly budget", ...budget.monthly },
  ];
  const none = items.every((i) => i.budget <= 0);
  return (
    <Panel
      className={className}
      title="Instance budgets"
      icon={<Gauge className="size-4 text-muted-foreground" />}
      description="Paid API calls stop automatically when a budget is exhausted (resets at 00:00 UTC / on the 1st)."
      actions={
        isAdmin && (
          <Link href="/admin/limits" className="text-xs font-medium text-muted-foreground hover:text-foreground">
            Edit budgets →
          </Link>
        )
      }
    >
      {none ? (
        <p className="text-sm text-muted-foreground">
          No budgets configured — spending is unlimited. Spent today: <span className="font-medium text-foreground tabular">{formatUsd(budget.daily.spent)}</span>
          , this month: <span className="font-medium text-foreground tabular">{formatUsd(budget.monthly.spent)}</span>.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((i) => {
            const pct = i.budget > 0 ? (i.spent / i.budget) * 100 : 0;
            const tone = pct >= 100 ? "destructive" : pct >= 80 ? "warning" : "brand";
            return (
              <div key={i.key} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{i.label}</span>
                  <span className="text-muted-foreground tabular">
                    {i.budget > 0 ? (
                      <>
                        <span className={cn("font-medium text-foreground", pct >= 100 && "text-destructive")}>{formatUsd(i.spent)}</span> /{" "}
                        {formatUsd(i.budget)}
                      </>
                    ) : (
                      <>
                        {formatUsd(i.spent)} · <span className="text-xs">no limit</span>
                      </>
                    )}
                  </span>
                </div>
                <Meter value={i.budget > 0 ? pct : 0} tone={tone} className="h-2" />
                {i.budget > 0 && (
                  <p className="text-xs text-muted-foreground tabular">
                    {pct >= 100 ? "Budget exhausted — paid calls are blocked." : `${Math.round(pct)}% used · ${formatUsd(Math.max(0, i.budget - i.spent))} left`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
