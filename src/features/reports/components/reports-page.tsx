"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Copy,
  Download,
  FileDown,
  FileText,
  Globe,
  LayoutTemplate,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Presentation,
  Share2,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageContainer, PageHeader, Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { FilterBar, SearchInput } from "@/components/app/filters";
import { StatusBadge, TimeAgo } from "@/components/app/misc";
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
import { EmptyState } from "@/components/app/empty-state";
import { useShell } from "@/components/app/shell-context";
import { cn } from "@/lib/utils";
import { deleteReportAction, getDeckAction, loadDataAction } from "../actions";
import type { Theme } from "../lib/types";
import { NewReportDialog } from "./new-report-dialog";
import { ShareDialog } from "./share-dialog";
import { DuplicateDialog, RenameDialog, SaveTemplateDialog } from "./report-dialogs";
import { ScaledSlide } from "./slide/scaled-slide";
import { appAssetUrl, formatBytes, useReportData } from "./hooks";
import { downloadPptx } from "./download";
import type { ReportListItem } from "@/server/reports/service";

type Dialog =
  | { kind: "share"; r: ReportListItem }
  | { kind: "rename"; r: ReportListItem }
  | { kind: "template"; r: ReportListItem }
  | { kind: "duplicate"; r: ReportListItem }
  | { kind: "delete"; r: ReportListItem }
  | null;

