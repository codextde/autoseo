"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  ChevronDown,
  Cloud,
  Download,
  FileDown,
  LayoutTemplate,
  Loader2,
  Palette,
  Play,
  Redo2,
  Save,
  Share2,
  Undo2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/app/misc";
import { useShell } from "@/components/app/shell-context";
import { cn } from "@/lib/utils";
import { RANGE_PRESETS, rangeLabel } from "../../lib/period";
import { useEditor, useEditorState } from "./store";
import { activeTextEditor } from "./text-editor";

function SaveStatus() {
  const seq = useEditorState((s) => s.seq);
  const savedSeq = useEditorState((s) => s.savedSeq);
  const saving = useEditorState((s) => s.saving);
  const error = useEditorState((s) => s.saveError);
  const savedAt = useEditorState((s) => s.savedAt);
  const [now, setNow] = useState(() => (savedAt ? new Date(savedAt).getTime() : 0));
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().getTime()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (error)
    return (
      <span className="flex items-center gap-1 text-xs text-destructive">
        <AlertTriangle className="size-3.5" /> Not saved
      </span>
    );
  if (saving)
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  if (seq !== savedSeq) return <span className="text-xs text-muted-foreground">Unsaved changes</span>;
  const mins = savedAt ? Math.max(0, Math.round((now - new Date(savedAt).getTime()) / 60000)) : null;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Cloud className="size-3.5" /> {mins === null ? "Saved" : mins < 1 ? "Saved just now" : `Saved ${mins} min ago`}
    </span>
  );
}

export function TopBar({
  status,
  onSave,
  onSaveTemplate,
  onShare,
  onBrandKit,
  onPresent,
  onDownload,
  onTogglePublish,
}: {
  status: "draft" | "published";
  onSave: () => void;
  onSaveTemplate?: () => void;
  onShare: () => void;
  onBrandKit: () => void;
  onPresent: () => void;
  onDownload: (kind: "pdf" | "pptx") => void;
  onTogglePublish: () => void;
}) {
  const { store, projectId, canManage } = useEditor();
  const shell = useShell();
  const title = useEditorState((s) => s.title);
  const canUndo = useEditorState((s) => s.past.length > 0);
  const canRedo = useEditorState((s) => s.future.length > 0);
  const range = useEditorState((s) => s.range);
  const dataProjectId = useEditorState((s) => s.dataProjectId);
  const dataLoading = useEditorState((s) => s.dataLoading);
  const saving = useEditorState((s) => s.saving);
  const [localTitle, setLocalTitle] = useState(title);
  const [prevTitle, setPrevTitle] = useState(title);
  if (prevTitle !== title) {
    setPrevTitle(title);
    setLocalTitle(title);
  }
  const [custom, setCustom] = useState({ from: range.from ?? "", to: range.to ?? "" });
  const [customOpen, setCustomOpen] = useState(false);
  const dataProject = shell.projects.find((p) => p.id === dataProjectId);
  const bump = (patch: Partial<ReturnType<typeof store.getState>>) => store.set({ ...patch, seq: store.getState().seq + 1 });

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-2 sm:px-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" variant="ghost" asChild aria-label="Back to reports">
            <Link href={`/p/${projectId}/reports`}>
              <ArrowLeft />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Back to reports</TooltipContent>
      </Tooltip>
      <div className="flex min-w-0 flex-col">
        <input
          value={localTitle}
          disabled={!canManage}
          onChange={(e) => setLocalTitle(e.target.value)}
          onBlur={() => {
            const t = localTitle.trim();
            if (t && t !== title) bump({ title: t });
            else setLocalTitle(title);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          maxLength={160}
          className="w-44 truncate rounded bg-transparent px-1 text-sm font-semibold outline-none hover:bg-muted/60 focus:bg-muted lg:w-72"
          aria-label="Report title"
        />
        <div className="flex items-center gap-2 px-1">
          <SaveStatus />
          <StatusBadge status={status} className="hidden py-0 text-[10px] xl:inline-flex" />
        </div>
      </div>
      <div className="ml-1 hidden items-center gap-0.5 md:flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" disabled={!canUndo} onClick={() => {
                activeTextEditor.current?.finish();
                store.undo();
              }} aria-label="Undo">
              <Undo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo ⌘Z</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" disabled={!canRedo} onClick={() => {
                activeTextEditor.current?.finish();
                store.redo();
              }} aria-label="Redo">
              <Redo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo ⇧⌘Z</TooltipContent>
        </Tooltip>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="hidden lg:inline-flex">
              <Download /> Download <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onDownload("pdf")}>
              <FileDown /> PDF (print)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDownload("pptx")}>
              <Download /> PowerPoint (.pptx)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverAnchor asChild>
          <div>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                {dataLoading ? <Loader2 className="animate-spin" /> : <Calendar />}
                <span className="hidden sm:inline">{rangeLabel(range)}</span>
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Reporting period</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={range.preset}
                onValueChange={(v) => {
                  if (v === "custom") setCustomOpen(true);
                  else bump({ range: { preset: v } });
                }}
              >
                {RANGE_PRESETS.map((p) => (
                  <DropdownMenuRadioItem key={p.key} value={p.key}>
                    {p.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
          </PopoverAnchor>
          <PopoverContent align="end" className="w-72 space-y-2">
            <div className="text-sm font-medium">Custom range</div>
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
              <Input type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!custom.from || !custom.to}
                onClick={() => {
                  bump({ range: { preset: "custom", from: custom.from, to: custom.to } });
                  setCustomOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        {shell.projects.length > 1 && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className={cn("hidden gap-1.5 xl:inline-flex", dataProjectId !== projectId && "border-violet-500/50 text-violet-600 dark:text-violet-300")}>
                <Users /> <span className="max-w-28 truncate">{dataProject?.name ?? "Client"}</span> <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-60 overflow-y-auto">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Preview with data from…</DropdownMenuLabel>
              {shell.projects.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => store.set({ dataProjectId: p.id })}>
                  <span className="truncate">{p.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{p.domain}</span>
                  {p.id === dataProjectId && <Check className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button size="sm" variant="ghost" className="hidden md:inline-flex" onClick={onBrandKit} disabled={!canManage}>
          <Palette /> <span className="hidden xl:inline">Brand kit</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={onShare}>
          <Share2 /> <span className="hidden xl:inline">Share</span>
        </Button>
        <Button size="sm" variant="outline" onClick={onPresent}>
          <Play /> <span className="hidden sm:inline">Present</span>
        </Button>
        {canManage && (
          <div className="flex">
            <Button size="sm" className="rounded-r-none" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="rounded-l-none border-l border-l-primary-foreground/20 px-1.5" aria-label="More save options">
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={onSave}>
                  <Save /> Save now <span className="ml-auto text-xs text-muted-foreground">⌘S</span>
                </DropdownMenuItem>
                {onSaveTemplate && (
                  <DropdownMenuItem onClick={onSaveTemplate}>
                    <LayoutTemplate /> Save as template
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onTogglePublish}>
                  <Check /> {status === "published" ? "Unpublish (back to draft)" : "Publish"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDownload("pdf")} className="lg:hidden">
                  <FileDown /> Download PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDownload("pptx")} className="lg:hidden">
                  <Download /> Download PPTX
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </header>
  );
}
