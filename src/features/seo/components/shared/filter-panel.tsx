"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type FilterValues = Record<string, string>;
export type TextField = { key: string; label: string; placeholder?: string };
export type RangeField = { label: string; minKey: string; maxKey: string; step?: number; min?: number; max?: number };

export function countActive(values: FilterValues): number {
  return Object.values(values).filter((v) => v != null && String(v).trim() !== "").length;
}

/** Filters toggle button with active-count badge. */
export function FiltersToggle({ open, onToggle, active }: { open: boolean; onToggle: () => void; active: number }) {
  return (
    <Button type="button" variant={open ? "secondary" : "outline"} size="sm" className="h-8 gap-1.5" onClick={onToggle} aria-expanded={open}>
      <SlidersHorizontal className="size-3.5" />
      Filters
      {active > 0 && <span className="rounded-full bg-foreground px-1.5 text-[10px] leading-4 text-background">{active}</span>}
    </Button>
  );
}

/**
 * Collapsible "Refine table results" panel (open-seo DomainFilterPanel). `mode="apply"` keeps a draft that is only
 * applied explicitly (server-side filters, 8-condition DataForSEO budget); `mode="live"` applies on every change
 * (client-side filters, no cost).
 */
export function FilterPanel({
  open,
  mode = "apply",
  values,
  onApply,
  textFields = [],
  rangeFields = [],
  extras,
  budget,
  countConditions,
  className,
}: {
  open: boolean;
  mode?: "apply" | "live";
  values: FilterValues;
  onApply: (values: FilterValues) => void;
  textFields?: TextField[];
  rangeFields?: RangeField[];
  extras?: (draft: FilterValues, set: (k: string, v: string) => void) => React.ReactNode;
  /** Max DataForSEO filter conditions for this view. */
  budget?: number;
  countConditions?: (values: FilterValues) => number;
  className?: string;
}) {
  const [draft, setDraft] = useState<FilterValues>(values);
  // Reset the draft when the applied values change (compared by value, not identity).
  const valuesKey = JSON.stringify(values);
  const [appliedKey, setAppliedKey] = useState(valuesKey);
  if (appliedKey !== valuesKey) {
    setAppliedKey(valuesKey);
    setDraft(values);
  }
  const set = (k: string, v: string) => {
    const next = { ...draft, [k]: v };
    setDraft(next);
    if (mode === "live") onApply(next);
  };
  const keys = useMemo(() => new Set([...Object.keys(values), ...Object.keys(draft)]), [values, draft]);
  const dirty = [...keys].filter((k) => (values[k] ?? "") !== (draft[k] ?? "")).length;
  const active = countActive(values);
  const conditions = countConditions ? countConditions(draft) : null;
  const over = budget != null && conditions != null && conditions > budget;
  const clear = () => {
    const empty: FilterValues = Object.fromEntries([...keys].map((k) => [k, ""]));
    setDraft(empty);
    onApply(empty);
  };
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="overflow-hidden"
        >
          <div
            className={cn("mt-3 rounded-xl border bg-muted/30 p-3 sm:p-4", className)}
            onKeyDown={(e) => {
              if (mode === "apply" && e.key === "Enter" && dirty > 0 && !over) {
                e.preventDefault();
                onApply(draft);
              }
            }}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Refine table results</span>
              {active > 0 && <Badge variant="secondary">{active} active</Badge>}
              {mode === "apply" && dirty > 0 && <Badge variant="outline">{dirty} unapplied</Badge>}
              {(active > 0 || dirty > 0) && (
                <Button type="button" variant="ghost" size="xs" className="ml-auto" onClick={clear}>
                  <X /> Clear all
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {textFields.map((f) => (
                <label key={f.key} className="space-y-1">
                  <span className="text-xs text-muted-foreground">{f.label}</span>
                  <Input value={draft[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} className="h-8 bg-background text-sm" />
                </label>
              ))}
              {rangeFields.map((f) => (
                <div key={f.minKey} className="space-y-1">
                  <span className="text-xs text-muted-foreground">{f.label}</span>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step={f.step ?? 1}
                      min={f.min}
                      max={f.max}
                      placeholder="Min"
                      value={draft[f.minKey] ?? ""}
                      onChange={(e) => set(f.minKey, e.target.value)}
                      className="h-8 bg-background text-sm tabular"
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step={f.step ?? 1}
                      min={f.min}
                      max={f.max}
                      placeholder="Max"
                      value={draft[f.maxKey] ?? ""}
                      onChange={(e) => set(f.maxKey, e.target.value)}
                      className="h-8 bg-background text-sm tabular"
                    />
                  </div>
                </div>
              ))}
            </div>
            {extras && <div className="mt-3 flex flex-wrap items-center gap-4">{extras(draft, set)}</div>}
            {over && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="size-3.5" />
                Too many filter conditions ({conditions} of {budget} max). Remove some terms or ranges before applying.
              </p>
            )}
            {mode === "apply" && (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
                {budget != null && conditions != null && (
                  <span className={cn("mr-auto text-xs tabular", over ? "text-destructive" : "text-muted-foreground")}>
                    {conditions} / {budget} conditions
                  </span>
                )}
                <Button type="button" variant="ghost" size="sm" disabled={dirty === 0} onClick={() => setDraft(values)}>
                  Cancel
                </Button>
                <Button type="button" size="sm" disabled={dirty === 0 || over} onClick={() => onApply(draft)}>
                  Apply filters
                  {dirty > 0 && <span className="rounded-full bg-background/20 px-1.5 text-[10px]">{dirty}</span>}
                </Button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
