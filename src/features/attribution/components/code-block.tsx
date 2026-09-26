"use client";

import { CopyButton } from "@/components/app/misc";
import { cn } from "@/lib/utils";

export function CodeBlock({ code, className, label, maxHeight = 320 }: { code: string; className?: string; label?: string; maxHeight?: number }) {
  return (
    <div className={cn("relative min-w-0 overflow-hidden rounded-xl border bg-muted/40", className)}>
      <div className="flex items-center justify-between gap-2 border-b bg-background/60 px-3 py-1.5">
        <span className="truncate text-[11px] font-medium text-muted-foreground">{label ?? "Code"}</span>
        <CopyButton value={code} className="h-7 text-xs" />
      </div>
      <pre className="overflow-auto p-3 font-mono text-[11.5px] leading-relaxed" style={{ maxHeight }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** One-time secret reveal (tokens / URLs shown once). */
export function SecretReveal({ title, items }: { title: string; items: Array<{ label: string; value: string }> }) {
  return (
    <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
      <p className="text-xs font-medium text-warning">{title}</p>
      {items.map((it) => (
        <div key={it.label} className="space-y-1">
          <p className="text-[11px] text-muted-foreground">{it.label}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-2 py-1.5 font-mono text-[11px]" title={it.value}>
              {it.value}
            </code>
            <CopyButton value={it.value} size="icon" />
          </div>
        </div>
      ))}
    </div>
  );
}
