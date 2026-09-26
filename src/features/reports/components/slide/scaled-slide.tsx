"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { Slide } from "../../lib/types";
import { SlideView, type RenderCtx } from "./slide-view";

/** Tracks an element's content box size. */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * Renders a slide scaled to the container width (keeps the deck's aspect ratio).
 * Used for thumbnails, the template gallery, list previews and the mobile viewer.
 */
export function ScaledSlide({
  slide,
  ctx,
  className,
  style,
  rounded = true,
}: {
  slide: Slide;
  ctx: RenderCtx;
  className?: string;
  style?: CSSProperties;
  rounded?: boolean;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { w, h } = ctx.deck.size;
  const scale = size.w ? size.w / w : 0;
  return (
    <div
      ref={ref}
      className={cn("relative w-full overflow-hidden", rounded && "rounded-lg", className)}
      style={{ aspectRatio: `${w} / ${h}`, background: ctx.deck.theme.colors.bg, ...style }}
    >
      {scale > 0 && (
        <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
          <SlideView slide={slide} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

/** Fits a slide into a box (both dimensions), centered — used by present mode. */
export function FitSlide({ slide, ctx, className }: { slide: Slide; ctx: RenderCtx; className?: string }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { w, h } = ctx.deck.size;
  const scale = size.w && size.h ? Math.min(size.w / w, size.h / h) : 0;
  return (
    <div ref={ref} className={cn("relative h-full w-full overflow-hidden", className)}>
      {scale > 0 && (
        <div
          style={{
            position: "absolute",
            left: (size.w - w * scale) / 2,
            top: (size.h - h * scale) / 2,
            width: w,
            height: h,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
            boxShadow: "0 30px 80px -30px rgba(0,0,0,0.6)",
          }}
        >
          <SlideView slide={slide} ctx={ctx} />
        </div>
      )}
    </div>
  );
}
