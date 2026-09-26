"use client";

import { format } from "date-fns";
import { MessageSquareQuote } from "lucide-react";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { EngineIcon } from "@/components/app/engine-icon";
import { CountryFlag } from "@/components/app/misc";
import type { StatementView } from "../types";
import { SeverityBadge, VerdictBadge } from "./badges";

export function StatementsTable({ rows }: { rows: StatementView[] }) {
  const columns: Column<StatementView>[] = [
    { id: "verdict", header: "Verdict", sortValue: (r) => r.verdict, cell: (r) => <VerdictBadge verdict={r.verdict} /> },
    { id: "severity", header: "Severity", hideBelow: "md", sortValue: (r) => r.severity ?? "", cell: (r) => <SeverityBadge severity={r.severity} /> },
    { id: "claim", header: "Statement", cell: (r) => <p className="line-clamp-2 max-w-[34rem] min-w-56 text-sm">{r.claim}</p> },
    {
      id: "where",
      header: "Model · Market",
      hideBelow: "sm",
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 text-xs">
          <EngineIcon id={r.engine} size="xs" /> <CountryFlag iso={r.market} /> {r.market}
        </span>
      ),
    },
    {
      id: "seen",
      header: "Last Seen",
      sortValue: (r) => r.lastSeenAt,
      cell: (r) => (
        <span className="text-xs whitespace-nowrap tabular">
          <span className="font-medium">{r.seenCount}×</span>
          <span className="text-muted-foreground"> · {format(new Date(r.lastSeenAt), "MMM d")}</span>
        </span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      pageSize={25}
      renderExpanded={(r) => (
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">What AI said</div>
            <blockquote className="border-l-2 pl-3 text-sm whitespace-pre-wrap">{r.answerQuote || r.claim}</blockquote>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Label{r.labelSection ? ` · ${r.labelSection}` : ""}</div>
            {r.labelQuote ? (
              <blockquote className="border-l-2 border-brand/60 pl-3 text-sm whitespace-pre-wrap">{r.labelQuote}</blockquote>
            ) : (
              <p className="text-sm text-muted-foreground">{r.verdict === "pending" ? "Not checked yet." : "No matching passage."}</p>
            )}
          </div>
          {r.explanation && <p className="text-xs text-muted-foreground md:col-span-2">{r.explanation}</p>}
        </div>
      )}
      empty={
        <EmptyState
          compact
          icon={MessageSquareQuote}
          title="No statements collected yet"
          description="Statements appear once tracked AI answers mention this asset (by name or alias) and a check has run."
        />
      }
      mobileCard={(r) => (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <VerdictBadge verdict={r.verdict} />
            <SeverityBadge severity={r.severity} />
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              <EngineIcon id={r.engine} size="xs" withTooltip={false} /> <CountryFlag iso={r.market} /> {r.seenCount}×
            </span>
          </div>
          <p className="text-sm">{r.claim}</p>
          {r.labelQuote && <p className="border-l-2 border-brand/60 pl-2 text-xs text-muted-foreground">{r.labelQuote}</p>}
        </div>
      )}
    />
  );
}
