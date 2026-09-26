"use client";

import { Loader2 } from "lucide-react";
import { Panel } from "@/components/app/page";
import { TrendChart } from "@/components/app/charts";
import { POSITION_BUCKETS } from "@/server/seo/lib/rank-tracking";
import { getConfigTrendAction } from "../../actions/rank";
import { unwrap } from "../../lib/client";
import { useSeoQuery } from "../../hooks/use-seo-query";
import { cn } from "@/lib/utils";

const RANGES = [
  { key: "30", label: "30d", days: 30 },
  { key: "90", label: "90d", days: 90 },
  { key: "all", label: "All", days: 730 },
] as const;

type TrendPoint = { runId: string; checkedAt: Date | string; total: number; top3: number; top4to10: number; top11to20: number; notRanking: number };

/** Stacked area of the keyword position distribution per completed full run (active device). */
export function PositionDistribution({
  projectId,
  configId,
  device,
  version,
  range,
  onRangeChange,
}: {
  projectId: string;
  configId: string;
  device: "desktop" | "mobile";
  /** Bumped after a run completes to refetch. */
  version: number;
  range: string;
  onRangeChange: (r: string) => void;
}) {
  const active = RANGES.find((r) => r.key === range) ?? RANGES[2];
  const { data, loading, error } = useSeoQuery<TrendPoint[]>(
    `rank-trend:${configId}:${device}:${active.days}:${version}`,
    async () => unwrap(await getConfigTrendAction(projectId, configId, device, active.days)),
    { staleMs: 60_000 },
  );
  const points = (data ?? []).map((p) => ({ ...p, date: new Date(p.checkedAt).toISOString() }));
  return (
    <Panel
      title="Position distribution"
      description={`How your tracked keywords are spread across Google's results (${device}).`}
      actions={
        <div className="flex rounded-lg bg-muted p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => onRangeChange(r.key)}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium", active.key === r.key ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      <div>
        {loading && !data ? (
          <div className="flex h-56 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="py-16 text-center text-sm text-destructive">{error}</p>
        ) : points.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No history yet — run a check to start building your position history.</p>
        ) : points.length === 1 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Only 1 check so far — the chart fills in after the next check.</p>
        ) : (
          <TrendChart
            data={points}
            series={POSITION_BUCKETS.map((b) => ({ key: b.key, label: b.label, color: b.color }))}
            stacked
            legend
            height={240}
            format="number"
            domain={[0, "auto"]}
          />
        )}
      </div>
    </Panel>
  );
}