export function ReportsPage({
  projectId,
  reports: initial,
  theme,
  canManage,
  canManageWorkspace,
}: {
  projectId: string;
  reports: ReportListItem[];
  theme: Theme;
  canManage: boolean;
  /** workspace-wide resources (My Templates) */
  canManageWorkspace: boolean;
}) {
  const router = useRouter();
  const shell = useShell();
  const [reports, setReports] = useState(initial);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | "deck" | "html">("all");
  const [status, setStatus] = useState<"all" | "published" | "draft">("all");
  const [newOpen, setNewOpen] = useState(false);
  const [newTab, setNewTab] = useState<"library" | "mine" | "ai">("library");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const { bundle } = useReportData(projectId, { preset: "30d" });

  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    // server refresh (router.refresh) brought a new list
    setPrevInitial(initial);
    setReports(initial);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter(
      (r) =>
        (type === "all" || r.kind === type) &&
        (status === "all" || r.status === status) &&
        (!q || r.title.toLowerCase().includes(q) || (r.subtitle ?? "").toLowerCase().includes(q)),
    );
  }, [reports, query, type, status]);

  const base = `/p/${projectId}/reports`;
  const assetUrl = appAssetUrl(projectId);

  const download = async (r: ReportListItem, kind: "pdf" | "pptx") => {
    if (kind === "pdf") {
      window.open(r.kind === "html" ? `${base}/${r.id}/raw?print=1` : `${base}/${r.id}/print?auto=1`, "_blank", "noopener");
      return;
    }
    setBusy(r.id);
    try {
      const res = await getDeckAction(projectId, r.id);
      if (!res.ok) return void toast.error(res.error);
      const data = await loadDataAction(projectId, { dateRange: res.data.dateRange as { preset: "30d" } });
      await downloadPptx({ deck: res.data.deck, bundle: data.ok ? data.data : bundle, title: res.data.title, subtitle: res.data.subtitle, assetUrl });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: ReportListItem) => {
    const res = await deleteReportAction(projectId, r.id);
    if (!res.ok) return void toast.error(res.error);
    setReports((prev) => prev.filter((x) => x.id !== r.id));
    toast.success("Report deleted");
    start(() => router.refresh());
  };

  const openHref = (r: ReportListItem) => (r.kind === "deck" && canManage ? `${base}/${r.id}/edit` : `${base}/${r.id}`);

  const menu = (r: ReportListItem) => (
    // non-modal: items open dialogs, and a modal menu can leave the body pointer-locked
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="More actions" disabled={busy === r.id}>
          {busy === r.id ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link href={`${base}/${r.id}`}>
            <FileText /> Open viewer
          </Link>
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuItem onClick={() => setDialog({ kind: "share", r })}>
              <Share2 /> Share
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialog({ kind: "rename", r })}>
              <Type /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialog({ kind: "duplicate", r })}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            {canManageWorkspace && (
              <DropdownMenuItem onClick={() => setDialog({ kind: "template", r })}>
                <LayoutTemplate /> Save as template
              </DropdownMenuItem>
            )}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => download(r, "pdf")}>
          <FileDown /> Download PDF
        </DropdownMenuItem>
        {r.kind === "deck" && (
          <DropdownMenuItem onClick={() => download(r, "pptx")}>
            <Download /> Download PPTX
          </DropdownMenuItem>
        )}
        {canManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: "delete", r })}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const thumb = (r: ReportListItem, className?: string) =>
    r.preview ? (
      <div className={cn("shrink-0 overflow-hidden rounded-md ring-1 ring-border", className)}>
        <ScaledSlide slide={r.preview.slide} ctx={{ deck: { theme: r.preview.theme, size: r.preview.size }, data: { bundle, report: { title: r.title, subtitle: r.subtitle } }, assetUrl, mode: "view" }} rounded={false} />
      </div>
    ) : (
      <div className={cn("flex aspect-video shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-soft to-muted ring-1 ring-border", className)}>
        {r.kind === "html" ? <Sparkles className="size-4 text-brand" /> : <Presentation className="size-4 text-muted-foreground" />}
      </div>
    );

  const content = (r: ReportListItem) =>
    r.kind === "deck" ? (
      <span className="tabular text-sm">
        {r.slideCount} {r.slideCount === 1 ? "slide" : "slides"} <span className="text-muted-foreground">·</span> {r.chartCount} {r.chartCount === 1 ? "chart" : "charts"}
      </span>
    ) : r.aiStatus === "ready" ? (
      <span className="text-sm">
        AI report <span className="text-muted-foreground">· {formatBytes(r.sizeBytes)}</span>
      </span>
    ) : r.aiStatus === "failed" ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <StatusBadge status="failed" label="Generation failed" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-80">{r.aiError}</TooltipContent>
      </Tooltip>
    ) : (
      <StatusBadge status="running" label="Writing…" />
    );

  const columns: Column<ReportListItem>[] = [
    {
      id: "report",
      header: "Report",
      sortValue: (r) => r.title.toLowerCase(),
      cell: (r) => (
        <Link href={openHref(r)} className="flex min-w-0 items-center gap-3">
          {thumb(r, "w-20")}
          <div className="min-w-0">
            <div className="truncate font-medium">{r.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {r.subtitle || (r.kind === "html" ? `AI report${r.createdByLabel ? ` · ${r.createdByLabel}` : ""}` : `Slides${r.createdByName ? ` · by ${r.createdByName}` : ""}`)}
            </div>
          </div>
        </Link>
      ),
    },
    { id: "client", header: "Client", hideBelow: "md", sortValue: (r) => r.clientName, cell: (r) => <span className="text-sm">{r.clientName}</span> },
    {
      id: "branding",
      header: "Branding",
      hideBelow: "lg",
      cell: (r) => (
        <div className="flex -space-x-1">
          {r.brandColors.slice(0, 4).map((c, i) => (
            <span key={i} className="size-4 rounded-full ring-2 ring-card" style={{ background: c }} />
          ))}
        </div>
      ),
    },
    { id: "content", header: "Content", hideBelow: "md", sortValue: (r) => r.slideCount, cell: content },
    {
      id: "status",
      header: "Status",
      sortValue: (r) => r.status,
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          <StatusBadge status={r.status} />
          {r.shareEnabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Globe className="size-3.5 text-brand" />
              </TooltipTrigger>
              <TooltipContent>Public link active</TooltipContent>
            </Tooltip>
          )}
        </div>
      ),
    },
    { id: "updated", header: "Updated", hideBelow: "sm", sortValue: (r) => r.updatedAt, cell: (r) => <TimeAgo date={r.updatedAt} className="text-sm text-muted-foreground" /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {r.kind === "deck" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" asChild aria-label="Present">
                  <Link href={`${base}/${r.id}/present`}>
                    <Play />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Present</TooltipContent>
            </Tooltip>
          ) : null}
          <Button size="sm" variant="outline" asChild>
            <Link href={openHref(r)}>
              {r.kind === "deck" && canManage ? <Pencil className="size-3.5" /> : <FileText className="size-3.5" />}
              {r.kind === "deck" && canManage ? "Edit" : "Open"}
            </Link>
          </Button>
          {menu(r)}
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={
          <>
            Reports <span className="text-muted-foreground tabular">({reports.length})</span>
          </>
        }
        description="Create beautiful, branded reports for your clients — live data, one deck for every client."
        actions={
          canManage && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setNewTab("ai");
                  setNewOpen(true);
                }}
              >
                <Sparkles /> AI report
              </Button>
              <Button
                onClick={() => {
                  setNewTab("library");
                  setNewOpen(true);
                }}
              >
                <Plus /> New Report
              </Button>
            </>
          )
        }
      />
      <Panel contentClassName="p-0">
        <div className="border-b p-3">
          <FilterBar
            search={<SearchInput value={query} onChange={setQuery} placeholder="Search reports…" className="sm:max-w-72" />}
            activeCount={(type !== "all" ? 1 : 0) + (status !== "all" ? 1 : 0)}
          >
            <div className="flex rounded-lg bg-muted p-0.5">
              {(
                [
                  ["all", "All"],
                  ["deck", "Slides"],
                  ["html", "AI reports"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setType(k)}
                  className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", type === k ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg bg-muted p-0.5">
              {(
                [
                  ["all", "Any status"],
                  ["published", "Published"],
                  ["draft", "Draft"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setStatus(k)}
                  className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", status === k ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")}
                >
                  {label}
                </button>
              ))}
            </div>
          </FilterBar>
        </div>
        <DataTable
          columns={columns}
          data={filtered}
          getRowId={(r) => r.id}
          initialSort={{ id: "updated", dir: "desc" }}
          pageSize={25}
          empty={
            reports.length === 0 ? (
              <EmptyState
                icon={Presentation}
                title="No reports yet"
                description="Build a branded pitch deck or monthly report from a template — every number fills in live from this project's AI visibility data."
                action={canManage ? { label: "New Report", onClick: () => setNewOpen(true) } : undefined}
              />
            ) : (
              <div className="py-12 text-center text-sm text-muted-foreground">No reports match your filters.</div>
            )
          }
          mobileCard={(r) => (
            <div className="flex gap-3 p-3">
              <Link href={openHref(r)} className="w-28 shrink-0">
                {thumb(r, "w-28")}
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={openHref(r)} className="line-clamp-2 text-sm font-medium">
                  {r.title}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <StatusBadge status={r.status} />
                  {r.kind === "deck" ? `${r.slideCount} slides` : "AI report"}
                  <span>·</span>
                  <TimeAgo date={r.updatedAt} />
                </div>
                <div className="mt-2 flex items-center gap-1">
                  {r.kind === "deck" && (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`${base}/${r.id}/present`}>
                        <Play className="size-3.5" /> Present
                      </Link>
                    </Button>
                  )}
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`${base}/${r.id}`}>View</Link>
                  </Button>
                  {menu(r)}
                </div>
              </div>
            </div>
          )}
        />
      </Panel>

      <NewReportDialog projectId={projectId} open={newOpen} onOpenChange={setNewOpen} theme={theme} bundle={bundle} appName={shell.branding.appName} defaultTab={newTab} canManageWorkspace={canManageWorkspace} />
      {dialog?.kind === "share" && (
        <ShareDialog
          projectId={projectId}
          reportId={dialog.r.id}
          kind={dialog.r.kind}
          open
          onOpenChange={(v) => !v && setDialog(null)}
          canManage={canManage}
          onChanged={(s) => setReports((prev) => prev.map((x) => (x.id === dialog.r.id ? { ...x, status: s.status, shareEnabled: s.shareEnabled } : x)))}
        />
      )}
      {dialog?.kind === "rename" && (
        <RenameDialog
          projectId={projectId}
          reportId={dialog.r.id}
          open
          onOpenChange={(v) => !v && setDialog(null)}
          initial={{ title: dialog.r.title, subtitle: dialog.r.subtitle }}
          onDone={(v) => setReports((prev) => prev.map((x) => (x.id === dialog.r.id ? { ...x, ...v } : x)))}
        />
      )}
      {dialog?.kind === "template" && <SaveTemplateDialog projectId={projectId} reportId={dialog.r.id} open onOpenChange={(v) => !v && setDialog(null)} defaultName={dialog.r.title} />}
      <AlertDialog open={dialog?.kind === "delete"} onOpenChange={(v) => !v && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this report?</AlertDialogTitle>
            <AlertDialogDescription>“{dialog?.kind === "delete" ? dialog.r.title : ""}” and its share link will be removed permanently.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (dialog?.kind === "delete") void remove(dialog.r);
                setDialog(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {dialog?.kind === "duplicate" && (
        <DuplicateDialog
          projectId={projectId}
          reportId={dialog.r.id}
          open
          onOpenChange={(v) => !v && setDialog(null)}
          onDone={(res) => {
            if (res.projectId === projectId) start(() => router.refresh());
          }}
        />
      )}
    </PageContainer>
  );
}
