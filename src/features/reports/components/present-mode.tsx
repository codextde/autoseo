"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Maximize, Minimize, NotebookText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { interpolate } from "../lib/catalog";
import type { DataBundle } from "../lib/bundle";
import type { ResolvedData } from "../lib/catalog";
import type { Deck } from "../lib/types";
import { FitSlide } from "./slide/scaled-slide";
import type { RenderCtx } from "./slide/slide-view";

/**
 * Full-screen presenter: keyboard (←/→/Space/PgUp/PgDn/Home/End, F fullscreen, N notes, Esc),
 * touch swipe, click-to-advance, progress bar and optional speaker notes.
 */
export function PresentMode({
  deck,
  bundle,
  resolved = null,
  title,
  subtitle,
  assetUrl,
  startIndex = 0,
  onExit,
}: {
  deck: Deck;
  bundle: DataBundle | null;
  resolved?: ResolvedData | null;
  title: string;
  subtitle?: string | null;
  assetUrl: (id: string) => string;
  startIndex?: number;
  onExit: () => void;
}) {
  const slides = useMemo(() => deck.slides.filter((s) => !s.hidden), [deck.slides]);
  const [index, setIndex] = useState(Math.max(0, Math.min(slides.length - 1, startIndex)));
  const [dir, setDir] = useState(1);
  const [notes, setNotes] = useState(false);
  const [idle, setIdle] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ctx: RenderCtx = useMemo(() => ({ deck, data: { bundle, resolved, report: { title, subtitle } }, assetUrl, mode: "view" }), [deck, bundle, resolved, title, subtitle, assetUrl]);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const next = Math.max(0, Math.min(slides.length - 1, i + delta));
        if (next !== i) setDir(delta > 0 ? 1 : -1);
        return next;
      });
    },
    [slides.length],
  );

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      // fullscreen not allowed (iframe / iOS) – the overlay is already full-window
    }
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        go(1);
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Home") setIndex(0);
      else if (e.key === "End") setIndex(slides.length - 1);
      else if (e.key.toLowerCase() === "f") void toggleFullscreen();
      else if (e.key.toLowerCase() === "n") setNotes((v) => !v);
      else if (e.key === "Escape" && !document.fullscreenElement) onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onExit, slides.length, toggleFullscreen]);

  useEffect(() => {
    const bump = () => {
      setIdle(false);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setIdle(true), 2500);
    };
    bump();
    window.addEventListener("mousemove", bump);
    return () => {
      window.removeEventListener("mousemove", bump);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const slide = slides[index];
  if (!slide) return null;
  const note = slide.notes ? interpolate(slide.notes, ctx.data) : "";

  return (
    <div ref={rootRef} className={cn("fixed inset-0 z-[60] flex flex-col bg-black text-white select-none", idle && !notes && "cursor-none")}>
      <div
        className="relative min-h-0 flex-1"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          go(e.clientX - r.left < r.width * 0.3 ? -1 : 1);
        }}
        onTouchStart={(e) => {
          const t = e.touches[0]!;
          touch.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          touch.current = null;
          if (!start) return;
          const t = e.changedTouches[0]!;
          const dx = t.clientX - start.x;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(t.clientY - start.y)) go(dx < 0 ? 1 : -1);
        }}
      >
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={slide.id}
            custom={dir}
            className="absolute inset-0"
            initial={{ opacity: 0, x: dir * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -dir * 40 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <FitSlide slide={slide} ctx={ctx} className="p-0 sm:p-4" />
          </motion.div>
        </AnimatePresence>
        <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 pb-3 transition-opacity", idle && "opacity-0")}>
          <button type="button" onClick={(e) => { e.stopPropagation(); go(-1); }} disabled={index === 0} className="pointer-events-auto rounded-full bg-black/50 p-2 backdrop-blur hover:bg-white/15 disabled:opacity-30" aria-label="Previous slide">
            <ChevronLeft className="size-5" />
          </button>
          <span className="rounded-full bg-black/50 px-3 py-1 text-xs tabular backdrop-blur">
            {index + 1} / {slides.length}
          </span>
          <button type="button" onClick={(e) => { e.stopPropagation(); go(1); }} disabled={index === slides.length - 1} className="pointer-events-auto rounded-full bg-black/50 p-2 backdrop-blur hover:bg-white/15 disabled:opacity-30" aria-label="Next slide">
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>
      {notes && (
        <div className="max-h-[30vh] shrink-0 overflow-y-auto border-t border-white/10 bg-neutral-950 px-5 py-3 text-sm leading-relaxed text-white/85">
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-white/50 uppercase">Speaker notes · slide {index + 1}</div>
          {note || <span className="text-white/40">No notes for this slide.</span>}
        </div>
      )}
      <div className={cn("pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3 transition-opacity", idle && "opacity-0")}>
        <div className="pointer-events-auto max-w-[60%] truncate rounded-full bg-black/50 px-3 py-1.5 text-xs text-white/80 backdrop-blur">{title}</div>
        <div className="pointer-events-auto flex items-center gap-1">
          <button type="button" onClick={() => setNotes((v) => !v)} className={cn("rounded-full bg-black/50 p-2 backdrop-blur hover:bg-white/15", notes && "bg-white/20")} aria-label="Speaker notes (N)" title="Speaker notes (N)">
            <NotebookText className="size-4" />
          </button>
          <button type="button" onClick={() => void toggleFullscreen()} className="hidden rounded-full bg-black/50 p-2 backdrop-blur hover:bg-white/15 sm:block" aria-label="Fullscreen (F)" title="Fullscreen (F)">
            {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </button>
          <button type="button" onClick={onExit} className="rounded-full bg-black/50 p-2 backdrop-blur hover:bg-white/15" aria-label="Exit (Esc)" title="Exit (Esc)">
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="h-1 shrink-0 bg-white/10">
        <div className="h-full transition-[width] duration-300" style={{ width: `${((index + 1) / slides.length) * 100}%`, background: deck.theme.colors.accent }} />
      </div>
    </div>
  );
}
