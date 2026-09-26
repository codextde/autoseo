"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  Coins,
  FolderKanban,
  Globe,
  MailPlus,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { Panel } from "@/components/app/page";
import { Meter, formatNumber } from "@/components/app/metrics";
import { BarsChart, DonutChart, RankedBars, CHART_COLORS } from "@/components/app/charts";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Favicon } from "@/components/app/favicon";
import { TimeAgo } from "@/components/app/misc";
import { Badge } from "@/components/ui/badge";
import { useUrlPatch } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { featureLabel, formatUsd, providerLabel } from "../usage/labels";
import { Segmented } from "../account/segmented";

export type BillingProjectRow = { key: string; name: string | null; domain: string | null; cost: number; events: number };

export type BillingOverviewData = {
  scopeKind: "workspace" | "instance";
  canSwitchScope: boolean;
  isAdmin: boolean;
  plan: {
    name: string;
    projects: number;
    projectLimit: number;
    archivedProjects: number;
    members: number;
    pendingInvites: number;
    workspaces: number;
  };
  month: {
    label: string;
    spent: number;
    forecast: number;
    events: number;
    daysLeft: number;
    byDay: { date: string; cost: number }[];
    byProvider: { key: string; cost: number; events: number }[];
    byFeature: { key: string; cost: number; events: number }[];
    byProject: BillingProjectRow[];
  };
  /** Instance-wide numbers — only for instance admins. */
  instance: null | {
    monthlyBudget: number;
    spent: number;
    forecast: number;
    balance:
      | { status: "not_configured" }
      | { status: "ok"; balance: number; login: string; sandbox: boolean; checkedAt: string }
      | { status: "error"; message: string; checkedAt: string };
  };
};

