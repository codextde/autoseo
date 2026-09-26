"use client";

import { EngineIcon } from "@/components/app/engine-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getAiPlatform, platformMonogram } from "@/server/analytics/ai-platforms";
import { cn } from "@/lib/utils";

/** Icon of an AI platform: engine glyph when available, colored monogram otherwise. */
export function PlatformIcon({ id, size = "xs", className, tooltip = true }: { id: string; size?: "xs" | "sm"; className?: string; tooltip?: boolean }) {
  const p = getAiPlatform(id);
  if (p?.engineId) return <EngineIcon id={p.engineId} size={size} className={className} withTooltip={tooltip} />;
  const node = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-semibold text-white shadow-xs",
        size === "xs" ? "size-4 rounded-[4px] text-[7px]" : "size-5 rounded-md text-[8px]",
        className,
      )}
      style={{ background: p?.color ?? "#71717a" }}
      aria-label={p?.name ?? id}
    >
      {platformMonogram(id)}
    </span>
  );
  if (!tooltip) return node;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent>{p?.name ?? id}</TooltipContent>
    </Tooltip>
  );
}

export function PlatformStack({ ids, max = 4 }: { ids: string[]; max?: number }) {
  const shown = ids.slice(0, max);
  return (
    <span className="inline-flex items-center gap-0.5">
      {shown.map((id) => (
        <PlatformIcon key={id} id={id} />
      ))}
      {ids.length > max && <span className="ml-0.5 text-[10px] text-muted-foreground">+{ids.length - max}</span>}
    </span>
  );
}

/** 83 → "1m 23s", 12 → "12s". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return `${m}m ${rest.toString().padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${(m % 60).toString().padStart(2, "0")}m`;
}

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

export function countryName(iso: string): string {
  if (!iso || iso === "__unknown__" || iso === "Unknown") return "Unknown";
  try {
    return regionNames?.of(iso.toUpperCase() === "UK" ? "GB" : iso.toUpperCase()) ?? iso;
  } catch {
    return iso;
  }
}
