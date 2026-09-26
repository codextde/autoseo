"use client";

import { useMemo } from "react";
import { Activity } from "lucide-react";
import { Panel } from "@/components/app/page";
import { BarsChart } from "@/components/app/charts";
import { formatNumber } from "@/components/app/metrics";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import type { ApiUsage } from "../types";

const RANGES = [7, 14, 30] as const;

export function UsagePanel({ usage, rateLimit }: { usage: ApiUsage; rateLimit: number }) {
  const [rangeParam, setRange] = useUrlState("usage", "30");
  const range = RANGES.find((r) => String(r) === rangeParam) ?? 30;
  const days = useMemo(() => usage.days.slice(-range), [usage.days, range]);
  const total = days.reduce((s, d) => s + d.requests, 0);
  const errors = days.reduce((s, d) => s + d.errors, 0);
  const avg = Math.round(total / range);
  const data = days.map((d) => ({ date: d.date, ok: d.requests - d.errors, errors: d.errors }));

  return (
    <Panel
      title="API Usage"
      icon={<Activity className="size-4 text-brand" />}
      actions={
        <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(String(r))}
              className={cn(
                "rounded-md px-2 py-1 text-xs transition-colors tabular",
                r === range ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r}d
            </button>
          ))}
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight tabular">{formatNumber(total)}</span>
            <span className="text-xs text-muted-foreground">requests · last {range} days</span>
          </div>
          <p className="text-xs text-muted-foreground tabular">
            {formatNumber(usage.today)} today · {formatNumber(avg)} avg/day
            {errors > 0 && <span className="text-destructive"> · {formatNumber(errors)} errors</span>}
          </p>
          {usage.sessionRequests30 > 0 && (
            <p className="text-[11px] text-muted-foreground tabular">
              + {formatNumber(usage.sessionRequests30)} requests from agent chat sessions (last 30 days, not counted above)
            </p>
          )}
        </div>
        <BarsChart
          data={data}
          stacked
          height={170}
          series={[
            { key: "ok", label: "Successful", color: "var(--brand)" },
            { key: "errors", label: "Errors", color: "var(--destructive)" },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">
          REST and MCP requests of all keys and connected apps. Rate limit: {formatNumber(rateLimit)} requests/minute per credential.
        </p>
      </div>
    </Panel>
  );
}
