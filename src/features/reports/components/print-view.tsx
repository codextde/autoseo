"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DataBundle } from "../lib/bundle";
import type { ResolvedData } from "../lib/catalog";
import type { Deck } from "../lib/types";
import { SlideView, type RenderCtx } from "./slide/slide-view";
import { useElementSize } from "./slide/scaled-slide";

const noopSubscribe = () => () => {};

/**
 * Print/PDF view: every slide becomes one page of exactly the deck size (1920×1080 px). Rendered in
 * a portal directly under <body> so the app shell can be hidden for printing.
 */
export function PrintView({
  deck,
  bundle,
  resolved = null,
  title,
  subtitle,
  assetUrl,
  backHref,
  autoPrint,
}: {
  deck: Deck;
  bundle: DataBundle | null;
  resolved?: ResolvedData | null;
  title: string;
  subtitle?: string | null;
  assetUrl: (id: string) => string;
  backHref?: string;
  autoPrint?: boolean;
}) {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const [ref, size] = useElementSize<HTMLDivElement>();
  const ctx: RenderCtx = useMemo(() => ({ deck, data: { bundle, resolved, report: { title, subtitle } }, assetUrl, mode: "view" }), [deck, bundle, resolved, title, subtitle, assetUrl]);
  const slides = deck.slides.filter((s) => !s.hidden);
  const { w, h } = deck.size;
  const scale = size.w ? Math.min(1, (size.w - 32) / w) : 0.5;

  useEffect(() => {
    if (!mounted || !autoPrint) return;
    let cancelled = false;
    const run = async () => {
      try {
        await document.fonts?.ready;
      } catch {
        // ignore
      }
      const imgs = [...document.querySelectorAll<HTMLImageElement>("#report-print-root img")];
      await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r))))));
      if (!cancelled) setTimeout(() => window.print(), 300);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [mounted, autoPrint]);

  if (!mounted) return <div className="p-6 text-sm text-muted-foreground">Preparing print view…</div>;

  return createPortal(
    <div id="report-print-root" className="fixed inset-0 z-[70] overflow-y-auto bg-neutral-200 text-neutral-900 dark:bg-neutral-900">
      <style>{`
        @page { size: ${w}px ${h}px; margin: 0; }
        @media print {
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; height: auto !important; }
          body > *:not(#report-print-root) { display: none !important; }
          #report-print-root { position: static !important; overflow: visible !important; background: #fff !important; }
          #report-print-root .print-toolbar { display: none !important; }
          #report-print-root .print-pages { padding: 0 !important; gap: 0 !important; }
          #report-print-root .print-page { width: ${w}px !important; height: ${h}px !important; margin: 0 !important; box-shadow: none !important; break-after: page; page-break-after: always; }
          #report-print-root .print-page:last-child { break-after: auto; page-break-after: auto; }
          #report-print-root .print-scale { transform: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      <div className="print-toolbar sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/95 px-3 py-2 text-foreground backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          {backHref && (
            <Button size="sm" variant="ghost" asChild>
              <a href={backHref}>
                <ArrowLeft /> Back
              </a>
            </Button>
          )}
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {slides.length} pages · {w}×{h}px — choose “Save as PDF” and enable background graphics
          </span>
        </div>
        <Button size="sm" onClick={() => window.print()}>
          <Printer /> Print / Save PDF
        </Button>
      </div>
      <div ref={ref} className="print-pages flex flex-col items-center gap-6 px-4 py-6">
        {slides.map((s) => (
          <div key={s.id} className="print-page overflow-hidden bg-white shadow-lg" style={{ width: w * scale, height: h * scale }}>
            <div className="print-scale" style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
              <SlideView slide={s} ctx={ctx} />
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
