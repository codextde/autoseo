"use client";

import { useUrlPatch } from "@/hooks/use-url-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodFilter, SyncButton } from "@/features/analytics/components/shared";
import { IntegrationLogo } from "@/features/integrations/components/integration-logo";
import { cn } from "@/lib/utils";
import type { TrafficSource } from "@/server/analytics/traffic/queries";

export function GranularityToggle({ value }: { value: "daily" | "monthly" }) {
  const [patch] = useUrlPatch();
  return (
    <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Granularity">
      {(["daily", "monthly"] as const).map((g) => (
        <button
          key={g}
          type="button"
          role="tab"
          aria-selected={value === g}
          onClick={() => patch({ granularity: g === "daily" ? null : g })}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
            value === g ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

export function SourceSelect({ sources, value }: { sources: TrafficSource[]; value: string }) {
  const [patch] = useUrlPatch();
  const first = sources[0]?.provider;
  return (
    <Select value={value} onValueChange={(v) => patch({ source: v === first ? null : v, models: null })}>
      <SelectTrigger size="sm" className="h-8 max-w-64 min-w-0 bg-background text-xs">
        <SelectValue placeholder="Select source" />
      </SelectTrigger>
      <SelectContent align="end">
        {sources.map((s) => (
          <SelectItem key={s.provider} value={s.provider} disabled={s.status === "pending"} className="text-xs">
            <span className="flex min-w-0 items-center gap-2">
              <IntegrationLogo provider={s.provider} size="sm" className="size-5 rounded-md [&_img]:size-3" />
              <span className="truncate">
                {s.propertyLabel || s.label}
                <span className="ml-1 text-muted-foreground">· {s.label}</span>
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TrafficToolbar({
  projectId,
  sources,
  source,
  preset,
  from,
  to,
  granularity,
  lastSyncAt,
}: {
  projectId: string;
  sources: TrafficSource[];
  source: string;
  preset: string;
  from: string;
  to: string;
  granularity: "daily" | "monthly";
  lastSyncAt: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PeriodFilter preset={preset} from={from} to={to} />
      <GranularityToggle value={granularity} />
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {sources.length > 0 && <SourceSelect sources={sources} value={source} />}
        <SyncButton projectId={projectId} provider={source} lastSyncAt={lastSyncAt} />
      </div>
    </div>
  );
}
