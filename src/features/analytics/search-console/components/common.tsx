"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CountryFlag } from "@/components/app/misc";
import { useUrlState } from "@/hooks/use-url-state";
import type { SortState } from "@/components/app/data-table";
import { getCountry } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { INTENT_LABELS, type QueryIntent } from "@/server/analytics/search-console/classify";
import { addQueriesAsPromptsAction } from "../actions";

export const INTENT_TONE: Record<QueryIntent, string> = {
  recommend: "bg-brand/12 text-brand ring-brand/25",
  information: "bg-info/12 text-info ring-info/25",
  comparison: "bg-chart-4/12 text-chart-4 ring-chart-4/25",
  action: "bg-chart-1/15 text-chart-1 ring-chart-1/30",
};

export function IntentBadge({ intent, source }: { intent: QueryIntent; source?: "heuristic" | "llm" | "manual" }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset", INTENT_TONE[intent])}
      title={source === "llm" ? "Classified by AI" : source === "manual" ? "Set manually" : "Heuristic classification"}
    >
      {INTENT_LABELS[intent]}
      {source === "llm" && <Sparkles className="size-2.5" />}
    </span>
  );
}

let displayNames: Intl.DisplayNames | null = null;
export function countryName(code: string): string {
  const c = getCountry(code);
  if (c) return c.name;
  try {
    displayNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return displayNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function CountryFlags({ countries, max = 3 }: { countries: { code: string; impressions: number }[]; max?: number }) {
  if (!countries.length) return <span className="text-xs text-muted-foreground">—</span>;
  const shown = countries.slice(0, max);
  const rest = countries.slice(max);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1">
          {shown.map((c) => (
            <CountryFlag key={c.code} iso={c.code} />
          ))}
          {rest.length > 0 && <span className="text-[11px] text-muted-foreground tabular">+{rest.length}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        <ul className="space-y-0.5 text-xs">
          {countries.slice(0, 12).map((c) => (
            <li key={c.code} className="flex justify-between gap-4">
              <span>{countryName(c.code)}</span>
              <span className="tabular">{Math.round(c.impressions).toLocaleString("en-US")}</span>
            </li>
          ))}
          {countries.length > 12 && <li className="text-muted-foreground">+{countries.length - 12} more</li>}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/** Sort persisted in the URL as `?sort=<column>.<asc|desc>`. */
export function useUrlSort(defaultSort: string, key = "sort"): [SortState, (s: SortState) => void] {
  const [raw, set] = useUrlState(key, defaultSort);
  const sort = useMemo<SortState>(() => {
    const [id, dir] = raw.split(".");
    return id ? { id, dir: dir === "asc" ? "asc" : "desc" } : null;
  }, [raw]);
  const onChange = useCallback((s: SortState) => set(s ? `${s.id}.${s.dir}` : null), [set]);
  return [sort, onChange];
}

export function sortRows<T>(rows: T[], sort: SortState, getters: Record<string, (r: T) => number | string | null | undefined>): T[] {
  if (!sort) return rows;
  const get = getters[sort.id];
  if (!get) return rows;
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

/** Tracks which queries were added in this session (optimistic "Tracked" state). */
export function useAddPrompts(projectId: string) {
  const router = useRouter();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const add = (queries: string[], onDone?: () => void) =>
    start(async () => {
      const unique = [...new Set(queries)].slice(0, 100);
      if (!unique.length) return;
      const res = await addQueriesAsPromptsAction(projectId, unique);
      if (res.ok) {
        setAdded((prev) => new Set([...prev, ...unique.map((q) => q.toLowerCase())]));
        toast.success(
          res.data.inserted
            ? `Added ${res.data.inserted} prompt${res.data.inserted === 1 ? "" : "s"} to the tracker${res.data.skipped ? ` (${res.data.skipped} already tracked)` : ""}.`
            : "Already tracked.",
        );
        onDone?.();
        router.refresh();
      } else toast.error(res.error);
    });
  return { added, add, pending };
}

export function AddPromptButton({
  query,
  tracked,
  onAdd,
  disabled,
}: {
  query: string;
  tracked: boolean;
  onAdd: (q: string) => void;
  disabled?: boolean;
}) {
  if (tracked)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex size-7 items-center justify-center rounded-lg text-success" aria-label="Tracked">
            <Check className="size-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Already tracked as an AI prompt</TooltipContent>
      </Tooltip>
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`Track “${query}” as AI prompt`}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onAdd(query);
          }}
        >
          {disabled ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Add to prompt tracker</TooltipContent>
    </Tooltip>
  );
}
