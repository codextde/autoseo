"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, GitCompare, History, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/misc";
import { deleteAuditAction } from "../actions";
import { hostOf, pathOf, ScorePill, SeverityDot } from "./bits";

export type HistoryRow = {
  id: string;
  startUrl: string;
  status: string;
  currentPhase: string;
  trigger: string;
  pagesCrawled: number;
  pagesTotal: number;
  score: number | null;
  issueCounts: { critical: number; warning: number; info: number; total: number } | null;
  lighthouse: boolean;
  startedAt: string;
};

function statusLabel(r: HistoryRow) {
  if (r.status === "completed") return <StatusBadge status="completed" label="Done" />;
  if (r.status === "running" || r.status === "queued") return <StatusBadge status="running" label={r.currentPhase === "queued" ? "Queued" : "Running"} />;
  if (r.status === "cancelled") return <StatusBadge status="cancelled" label="Cancelled" />;
  return <StatusBadge status="failed" label="Failed" />;
}

function IssueDots({ c }: { c: HistoryRow["issueCounts"] }) {
  if (!c) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-2.5 text-xs tabular">
      <span className="inline-flex items-center gap-1">
        <SeverityDot severity="critical" />
        {c.critical}
      </span>
      <span className="inline-flex items-center gap-1">
        <SeverityDot severity="warning" />
        {c.warning}
      </span>
      <span className="inline-flex items-center gap-1">
        <SeverityDot severity="info" />
        {c.info}
      </span>
    </span>
  );
}

export function HistoryTable({ projectId, rows, canRun }: { projectId: string; rows: HistoryRow[]; canRun: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toDelete, setToDelete] = useState<string | null>(null);
  const base = `/p/${projectId}/seo/audit`;
  const completed = rows.filter((r) => r.status === "completed");

  const previousOf = (r: HistoryRow) => completed.find((c) => c.id !== r.id && c.startedAt < r.startedAt);

  const remove = (id: string) =>
    start(async () => {
      const res = await deleteAuditAction(projectId, id);
      if (res.ok) {
        toast.success("Audit deleted");
        router.refresh();
      } else toast.error(res.error);
    });

  const actions = (r: HistoryRow) => {
    const prev = previousOf(r);
    return (
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <Button asChild variant="outline" size="sm" className="h-7">
          <Link href={`${base}/${r.id}`}>
            View <ArrowRight className="size-3.5" />
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" aria-label="More actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!prev || r.status !== "completed"} asChild={!!prev && r.status === "completed"}>
              {prev && r.status === "completed" ? (
                <Link href={`${base}/compare?a=${prev.id}&b=${r.id}`}>
                  <GitCompare className="size-4" /> Compare with previous
                </Link>
              ) : (
                <span className="flex items-center gap-2">
                  <GitCompare className="size-4" /> Compare with previous
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={!canRun || pending} onSelect={() => setToDelete(r.id)}>
              <Trash2 className="size-4" /> Delete audit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const columns: Column<HistoryRow>[] = [
    {
      id: "date",
      header: "Date",
      cell: (r) => <span className="whitespace-nowrap tabular" suppressHydrationWarning>{format(new Date(r.startedAt), "MMM d, yyyy · HH:mm")}</span>,
      sortValue: (r) => r.startedAt,
    },
    {
      id: "url",
      header: "URL",
      cell: (r) => (
        <span className="block max-w-[260px] truncate font-medium" title={r.startUrl}>
          {hostOf(r.startUrl)}
          <span className="font-normal text-muted-foreground">{pathOf(r.startUrl) === "/" ? "" : pathOf(r.startUrl)}</span>
        </span>
      ),
    },
    { id: "status", header: "Status", cell: (r) => statusLabel(r) },
    { id: "score", header: "Health", align: "right", cell: (r) => <ScorePill score={r.score} />, sortValue: (r) => r.score },
    { id: "pages", header: "Pages", align: "right", cell: (r) => (r.pagesCrawled || r.pagesTotal).toLocaleString(), sortValue: (r) => r.pagesCrawled },
    { id: "issues", header: "Issues", cell: (r) => <IssueDots c={r.issueCounts} />, hideBelow: "md" },
    {
      id: "lh",
      header: "Lighthouse",
      cell: (r) => (r.lighthouse ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs">Yes</span> : <span className="text-muted-foreground">—</span>),
      hideBelow: "lg",
    },
    {
      id: "trigger",
      header: "Trigger",
      cell: (r) => <span className="text-xs text-muted-foreground capitalize">{r.trigger}</span>,
      hideBelow: "lg",
    },
    { id: "actions", header: "", cell: actions, align: "right" },
  ];

  return (
    <>
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      initialSort={{ id: "date", dir: "desc" }}
      pageSize={10}
      onRowClick={(r) => router.push(`${base}/${r.id}`)}
      empty={<EmptyState icon={History} title="No audits yet" description="Start your first audit above — results appear here with their health score." compact />}
      mobileCard={(r) => (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{hostOf(r.startUrl)}</span>
            <ScorePill score={r.score} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {statusLabel(r)}
            <span className="tabular" suppressHydrationWarning>{format(new Date(r.startedAt), "MMM d, HH:mm")}</span>
            <span>· {(r.pagesCrawled || r.pagesTotal).toLocaleString()} pages</span>
          </div>
          <div className="flex items-center justify-between">
            <IssueDots c={r.issueCounts} />
            {actions(r)}
          </div>
        </div>
      )}
    />
    <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this audit?</AlertDialogTitle>
          <AlertDialogDescription>All crawled pages, issues and Lighthouse results of this audit are removed permanently.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() => {
              if (toDelete) remove(toDelete);
              setToDelete(null);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
