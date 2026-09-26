"use client";

import { Download, FileText } from "lucide-react";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { formatNumber } from "@/components/app/metrics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatUsd, providerLabel } from "../usage/labels";
import { monthLabel } from "./math";

export type HistoryRow = { month: string; events: number; cost: number; providers: Record<string, number> };

/** Invoice-like monthly statement (last 12 months) with CSV export. */
export function BillingHistory({
  rows,
  budget,
  exportHref,
  currentMonth,
}: {
  rows: HistoryRow[];
  /** Current monthly budget (instance scope, admins only) — null hides budget columns. */
  budget: number | null;
  exportHref: string;
  currentMonth: string;
}) {
  const showBudget = budget != null && budget > 0;
  const columns: Column<HistoryRow>[] = [
    {
      id: "month",
      header: "Statement",
      sortValue: (r) => r.month,
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <FileText className="size-4 text-muted-foreground" />
          </span>
          <span className="min-w-0">
            <span className="block font-medium">{monthLabel(r.month)}</span>
            <span className="block font-mono text-[11px] text-muted-foreground">{r.month}</span>
          </span>
          {r.month === currentMonth && (
            <Badge variant="outline" className="h-5 text-[10px]">
              In progress
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "providers",
      header: "Providers",
      hideBelow: "md",
      cell: (r) => {
        const entries = Object.entries(r.providers).sort((a, b) => b[1] - a[1]);
        if (!entries.length) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="flex max-w-96 flex-wrap gap-1">
            {entries.map(([k, v]) => (
              <Badge key={k} variant="outline" className="h-5 gap-1 px-1.5 text-[11px] font-normal">
                {providerLabel(k)} <span className="text-muted-foreground tabular">{formatUsd(v)}</span>
              </Badge>
            ))}
          </div>
        );
      },
    },
    { id: "events", header: "Calls", align: "right", hideBelow: "sm", sortValue: (r) => r.events, cell: (r) => formatNumber(r.events) },
    ...(showBudget
      ? ([
          {
            id: "budget",
            header: "Budget",
            align: "right",
            hideBelow: "lg",
            cell: () => <span className="text-muted-foreground">{formatUsd(budget)}</span>,
          },
          {
            id: "delta",
            header: "Over / under",
            align: "right",
            hideBelow: "sm",
            sortValue: (r) => r.cost - (budget ?? 0),
            cell: (r) => {
              const d = r.cost - (budget ?? 0);
              return <span className={cn("tabular", d > 0 ? "text-destructive" : "text-success")}>{d > 0 ? `+${formatUsd(d)}` : `−${formatUsd(-d)}`}</span>;
            },
          },
        ] satisfies Column<HistoryRow>[])
      : []),
    {
      id: "total",
      header: "Total",
      align: "right",
      sortValue: (r) => r.cost,
      cell: (r) => <span className="font-semibold tabular">{formatUsd(r.cost)}</span>,
    },
  ];

  const yearTotal = rows.reduce((n, r) => n + r.cost, 0);

  return (
    <Panel
      title="Monthly statements"
      description={`Last 12 months · ${formatUsd(yearTotal)} total${showBudget ? " · budget column uses the current monthly budget" : ""}`}
      actions={
        <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
          <a href={exportHref} download>
            <Download className="size-3.5" /> Export CSV
          </a>
        </Button>
      }
      contentClassName="p-0 sm:p-0"
    >
      <DataTable
        className="[&>div]:rounded-none [&>div]:border-0"
        columns={columns}
        data={rows}
        getRowId={(r) => r.month}
        initialSort={{ id: "month", dir: "desc" }}
        paginate={false}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{monthLabel(r.month)}</span>
              <span className="font-semibold tabular">{formatUsd(r.cost)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
              <span className="tabular">{formatNumber(r.events)} calls</span>
              {Object.entries(r.providers)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([k, v]) => (
                  <span key={k}>
                    · {providerLabel(k)} {formatUsd(v)}
                  </span>
                ))}
              {showBudget && r.cost > (budget ?? 0) && <span className="text-destructive">· over budget</span>}
            </div>
          </div>
        )}
      />
    </Panel>
  );
}
