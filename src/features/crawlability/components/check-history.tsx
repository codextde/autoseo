"use client";

import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { DataTable, type Column } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/misc";
import { Sparkline } from "@/components/app/charts";
import { ScorePill } from "@/features/audit/components/bits";

export type CheckHistoryRow = { id: string; status: string; trigger: string; score: number | null; createdAt: string; error: string | null };

export function CheckHistory({ projectId, rows, activeId }: { projectId: string; rows: CheckHistoryRow[]; activeId: string | null }) {
  const router = useRouter();
  const trend = rows
    .filter((r) => r.score != null)
    .slice(0, 20)
    .reverse()
    .map((r) => r.score!);
  const columns: Column<CheckHistoryRow>[] = [
    { id: "date", header: "Date", cell: (r) => <span className="tabular" suppressHydrationWarning>{format(new Date(r.createdAt), "MMM d, yyyy · HH:mm")}</span>, sortValue: (r) => r.createdAt },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status === "completed" ? "completed" : r.status === "failed" ? "failed" : "running"} label={r.status === "completed" ? "Done" : r.status === "failed" ? "Failed" : "Running"} />,
    },
    { id: "trigger", header: "Trigger", hideBelow: "sm", cell: (r) => <span className="text-xs text-muted-foreground capitalize">{r.trigger}</span> },
    { id: "score", header: "Score", align: "right", cell: (r) => <ScorePill score={r.score} />, sortValue: (r) => r.score },
  ];
  return (
    <div className="space-y-3">
      {trend.length >= 2 && (
        <div className="rounded-xl bg-muted/40 px-3 py-2">
          <p className="mb-1 text-[11px] text-muted-foreground">AI access score over the last {trend.length} checks</p>
          <Sparkline values={trend} color="var(--brand)" />
        </div>
      )}
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        pageSize={10}
        dense
        onRowClick={(r) => router.push(`/p/${projectId}/crawlability/${r.id}`)}
        rowClassName={(r) => (r.id === activeId ? "bg-muted/60" : undefined)}
      />
    </div>
  );
}
