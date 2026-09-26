"use client";

import { CopyButton } from "@/components/app/misc";
import { cn } from "@/lib/utils";

/** Monospace snippet with a copy button (scrolls horizontally inside the card on mobile). */
export function CodeBlock({ code, label, className, copyValue }: { code: string; label?: string; className?: string; copyValue?: string }) {
  return (
    <div className={cn("min-w-0 overflow-hidden rounded-xl border bg-muted/40", className)}>
      {label && (
        <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
          <span className="truncate text-[11px] font-medium text-muted-foreground">{label}</span>
          <CopyButton value={copyValue ?? code} size="icon" />
        </div>
      )}
      <div className="relative">
        <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre">{code}</pre>
        {!label && <CopyButton value={copyValue ?? code} size="icon" className="absolute top-1.5 right-1.5 bg-background/80 backdrop-blur" />}
      </div>
    </div>
  );
}
