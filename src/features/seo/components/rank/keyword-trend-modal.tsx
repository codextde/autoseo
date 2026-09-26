"use client";

import { useMemo, useState } from "react";
import { Copy, Download, Loader2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceArea, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { buildTsv } from "@/server/seo/lib/csv";
import { fileSafe } from "@/server/seo/lib/csv";
import { getKeywordHistoryAction } from "../../actions/rank";
import { copyText, downloadCsv, unwrap } from "../../lib/client";
import { useSeoQuery } from "../../hooks/use-seo-query";
import { configLocationLabel, type ConfigLike } from "./rank-utils";
import { cn } from "@/lib/utils";

const RANGES = [
  { key: "30", label: "30d", days: 30 },
  { key: "90", label: "90d", days: 90 },
  { key: "all", label: "All", days: 730 },
] as const;

const COLORS = { desktop: "#2563eb", mobile: "#14b8a6" } as const;

type HistoryPoint = { device: "desktop" | "mobile"; checkedAt: Date | string; position: number | null };

/** Position-over-time for one keyword: inverted-Y line chart (1 on top) + per-check table. */
export function KeywordTrendModal({
  projectId,
  config,
  keyword,
  open,
  onOpenChange,
}: {
  projectId: string;
  config: ConfigLike;
  keyword: { id: string; keyword: string } | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("all");
  const days = RANGES.find((r) => r.key === range)!.days;
  const key = open && keyword ? `rank-history:${config.id}:${keyword.id}:${days}` : null;
  const { data, loading, error } = useSeoQuery<HistoryPoint[]>(
    key,
    async () => unwrap(await getKeywordHistoryAction(projectId, config.id, keyword!.id, days)),
    { staleMs: 60_000 },
  );
  const depth = config.serpDepth;
  const devices = config.devices === "both" ? (["desktop", "mobile"] as const) : ([config.devices] as const);
  const showDevice = config.devices === "both";

  const chartData = useMemo(
    () =>
      (data ?? []).map((p) => ({
        t: new Date(p.checkedAt).getTime(),
        [p.device]: p.position ?? depth,
        [`${p.device}Missing`]: p.position == null,
      })),
    [data, depth],
  );

  /** Rows with Δ vs the previous check of the same device (positive = improved). */
  const tableRows = useMemo(() => {
    const prev: Record<string, number | null | undefined> = {};
    return (data ?? []).map((p) => {
      const before = prev[p.device];
      prev[p.device] = p.position;
      let delta: string = "";
      if (before !== undefined) {
        if (before == null && p.position == null) delta = "";
        else if (before == null) delta = "new";
        else if (p.position == null) delta = "lost";
        else if (before - p.position !== 0) delta = `${before - p.position > 0 ? "+" : ""}${before - p.position}`;
        else delta = "0";
      }
      return { ...p, delta };
    });
  }, [data]);

  const headers = ["Date", ...(showDevice ? ["Device"] : []), "Position", "Δ vs previous check"];
  const cells = tableRows.map((r) => [
    new Date(r.checkedAt).toISOString(),
    ...(showDevice ? [r.device] : []),
    r.position ?? `Not in top ${depth}`,
    r.delta,
  ]);

  const chartConfig: ChartConfig = { desktop: { label: "Desktop", color: COLORS.desktop }, mobile: { label: "Mobile", color: COLORS.mobile } };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-8">{keyword?.keyword}</DialogTitle>
          <DialogDescription>
            {config.domain} · {configLocationLabel(config)} · Position over time
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex rounded-lg bg-muted p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={cn("rounded-md px-2.5 py-1 text-xs font-medium", range === r.key ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" disabled={!cells.length} onClick={() => copyText(buildTsv(headers, cells), "Copied history")}>
              <Copy /> Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!cells.length}
              onClick={() => downloadCsv(`rank-history-${fileSafe(config.domain)}-${fileSafe(keyword?.keyword ?? "keyword")}`, headers, cells)}
            >
              <Download /> Export CSV
            </Button>
          </div>
        </div>

        {loading && !data ? (
          <div className="flex h-56 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="py-10 text-center text-sm text-destructive">{error}</p>
        ) : !chartData.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No checks in this range yet.</p>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="aspect-auto h-60 w-full">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="4 4" />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={28}
                  tickFormatter={(v: number) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                />
                <YAxis reversed domain={[1, depth]} allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                <ReferenceArea
                  y1={Math.max(1, depth - Math.max(1, Math.round(depth * 0.06)))}
                  y2={depth}
                  fill="var(--muted-foreground)"
                  fillOpacity={0.08}
                  strokeOpacity={0}
                  label={{ value: `Not in top ${depth}`, position: "insideBottomRight", fontSize: 10, fill: "var(--muted-foreground)" }}
                />
                <ChartTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0]!.payload as Record<string, number | boolean>;
                    return (
                      <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                        <div className="mb-1 font-medium">{new Date(p.t as number).toLocaleDateString("en-US", { dateStyle: "medium" })}</div>
                        {devices.map((d) =>
                          p[d] != null ? (
                            <div key={d} className="flex items-center gap-1.5">
                              <span className="size-2 rounded-full" style={{ background: COLORS[d] }} />
                              <span className="capitalize">{d}</span>
                              <span className="ml-auto font-medium tabular">{p[`${d}Missing`] ? `Not in top ${depth}` : `#${p[d]}`}</span>
                            </div>
                          ) : null,
                        )}
                      </div>
                    );
                  }}
                />
                {devices.map((d) => (
                  <Line key={d} dataKey={d} type="monotone" stroke={COLORS[d]} strokeWidth={2} connectNulls dot={{ r: 2.5 }} activeDot={{ r: 4 }} isAnimationActive={false} />
                ))}
              </LineChart>
            </ChartContainer>
            <div className="max-h-64 overflow-auto rounded-xl border">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-normal">Date</th>
                    {showDevice && <th className="px-3 py-2 font-normal">Device</th>}
                    <th className="px-3 py-2 text-right font-normal">Position</th>
                    <th className="px-3 py-2 text-right font-normal">Δ vs previous check</th>
                  </tr>
                </thead>
                <tbody>
                  {[...tableRows].reverse().map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5 tabular">{new Date(r.checkedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}</td>
                      {showDevice && <td className="px-3 py-1.5 capitalize">{r.device}</td>}
                      <td className="px-3 py-1.5 text-right tabular">{r.position ?? <span className="text-muted-foreground">Not in top {depth}</span>}</td>
                      <td
                        className={cn(
                          "px-3 py-1.5 text-right tabular",
                          r.delta.startsWith("+") || r.delta === "new" ? "text-success" : r.delta.startsWith("-") || r.delta === "lost" ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {r.delta || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
