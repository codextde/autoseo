"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, FileDown, Loader2, Pencil, Play, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/misc";
import { cn } from "@/lib/utils";
import type { DataBundle } from "../lib/bundle";
import type { ResolvedData } from "../lib/catalog";
import type { Deck } from "../lib/types";
import { downloadPptx } from "./download";
import { PresentMode } from "./present-mode";
import { ShareDialog } from "./share-dialog";
import { ScaledSlide } from "./slide/scaled-slide";

export type DeckViewerProps = {
  deck: Deck;
  bundle: DataBundle | null;
  /** Pre-resolved values (public share pages send these instead of the bundle). */
  resolved?: ResolvedData | null;
  title: string;
  subtitle?: string | null;
  /** e.g. /p/<id>/reports/assets or /share/r/<token>/asset */
  assetBase: string;
  /** app = inside the product (edit/share actions); share = public link */
  mode: "app" | "share";
  projectId?: string;
  reportId?: string;
  status?: "draft" | "published";
  canManage?: boolean;
  printHref: string;
  backHref?: string;
  presentOnOpen?: boolean;
  poweredBy?: string;
  snapshotAt?: string | null;
};

export function DeckViewer(props: DeckViewerProps) {
  const { deck, bundle, title, subtitle, assetBase, mode } = props;
  const resolved = props.resolved ?? null;
  const assetUrl = useMemo(() => (id: string) => `${assetBase}/${id}`, [assetBase]);
  const [present, setPresent] = useState<number | null>(props.presentOnOpen ? 0 : null);
  const [shareOpen, setShareOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const slides = useMemo(() => deck.slides.filter((s) => !s.hidden), [deck.slides]);
  const ctx = useMemo(() => ({ deck, data: { bundle, resolved, report: { title, subtitle } }, assetUrl, mode: "view" as const }), [deck, bundle, resolved, title, subtitle, assetUrl]);
  const clientName = resolved?.meta.clientName ?? bundle?.project.clientName ?? "";
  const periodLabel = resolved?.meta.periodLabel ?? bundle?.period.label ?? "";

  useEffect(() => {
    if (present !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "p" && !(e.target as HTMLElement).closest("input,textarea")) setPresent(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [present]);

  const pptx = async () => {
    setBusy(true);
    try {
      await downloadPptx({ deck, bundle, resolved, title, subtitle, assetUrl });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={mode === "share" ? "min-h-dvh bg-muted/40" : "bg-muted/40"}>
      <header className={cn("sticky z-20 border-b bg-background/85 backdrop-blur-xl", mode === "share" ? "top-0" : "top-14")}>
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2.5 sm:px-5">
          {props.backHref && (
            <Button size="icon-sm" variant="ghost" asChild aria-label="Back">
              <Link href={props.backHref}>
                <ArrowLeft />
              </Link>
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold sm:text-base">{title}</h1>
            <div className="flex items-center gap-2 truncate text-xs text-muted-foreground">
              {mode === "app" && props.status && <StatusBadge status={props.status} className="py-0 text-[10px]" />}
              <span className="truncate">
                {clientName}
                {periodLabel ? ` · ${periodLabel}` : ""}
                {props.snapshotAt ? ` · data snapshot ${props.snapshotAt.slice(0, 10)}` : ""}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="ghost" asChild className="hidden sm:inline-flex">
              <a href={props.printHref} target="_blank" rel="noreferrer">
                <FileDown /> PDF
              </a>
            </Button>
            <Button size="sm" variant="ghost" className="hidden sm:inline-flex" onClick={() => void pptx()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Download />} PPTX
            </Button>
            {mode === "app" && props.projectId && props.reportId && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setShareOpen(true)}>
                  <Share2 /> <span className="hidden sm:inline">Share</span>
                </Button>
                {props.canManage && (
                  <Button size="sm" variant="outline" asChild className="hidden md:inline-flex">
                    <Link href={`/p/${props.projectId}/reports/${props.reportId}/edit`}>
                      <Pencil /> Edit
                    </Link>
                  </Button>
                )}
              </>
            )}
            <Button size="sm" onClick={() => setPresent(0)}>
              <Play /> Present
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-5 sm:py-8">
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        {slides.map((s, i) => (
          <button key={s.id} type="button" onClick={() => setPresent(i)} className="group relative block w-full text-left" aria-label={`Present from slide ${i + 1}`}>
            <ScaledSlide slide={s} ctx={ctx} className="rounded-xl shadow-soft ring-1 ring-border transition-shadow group-hover:shadow-lg" />
            <span className="absolute right-3 bottom-3 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] text-white tabular opacity-0 transition-opacity group-hover:opacity-100">
              {i + 1} / {slides.length}
            </span>
          </button>
        ))}
        {mode === "share" && props.poweredBy && <p className="pb-4 text-center text-xs text-muted-foreground">{props.poweredBy}</p>}
      </main>
      {present !== null && (
        <PresentMode deck={deck} bundle={bundle} resolved={resolved} title={title} subtitle={subtitle} assetUrl={assetUrl} startIndex={present} onExit={() => setPresent(null)} />
      )}
      {mode === "app" && props.projectId && props.reportId && (
        <ShareDialog projectId={props.projectId} reportId={props.reportId} kind="deck" open={shareOpen} onOpenChange={setShareOpen} canManage={!!props.canManage} />
      )}
    </div>
  );
}
