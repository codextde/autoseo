"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ExternalLink, FileDown, Loader2, Maximize2, Minimize2, RefreshCw, Share2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, TimeAgo } from "@/components/app/misc";
import { cn } from "@/lib/utils";
import { aiReportStatusAction, regenerateAiReportAction } from "../actions";
import { ShareDialog } from "./share-dialog";

export function HtmlReportViewer({
  projectId,
  reportId,
  title,
  summary,
  prompt,
  aiStatus: initialStatus,
  aiError,
  createdByLabel,
  createdByName,
  updatedAt,
  status,
  canManage,
}: {
  projectId: string;
  reportId: string;
  title: string;
  summary: string | null;
  prompt: string | null;
  aiStatus: "idle" | "queued" | "running" | "ready" | "failed";
  aiError: string | null;
  createdByLabel: string | null;
  createdByName: string | null;
  updatedAt: string;
  status: "draft" | "published";
  canManage: boolean;
}) {
  const router = useRouter();
  const [aiStatus, setAiStatus] = useState(initialStatus);
  const [error, setError] = useState(aiError);
  const [full, setFull] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [newPrompt, setNewPrompt] = useState(prompt ?? "");
  const [pending, start] = useTransition();
  const base = `/p/${projectId}/reports/${reportId}`;
  const generating = aiStatus === "queued" || aiStatus === "running";

  useEffect(() => {
    if (!generating) return;
    const t = setInterval(async () => {
      const r = await aiReportStatusAction(projectId, reportId);
      if (!r.ok) return;
      setAiStatus(r.data.aiStatus);
      setError(r.data.aiError);
      if (r.data.aiStatus === "ready") router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [generating, projectId, reportId, router]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const regenerate = () =>
    start(async () => {
      const r = await regenerateAiReportAction(projectId, reportId, { prompt: newPrompt || undefined });
      if (!r.ok) return void toast.error(r.error);
      setAiStatus("queued");
      setError(null);
      setRegenOpen(false);
    });

  return (
    <div className={cn("flex flex-col", full ? "fixed inset-0 z-50 bg-background" : "min-h-[calc(100dvh-3.5rem)]")}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:px-5">
        <Button size="icon-sm" variant="ghost" asChild aria-label="Back to reports">
          <Link href={`/p/${projectId}/reports`}>
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold sm:text-base">{title}</h1>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <StatusBadge status={status} className="py-0 text-[10px]" />
            <span>
              <Sparkles className="mr-0.5 inline size-3" />
              {createdByLabel ?? "AI report"}
              {createdByName ? ` · ${createdByName}` : ""}
            </span>
            <span>
              · updated <TimeAgo date={updatedAt} />
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {canManage && (
            <Button size="sm" variant="ghost" onClick={() => setRegenOpen(true)} disabled={generating}>
              <RefreshCw /> <span className="hidden sm:inline">Regenerate</span>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setShareOpen(true)}>
            <Share2 /> <span className="hidden sm:inline">Share</span>
          </Button>
          {aiStatus === "ready" && (
            <>
              <Button size="sm" variant="ghost" asChild>
                <a href={`${base}/raw?print=1`} target="_blank" rel="noreferrer">
                  <FileDown /> <span className="hidden sm:inline">Export</span>
                </a>
              </Button>
              <Button size="icon-sm" variant="ghost" asChild aria-label="Open in new tab">
                <a href={`${base}/raw`} target="_blank" rel="noreferrer">
                  <ExternalLink />
                </a>
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => setFull((v) => !v)} aria-label={full ? "Exit full screen" : "Full screen"}>
                {full ? <Minimize2 /> : <Maximize2 />}
              </Button>
            </>
          )}
        </div>
      </div>
      {generating ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md text-center">
            <Loader2 className="mx-auto size-8 animate-spin text-brand" />
            <h2 className="mt-4 font-semibold">The agent is writing your report…</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              It analyses this project&apos;s live AI visibility data and writes a self-contained report. This usually takes 1–5 minutes; you can leave this page.
            </p>
          </div>
        </div>
      ) : aiStatus === "failed" ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-lg text-center">
            <AlertTriangle className="mx-auto size-8 text-destructive" />
            <h2 className="mt-4 font-semibold">Report generation failed</h2>
            <p className="mt-1 text-sm break-words text-muted-foreground">{error ?? "Unknown error"}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              AI reports run on a connected local agent (Claude Code / Codex) or an API key — configure one in Admin → AI Providers or Local Agents.
            </p>
            {canManage && (
              <Button className="mt-4" onClick={() => setRegenOpen(true)}>
                <RefreshCw /> Try again
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          {summary && !full && <p className="border-b bg-muted/30 px-5 py-2 text-xs text-muted-foreground">{summary}</p>}
          <iframe
            title={title}
            src={`${base}/raw`}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            className="min-h-[70dvh] w-full flex-1 border-0 bg-white"
            referrerPolicy="no-referrer"
          />
        </>
      )}
      <ShareDialog projectId={projectId} reportId={reportId} kind="html" open={shareOpen} onOpenChange={setShareOpen} canManage={canManage} />
      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Regenerate report</DialogTitle>
            <DialogDescription>The agent rewrites the report from the latest data. Adjust the brief if you like.</DialogDescription>
          </DialogHeader>
          <Textarea rows={7} value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} maxLength={4000} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRegenOpen(false)}>
              Cancel
            </Button>
            <Button onClick={regenerate} disabled={pending || newPrompt.trim().length < 3}>
              {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