function Stat({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-xl bg-muted/50 p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="text-base font-semibold tracking-tight tabular">{value}</div>
        {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

export function BillingOverview({ data }: { data: BillingOverviewData }) {
  const [patch] = useUrlPatch();
  const { plan, month, instance } = data;
  const hasSpend = month.events > 0;
  const providers = month.byProvider.map((p, i) => ({
    name: providerLabel(p.key),
    value: Number(p.cost.toFixed(4)),
    color: CHART_COLORS[i % CHART_COLORS.length],
    events: p.events,
  }));

  const budget = instance?.monthlyBudget ?? 0;
  const budgetPct = budget > 0 && instance ? (instance.spent / budget) * 100 : 0;
  const forecastPct = budget > 0 && instance ? (instance.forecast / budget) * 100 : 0;
  const tone = budgetPct >= 100 ? "destructive" : budgetPct >= 80 || forecastPct > 100 ? "warning" : "brand";
  const pool = budget > 0 && instance ? Math.max(0, budget - instance.spent) : null;

  const projectColumns: Column<BillingProjectRow>[] = [
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
      id: "cost",
      header: "Cost",
      align: "right",
      sortValue: (r) => r.cost,
      cell: (r) => <span className="font-medium">{formatUsd(r.cost)}</span>,
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      {data.canSwitchScope && (
        <Segmented
          size="sm"
          value={data.scopeKind}
          onChange={(v) => patch({ scope: v === "workspace" ? null : v })}
          options={[
            { value: "workspace", label: "This workspace" },
            { value: "instance", label: "Whole instance" },
          ]}
        />
      )}

      <div className={cn("grid gap-4 sm:gap-5", instance ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
        {/* Plan */}
        <motion.section
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative min-w-0 overflow-hidden rounded-2xl border bg-card p-4 shadow-soft sm:p-5"
        >
          <div className="pointer-events-none absolute -top-16 -right-16 size-44 rounded-full bg-brand/10 blur-2xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium tracking-wide text-brand uppercase">Your plan</div>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">Self-hosted · unlimited seats</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                No subscription and no per-seat fees — you pay DataForSEO and AI providers directly at their list prices.
              </p>
            </div>
            <Badge variant="secondary" className="h-6 shrink-0 gap-1 bg-success/12 text-success">
              <BadgeCheck className="size-3.5" /> Active
            </Badge>
          </div>
          <div className="relative mt-4 grid grid-cols-2 gap-2">
            <Stat
              icon={FolderKanban}
              label="Projects"
              value={data.scopeKind === "workspace" ? `${plan.projects} / ${plan.projectLimit}` : plan.projects}
              sub={plan.archivedProjects ? `${plan.archivedProjects} archived` : data.scopeKind === "workspace" ? "limit per workspace" : "active"}
            />
            <Stat
              icon={Users}
              label={data.scopeKind === "workspace" ? "Members" : "Active users"}
              value={plan.members}
              sub="unlimited seats"
            />
            <Stat icon={MailPlus} label="Pending invites" value={plan.pendingInvites} />
            <Stat
              icon={Building2}
              label={data.scopeKind === "workspace" ? "Workspace" : "Workspaces"}
              value={data.scopeKind === "workspace" ? <span className="block truncate text-sm">{plan.name}</span> : plan.workspaces}
            />
          </div>
        </motion.section>

        {/* This month */}
        <Panel
          title={
            <span className="flex items-center gap-2">
              <Receipt className="size-4 text-muted-foreground" /> {month.label}
            </span>
          }
          description={data.scopeKind === "workspace" ? "Spend of this workspace so far" : "Spend of the whole instance so far"}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-3xl font-semibold tracking-tight tabular">{formatUsd(month.spent)}</span>
            <span className="text-xs text-muted-foreground tabular">{formatNumber(month.events)} billable calls</span>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm">
            <TrendingUp className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Forecast to month end</span>
            <span className="ml-auto font-medium tabular">{formatUsd(month.forecast)}</span>
          </div>
          {instance && (
            <div className="mt-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Instance budget</span>
                <span className="tabular">
                  {budget > 0 ? (
                    <>
                      <span className="font-medium">{formatUsd(instance.spent)}</span> / {formatUsd(budget)}
                    </>
                  ) : (
                    "No monthly budget"
                  )}
                </span>
              </div>
              {budget > 0 ? (
                <>
                  <div className="relative">
                    <Meter value={budgetPct} tone={tone} className="h-2" />
                    {forecastPct > 0 && forecastPct <= 100 && (
                      <span
                        className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-foreground/60"
                        style={{ left: `${forecastPct}%` }}
                        title="Forecast"
                      />
                    )}
                  </div>
                  <p className={cn("text-[11px]", forecastPct > 100 ? "text-warning" : "text-muted-foreground")}>
                    {forecastPct > 100 ? (
                      <span className="inline-flex items-center gap-1">
                        <AlertTriangle className="size-3" /> At this pace the budget runs out before the month ends ({formatUsd(instance.forecast)} forecast).
                      </span>
                    ) : (
                      `${Math.round(budgetPct)}% used · ${month.daysLeft} day${month.daysLeft === 1 ? "" : "s"} left`
                    )}
                  </p>
                </>
              ) : (
                <Link href="/admin/limits" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                  Set a monthly budget in Admin → Limits & Budgets <ArrowUpRight className="size-3" />
                </Link>
              )}
            </div>
          )}
        </Panel>

        {/* Balance & credit pool (admins) */}
        {instance && (
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-1">
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <Globe className="size-4 text-muted-foreground" /> DataForSEO balance
                </span>
              }
            >
              {instance.balance.status === "ok" ? (
                <div className="space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className={cn("text-2xl font-semibold tracking-tight tabular", instance.balance.balance < 5 && "text-warning")}>
                      {formatUsd(instance.balance.balance)}
                    </span>
                    {instance.balance.sandbox && (
                      <Badge variant="outline" className="h-5 text-[10px]">
                        Sandbox
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {instance.balance.login} · checked <TimeAgo date={instance.balance.checkedAt} />
                  </p>
                  {instance.balance.balance < 5 && (
                    <a
                      href="https://app.dataforseo.com/payments"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-warning hover:underline"
                    >
                      Low balance — top up at DataForSEO <ArrowUpRight className="size-3" />
                    </a>
                  )}
                </div>
              ) : instance.balance.status === "not_configured" ? (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">DataForSEO is not connected yet.</p>
                  <Link href="/admin/data" className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
                    Connect in Admin → Data Providers <ArrowUpRight className="size-3" />
                  </Link>
                </div>
              ) : (
                <div className="space-y-1.5 text-sm">
                  <p className="flex items-center gap-1.5 text-destructive">
                    <AlertTriangle className="size-3.5" /> Couldn&apos;t load the balance
                  </p>
                  <p className="text-xs break-words text-muted-foreground">{instance.balance.message}</p>
                  <Link href="/admin/data" className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
                    Check credentials <ArrowUpRight className="size-3" />
                  </Link>
                </div>
              )}
            </Panel>
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <Coins className="size-4 text-muted-foreground" /> AI credit pool
                </span>
              }
              description="What's left of this month's budget for paid API calls"
            >
              {pool == null ? (
                <div className="space-y-1">
                  <span className="text-2xl font-semibold tracking-tight">Unlimited</span>
                  <p className="text-xs text-muted-foreground">No monthly budget configured — paid calls are never blocked.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <span className={cn("text-2xl font-semibold tracking-tight tabular", pool <= 0 && "text-destructive")}>{formatUsd(pool)}</span>
                  <p className="text-xs text-muted-foreground">
                    {pool <= 0 ? "Budget exhausted — paid calls are blocked until the 1st." : `resets on the 1st · local agents don't use the pool`}
                  </p>
                </div>
              )}
            </Panel>
          </div>
        )}
      </div>

      {!hasSpend ? (
        <Panel>
          <EmptyState
            icon={Wallet}
            title="Nothing spent this month yet"
            description="Costs appear as soon as DataForSEO or AI API providers are used. Work done by local agents (Claude Code / Codex) uses your own subscription and is tracked at $0."
            action={data.isAdmin ? { label: "Configure providers", href: "/admin/data" } : undefined}
          />
        </Panel>
      ) : (
        <>
          <Panel title="Daily spend this month" description="USD, provider-reported cost of paid API calls.">
            <BarsChart data={month.byDay} series={[{ key: "cost", label: "Cost (USD)", color: "var(--chart-2)" }]} height={220} />
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
                      <div className="text-lg font-semibold tabular">{formatUsd(month.spent)}</div>
                      <div className="text-[11px] text-muted-foreground">this month</div>
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
                items={month.byFeature.slice(0, 10).map((f) => ({
                  key: f.key,
                  label: featureLabel(f.key),
                  value: f.cost,
                  sub: `${formatNumber(f.events)} calls`,
                  right: formatUsd(f.cost),
                }))}
              />
            </Panel>
          </div>
          {month.byProject.length > 0 && (
            <Panel title="By project" contentClassName="p-0 sm:p-0">
              <DataTable
                className="[&>div]:rounded-none [&>div]:border-0"
                columns={projectColumns}
                data={month.byProject}
                getRowId={(r) => r.key || "none"}
                initialSort={{ id: "cost", dir: "desc" }}
                pageSize={25}
                mobileCard={(r) => (
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      {r.key !== "__other" && <Favicon domain={r.domain} fallback={r.name ?? "?"} />}
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
          )}
        </>
      )}
    </div>
  );
}
