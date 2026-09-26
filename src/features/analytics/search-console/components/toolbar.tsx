"use client";

import { useUrlPatch } from "@/hooks/use-url-state";
import { PeriodFilter, SyncButton } from "@/features/analytics/components/shared";
import { cn } from "@/lib/utils";

export function SourceSwitch({
  source,
  googleConnected,
  bingConnected,
}: {
  source: "google" | "bing";
  googleConnected: boolean;
  bingConnected: boolean;
}) {
  const [patch] = useUrlPatch();
  const items = [
    { key: "google" as const, label: "Google Console", connected: googleConnected },
    { key: "bing" as const, label: "Bing Webmaster", connected: bingConnected },
  ];
  return (
    <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Search data source">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={source === it.key}
          onClick={() => patch({ source: it.key === "google" ? null : it.key, country: null, page: null })}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            source === it.key ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className={cn("size-1.5 rounded-full", it.connected ? "bg-success" : "bg-muted-foreground/40")} />
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function ScToolbar({
  projectId,
  source,
  googleConnected,
  bingConnected,
  preset,
  from,
  to,
  periodLabel,
  lastSyncAt,
  showPeriod,
  className,
}: {
  projectId: string;
  source: "google" | "bing";
  googleConnected: boolean;
  bingConnected: boolean;
  preset: string;
  from: string;
  to: string;
  periodLabel: string;
  lastSyncAt: string | null;
  showPeriod: boolean;
  className?: string;
}) {
  const connected = source === "google" ? googleConnected : bingConnected;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <SourceSwitch source={source} googleConnected={googleConnected} bingConnected={bingConnected} />
      {showPeriod && (
        <>
          <PeriodFilter preset={preset} from={from} to={to} />
          <span className="hidden text-xs text-muted-foreground tabular lg:inline">{periodLabel}</span>
        </>
      )}
      {connected && (
        <SyncButton
          projectId={projectId}
          provider={source === "google" ? "google_search_console" : "bing_webmaster"}
          lastSyncAt={lastSyncAt}
          className="ml-auto"
        />
      )}
    </div>
  );
}
