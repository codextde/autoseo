"use client";

import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { MultiSelect, PeriodSelect, TagFilter, FilterBar } from "@/components/app/filters";
import { EngineIcon } from "@/components/app/engine-icon";
import { useUrlPatch } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import type { FilterOptionsDTO } from "../types";

export const INSIGHT_PERIODS = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
];

/**
 * Period / model / tag filters shared by all AI insight pages. Changes go to the URL and re-run
 * the server queries.
 */
export function InsightFilters({
  options,
  search,
  right,
  children,
  models = true,
  tags = true,
  className,
  defaultPeriod = "30d",
}: {
  options: FilterOptionsDTO;
  search?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  models?: boolean;
  tags?: boolean;
  className?: string;
  defaultPeriod?: string;
}) {
  const params = useSearchParams();
  const [patch, pending] = useUrlPatch();
  const period = params.get("period") ?? defaultPeriod;
  const modelList = (params.get("models") ?? "").split(",").filter(Boolean);
  const tagList = (params.get("tags") ?? "").split(",").filter(Boolean);
  const active = (period !== defaultPeriod ? 1 : 0) + (modelList.length ? 1 : 0) + (tagList.length ? 1 : 0);

  return (
    <FilterBar
      className={className}
      search={search}
      activeCount={active}
      right={
        <>
          {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />}
          {right}
        </>
      }
    >
      <PeriodSelect
        value={period}
        presets={INSIGHT_PERIODS}
        from={params.get("from") ?? undefined}
        to={params.get("to") ?? undefined}
        onChange={(p) => patch({ period: p === defaultPeriod ? null : p, from: null, to: null })}
        onCustom={({ from, to }) => patch({ period: "custom", from, to })}
      />
      {models && (
        <MultiSelect
          options={options.engines.map((e) => ({ ...e, icon: <EngineIcon id={e.value} size="xs" withTooltip={false} /> }))}
          value={modelList}
          onChange={(v) => patch({ models: v.length ? v.join(",") : null })}
          placeholder="All Models"
          label="Models"
          className={cn("min-w-32")}
        />
      )}
      {tags && options.tags.length > 0 && (
        <TagFilter
          options={options.tags.map((t) => ({ value: t.value, label: t.label }))}
          value={tagList}
          onChange={(v) => patch({ tags: v.length ? v.join(",") : null })}
          className="min-w-28"
        />
      )}
      {children}
    </FilterBar>
  );
}
