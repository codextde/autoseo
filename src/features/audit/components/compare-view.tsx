"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/app/data-table";
import { useUrlPatch } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { pathOf, SeverityDot, type Severity } from "./bits";

export type CompareOption = { id: string; label: string; score: number | null };
export type CompareRow = { issueType: string; title: string; severity: Severity; before: number; after: number; delta: number };
export type DiffIssue = { issueType: string; title: string; pageUrl: string; pageId: string | null; severity: Severity };

export function CompareSelectors({ options, a, b }: { options: CompareOption[]; a: string; b: string }) {
  const [patch, pending] = useUrlPatch();
  const sel = (value: string, key: "a" | "b") => (
    <Select value={value} onValueChange={(v) => patch({ [key]: v })}>
      <SelectTrigger className="w-full sm:w-72">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label} {o.score != null ? `· ${o.score}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", pending && "opacity-60")}>
      {sel(a, "a")}
      <ArrowRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
      {sel(b, "b")}
    </div>
  );
}

function DeltaCell({ delta }: { delta: number }) {
  if (delta === 0)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" /> 0
      </span>
    );
  const better = delta < 0;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium tabular", better ? "text-success" : "text-destructive")}>
      {better ? <TrendingDown className="size-3" /> : <TrendingUp className="size-3" />}
      {delta > 0 ? "+" : ""}
      {delta.toLocaleString()}
    </span>
  );
}

export function CompareTable({ rows }: { rows: CompareRow[] }) {
  const columns: Column<CompareRow>[] = [
    {
      id: "issue",
      header: "Issue",
      cell: (r) => (
        <span className="flex items-center gap-2 text-sm">
          <SeverityDot severity={r.severity} />
          {r.title}
        </span>
      ),
      sortValue: (r) => r.title,
    },
    { id: "before", header: "Before", align: "right", cell: (r) => r.before.toLocaleString(), sortValue: (r) => r.before },
    { id: "after", header: "After", align: "right", cell: (r) => r.after.toLocaleString(), sortValue: (r) => r.after },
    { id: "delta", header: "Change", align: "right", cell: (r) => <DeltaCell delta={r.delta} />, sortValue: (r) => r.delta },
  ];
  return <DataTable columns={columns} data={rows} getRowId={(r) => r.issueType} dense paginate={false} />;
}

export function IssueDiffLists({
  newIssues,
  resolved,
  newCount,
  resolvedCount,
  baseA,
  baseB,
}: {
  newIssues: DiffIssue[];
  resolved: DiffIssue[];
  newCount: number;
  resolvedCount: number;
  baseA: string;
  baseB: string;
}) {
  const [tab, setTab] = useState<"new" | "resolved">("new");
  const list = tab === "new" ? newIssues : resolved;
  const base = tab === "new" ? baseB : baseA;
  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs sm:w-fit">
        <button type="button" onClick={() => setTab("new")} className={cn("flex-1 rounded-md px-3 py-1.5", tab === "new" ? "bg-background font-medium shadow-xs" : "text-muted-foreground")}>
          New issues <span className="tabular text-destructive">{newCount.toLocaleString()}</span>
        </button>
        <button type="button" onClick={() => setTab("resolved")} className={cn("flex-1 rounded-md px-3 py-1.5", tab === "resolved" ? "bg-background font-medium shadow-xs" : "text-muted-foreground")}>
          Resolved <span className="tabular text-success">{resolvedCount.toLocaleString()}</span>
        </button>
      </div>
      {list.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">{tab === "new" ? "No new issues — nothing regressed." : "No issues were resolved between these runs."}</p>
      ) : (
        <ul className="max-h-[480px] divide-y overflow-y-auto rounded-xl border bg-card">
          {list.map((i, idx) => (
            <li key={`${i.issueType}-${i.pageUrl}-${idx}`} className="flex flex-col gap-0.5 px-4 py-2 sm:flex-row sm:items-center sm:gap-3">
              <span className="flex items-center gap-2 text-sm sm:w-64 sm:shrink-0">
                <SeverityDot severity={i.severity} />
                <span className="truncate">{i.title}</span>
              </span>
              {i.pageId ? (
                <Link href={`${base}/pages/${i.pageId}`} className="min-w-0 truncate font-mono text-xs text-muted-foreground hover:underline">
                  {pathOf(i.pageUrl)}
                </Link>
              ) : (
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{pathOf(i.pageUrl)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
