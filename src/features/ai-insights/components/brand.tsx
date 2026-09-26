"use client";

import { Favicon } from "@/components/app/favicon";
import { EngineIcon } from "@/components/app/engine-icon";
import { Delta } from "@/components/app/metrics";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getEngine } from "@/lib/engines";
import { cn } from "@/lib/utils";
import { formatMetric, METRICS, type MetricKey } from "../lib/metrics";
import type { EngineShare } from "../types";

export function YouBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-4 items-center rounded-full bg-brand px-1.5 text-[10px] font-semibold text-brand-foreground", className)}>
      You
    </span>
  );
}

export function BrandLabel({
  name,
  domain,
  isOwn,
  color,
  showDomain,
  className,
  size = "sm",
}: {
  name: string;
  domain?: string | null;
  isOwn?: boolean;
  color?: string;
  showDomain?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="relative shrink-0">
        <Favicon domain={domain} fallback={name} className={size === "md" ? "size-6 rounded-md" : "size-5 rounded-md"} />
        {color && <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-card" style={{ background: color }} />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className={cn("truncate font-medium", size === "md" && "text-base")}>{name}</span>
          {isOwn && <YouBadge />}
        </span>
        {showDomain && domain && <span className="block truncate text-xs text-muted-foreground">{domain}</span>}
      </span>
    </span>
  );
}

/** Value + delta cell for a metric. */
export function MetricCell({ metric, value, delta, className }: { metric: MetricKey; value: number | null; delta?: number | null; className?: string }) {
  const def = METRICS[metric];
  return (
    <span className={cn("inline-flex flex-col items-end leading-tight", className)}>
      <span className="font-medium tabular">{formatMetric(metric, value)}</span>
      {delta !== undefined && <Delta value={delta} invert={def.invert} digits={def.format === "number" || def.format === "score" ? 0 : 1} showZero={false} />}
    </span>
  );
}

/** finseo "Model Visibility": stacked per-engine bar + engine icons. */
export function ModelVisibility({ engines, className }: { engines: EngineShare[]; className?: string }) {
  const visible = engines.filter((e) => e.visible > 0);
  const total = visible.reduce((a, e) => a + e.visible, 0);
  if (!total) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("flex min-w-32 flex-col gap-1.5", className)}>
          <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
            {visible.map((e) => (
              <span key={e.engine} style={{ width: `${(e.visible / total) * 100}%`, background: getEngine(e.engine)?.color ?? "#888" }} />
            ))}
          </span>
          <span className="flex items-center gap-0.5">
            {visible.slice(0, 6).map((e) => (
              <EngineIcon key={e.engine} id={e.engine} size="xs" withTooltip={false} />
            ))}
            {visible.length > 6 && <span className="text-[10px] text-muted-foreground">+{visible.length - 6}</span>}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="min-w-44">
        <div className="space-y-1">
          {engines.map((e) => (
            <div key={e.engine} className="flex items-center justify-between gap-4 text-xs">
              <span>{getEngine(e.engine)?.name ?? e.engine}</span>
              <span className="tabular">{e.answers ? `${e.visibility.toFixed(1)}%` : "—"}</span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function SentimentPill({ score, className }: { score: number | null | undefined; className?: string }) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const tone =
    score >= 80
      ? "bg-success/15 text-success"
      : score >= 60
        ? "bg-brand-soft text-brand"
        : score >= 40
          ? "bg-muted text-muted-foreground"
          : "bg-destructive/10 text-destructive";
  return <span className={cn("inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular", tone, className)}>{Math.round(score)}</span>;
}
