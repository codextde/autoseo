"use client";

import { useMemo, useState } from "react";
import { Hash, Search, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TOKENS, TOKEN_CATEGORIES, resolveToken, type ResolveCtx } from "../../lib/catalog";

export function MetricsBrowser({
  open,
  onOpenChange,
  ctx,
  onInsertToken,
  onInsertKpi,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: ResolveCtx;
  onInsertToken: (key: string) => void;
  onInsertKpi: (key: string) => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.entries(TOKENS).filter(
      ([k, d]) => !k.endsWith("_prev") && (cat === "All" || d.category === cat) && (!needle || d.label.toLowerCase().includes(needle) || k.includes(needle) || (d.description ?? "").toLowerCase().includes(needle)),
    );
  }, [q, cat]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>All metrics</DialogTitle>
          <DialogDescription>Every live field you can place on a slide. Values shown for the current client and period.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-44 sm:flex-col sm:border-r sm:border-b-0">
            {["All", ...TOKEN_CATEGORIES].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={cn("shrink-0 rounded-md px-2.5 py-1.5 text-left text-xs font-medium", cat === c ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60")}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="size-4 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search metrics…" className="w-full bg-transparent text-sm outline-none" autoFocus />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {rows.map(([k, d]) => (
                <div key={k} className="flex items-center gap-3 border-b px-3 py-2 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.label}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{k}</span>
                      {d.description ? ` · ${d.description}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 rounded bg-violet-500/12 px-1.5 py-0.5 font-mono text-xs text-violet-600 tabular dark:text-violet-300">{resolveToken(k, ctx).text.slice(0, 24)}</span>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      onInsertToken(k);
                      onOpenChange(false);
                    }}
                  >
                    <Type /> Text
                  </Button>
                  {d.format !== "text" && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        onInsertKpi(k);
                        onOpenChange(false);
                      }}
                    >
                      <Hash /> KPI
                    </Button>
                  )}
                </div>
              ))}
              {!rows.length && <div className="p-8 text-center text-sm text-muted-foreground">No metrics match.</div>}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
