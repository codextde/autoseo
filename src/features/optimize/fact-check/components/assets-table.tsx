"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, ListFilter, Settings2 } from "lucide-react";
import { DataTable, type Column } from "@/components/app/data-table";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AssetRow } from "../types";
import { MarketChip } from "./badges";

function StatusCell({ row }: { row: AssetRow }) {
  const paused = row.status === "paused";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <span className={cn("size-1.5 rounded-full", paused ? "bg-muted-foreground" : "bg-success")} />
      <span className="font-medium">{paused ? "Paused" : "Active"}</span>
      <span className="text-muted-foreground">·</span>
      <span className={cn("tabular", row.criticalFindings ? "font-medium text-destructive" : row.openFindings ? "text-foreground" : "text-muted-foreground")}>
        {row.openFindings} open
      </span>
    </span>
  );
}

function DocsCell({ row }: { row: AssetRow }) {
  if (!row.docs)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs font-medium text-warning">No label yet</span>
        </TooltipTrigger>
        <TooltipContent>Upload the reference documents (PDF, text or URL) to start checking.</TooltipContent>
      </Tooltip>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs tabular">
      <FileText className="size-3.5 text-muted-foreground" />
      {row.docsReady}/{row.docs}
      {row.docsFailed > 0 && <span className="text-destructive">· {row.docsFailed} failed</span>}
    </span>
  );
}

export function AssetsTable({ projectId, rows }: { projectId: string; rows: AssetRow[] }) {
  const router = useRouter();
  const base = `/p/${projectId}/fact-check`;
  const columns: Column<AssetRow>[] = [
    {
      id: "asset",
      header: "Asset",
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`${base}/assets/${r.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.name}
          </Link>
          {r.aliases.length > 0 && <div className="max-w-72 truncate text-xs text-muted-foreground">{r.aliases.join(", ")}</div>}
        </div>
      ),
    },
    {
      id: "ingredient",
      header: "Active ingredient",
      hideBelow: "md",
      sortValue: (r) => r.activeIngredient ?? "",
      cell: (r) => <span className="text-sm">{r.activeIngredient || <span className="text-muted-foreground">—</span>}</span>,
    },
    {
      id: "markets",
      header: "Markets",
      cell: (r) => (
        <div className="flex max-w-64 flex-wrap gap-1">
          {r.markets.length ? r.markets.map((m) => <MarketChip key={m.country} country={m.country} regulator={m.regulator} />) : <span className="text-xs text-muted-foreground">All</span>}
        </div>
      ),
    },
    { id: "docs", header: "Reference docs", hideBelow: "lg", sortValue: (r) => r.docsReady, cell: (r) => <DocsCell row={r} /> },
    {
      id: "match",
      header: "Match",
      align: "right",
      hideBelow: "lg",
      sortValue: (r) => (r.counts.checked ? r.counts.matched / r.counts.checked : -1),
      cell: (r) =>
        r.counts.checked ? (
          <span className="tabular">
            {Math.round((r.counts.matched / r.counts.checked) * 100)}%
            <span className="ml-1 text-xs text-muted-foreground">
              {r.counts.matched}/{r.counts.checked}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { id: "status", header: "Status", sortValue: (r) => r.openFindings, cell: (r) => <StatusCell row={r} /> },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button asChild variant="ghost" size="icon-sm" aria-label="Asset settings">
            <Link href={`${base}/assets/${r.id}`}>
              <Settings2 className="size-3.5" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`${base}/findings?asset=${r.id}&status=all`}>
              <ListFilter className="size-3.5" /> Findings
            </Link>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      initialSort={{ id: "status", dir: "desc" }}
      onRowClick={(r) => router.push(`${base}/assets/${r.id}`)}
      mobileCard={(r) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{r.name}</div>
              <div className="truncate text-xs text-muted-foreground">{[r.activeIngredient, r.aliases.join(", ")].filter(Boolean).join(" · ") || "No aliases"}</div>
            </div>
            <StatusCell row={r} />
          </div>
          <div className="flex flex-wrap gap-1">
            {r.markets.map((m) => (
              <MarketChip key={m.country} country={m.country} regulator={m.regulator} />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <DocsCell row={r} />
            <Button asChild variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>
              <Link href={`${base}/findings?asset=${r.id}&status=all`}>Findings</Link>
            </Button>
          </div>
        </div>
      )}
    />
  );
}
