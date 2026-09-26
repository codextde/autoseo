"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { FunnelIcon, topicColor } from "../shared/bits";
import { NO_PERSONA, NO_TOPIC, type FilterKey, type Filters } from "./filter-logic";
import type { FunnelStage } from "../../types";

type Counts = Record<FilterKey, Map<string, number>>;

type Option = { value: string; label: React.ReactNode; count: number; color?: string };

function Group({
  title,
  options,
  selected,
  onToggle,
  defaultOpen = true,
  bars,
  max = 8,
}: {
  title: string;
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
  defaultOpen?: boolean;
  bars?: boolean;
  max?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);
  const top = Math.max(1, ...options.map((o) => o.count));
  const visible = showAll ? options : options.slice(0, max);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b py-2.5 last:border-0">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-1 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground">
        <span>
          {title}
          {selected.length > 0 && <span className="ml-1.5 rounded-full bg-foreground px-1.5 py-px text-[10px] text-background normal-case">{selected.length}</span>}
        </span>
        <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-0.5 pt-1.5">
        {options.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground">No values</p>}
        {visible.map((o) => {
          const checked = selected.includes(o.value);
          return (
            <label
              key={o.value}
              className={cn(
                "relative flex cursor-pointer items-center gap-2 overflow-hidden rounded-md px-1.5 py-1.5 text-sm hover:bg-muted/60",
                o.count === 0 && !checked && "opacity-50",
              )}
            >
              {bars && (
                <span
                  className="pointer-events-none absolute inset-y-1 left-0 rounded-r-md opacity-15"
                  style={{ width: `${Math.max(4, (o.count / top) * 100)}%`, background: o.color ?? "var(--chart-3)" }}
                />
              )}
              <Checkbox checked={checked} onCheckedChange={() => onToggle(o.value)} className="relative" />
              {o.color && <span className="relative size-2 shrink-0 rounded-full" style={{ background: o.color }} />}
              <span className="relative min-w-0 flex-1 truncate">{o.label}</span>
              <span className="relative text-xs text-muted-foreground tabular">{o.count}</span>
            </label>
          );
        })}
        {options.length > max && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="px-1.5 pt-1 text-xs text-muted-foreground hover:text-foreground">
            {showAll ? "Show less" : `Show all ${options.length}`}
          </button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function FilterPanel({
  filters,
  counts,
  topics,
  personas,
  onToggle,
  onClear,
  activeCount,
  className,
}: {
  filters: Filters;
  counts: Counts;
  topics: string[];
  personas: string[];
  onToggle: (key: FilterKey, value: string) => void;
  onClear: () => void;
  activeCount: number;
  className?: string;
}) {
  const topicOptions: Option[] = topics
    .map((t) => ({ value: t, label: t === NO_TOPIC ? "No topic" : t, count: counts.topics.get(t) ?? 0, color: topicColor(t === NO_TOPIC ? null : t) }))
    .sort((a, b) => b.count - a.count);
  const funnel: FunnelStage[] = ["tofu", "mofu", "bofu"];
  return (
    <div className={cn("text-sm", className)}>
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-sm font-semibold">Filters</span>
        {activeCount > 0 && (
          <button type="button" onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">
            Clear all ({activeCount})
          </button>
        )}
      </div>
      <Group title="Topics" options={topicOptions} selected={filters.topics} onToggle={(v) => onToggle("topics", v)} bars max={10} />
      <Group
        title="Prompt Length"
        options={[
          { value: "short", label: "Short (≤ 8 words)", count: counts.len.get("short") ?? 0 },
          { value: "medium", label: "Medium (9–18)", count: counts.len.get("medium") ?? 0 },
          { value: "long", label: "Long (19+)", count: counts.len.get("long") ?? 0 },
        ]}
        selected={filters.len}
        onToggle={(v) => onToggle("len", v)}
      />
      <Group
        title="Funnel Stage"
        options={funnel.map((s) => ({
          value: s,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <FunnelIcon stage={s} withTooltip={false} />
              {s.toUpperCase()}
              <span className="text-xs text-muted-foreground">{s === "tofu" ? "Awareness" : s === "mofu" ? "Consideration" : "Decision"}</span>
            </span>
          ),
          count: counts.funnel.get(s) ?? 0,
        }))}
        selected={filters.funnel}
        onToggle={(v) => onToggle("funnel", v)}
      />
      <Group
        title="Brand & Competitors"
        options={[
          { value: "branded", label: "Branded", count: counts.brand.get("branded") ?? 0 },
          { value: "nonbranded", label: "Non-branded", count: counts.brand.get("nonbranded") ?? 0 },
          { value: "competitor", label: "Mentions a competitor", count: counts.brand.get("competitor") ?? 0 },
          { value: "tracked", label: "In tracker", count: counts.brand.get("tracked") ?? 0 },
          { value: "untracked", label: "Not tracked yet", count: counts.brand.get("untracked") ?? 0 },
        ]}
        selected={filters.brand}
        onToggle={(v) => onToggle("brand", v)}
      />
      <Group
        title="Personas"
        options={personas
          .map((p) => ({ value: p, label: p === NO_PERSONA ? "No persona" : p, count: counts.personas.get(p) ?? 0 }))
          .sort((a, b) => b.count - a.count)}
        selected={filters.personas}
        onToggle={(v) => onToggle("personas", v)}
        defaultOpen={personas.length > 1}
      />
    </div>
  );
}
