"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Renders children at a fixed virtual size (e.g. 1280×800) scaled down to the available width.
 * The content is inert (no interaction) — it's a visual preview.
 */
export function PreviewFrame({
  width,
  height,
  children,
  className,
  device,
}: {
  width: number;
  height: number;
  children: React.ReactNode;
  className?: string;
  device: "desktop" | "mobile";
}) {
  const outer = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => {
      const w = frame.current?.clientWidth ?? el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / width));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={outer} className={cn("w-full", device === "mobile" && "mx-auto max-w-[320px]", className)}>
      <div
        ref={frame}
        className={cn(
          "relative overflow-hidden border bg-background shadow-lg ring-1 ring-black/5",
          device === "mobile" ? "rounded-[28px] border-[6px] border-foreground/85" : "rounded-xl",
        )}
        style={{ height: height * scale + (device === "mobile" ? 12 : 22) }}
      >
        {device === "desktop" && (
          <div className="flex items-center gap-1 border-b bg-muted/60 px-2" style={{ height: 20 }}>
            <span className="size-1.5 rounded-full bg-red-400/70" />
            <span className="size-1.5 rounded-full bg-amber-400/70" />
            <span className="size-1.5 rounded-full bg-green-400/70" />
          </div>
        )}
        <div
          inert
          aria-hidden
          className="pointer-events-none origin-top-left select-none"
          style={{ width, height, transform: `scale(${scale})` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
