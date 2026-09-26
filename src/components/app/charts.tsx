"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { formatCompact, formatCurrency } from "./metrics";

export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];

export type Series = { key: string; label: string; color?: string; yAxis?: "left" | "right"; dashed?: boolean };
export type ValueFormat = "percent" | "number" | "compact" | "currency" | "decimal";

export function fmt(v: unknown, format: ValueFormat = "number", currency = "EUR"): string {
  if (v == null || v === "" || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  switch (format) {
    case "percent":
      return `${n.toFixed(n >= 10 || n === 0 ? 0 : 1)}%`;
    case "compact":
      return formatCompact(n);
    case "currency":
      return formatCurrency(n, currency);
    case "decimal":
      return n.toFixed(1);
    default:
      return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
}

function toConfig(series: Series[]): ChartConfig {
  return Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: s.color ?? CHART_COLORS[i % CHART_COLORS.length] }]),
  );
}

function shortDate(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ───────────────────────────── Trend (area / line) ───────────────────────────── */

export function TrendChart({
  data,
  series,
  xKey = "date",
  type = "area",
  format = "number",
  rightFormat,
  height = 280,
  stacked,
  legend,
  domain,
  markers,
  className,
  xFormatter = shortDate,
  connectNulls = true,
}: {
  data: Record<string, unknown>[];
  series: Series[];
  xKey?: string;
  type?: "area" | "line";
  format?: ValueFormat;
  rightFormat?: ValueFormat;
  height?: number;
  stacked?: boolean;
  legend?: boolean;
  domain?: [number | "auto", number | "auto"];
  markers?: { x: string; label: string; color?: string }[];
  className?: string;
  xFormatter?: (v: string) => string;
  connectNulls?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const config = toConfig(series);
  const hasRight = series.some((s) => s.yAxis === "right");
  const Chart = type === "area" ? AreaChart : LineChart;
  return (
    <ChartContainer config={config} className={cn("aspect-auto w-full", className)} style={{ height }}>
      <Chart data={data} margin={{ top: 8, right: hasRight ? 8 : 12, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`var(--color-${s.key})`} stopOpacity={0.28} />
              <stop offset="100%" stopColor={`var(--color-${s.key})`} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="4 4" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={xFormatter} />
        <YAxis
          yAxisId="left"
          tickLine={false}
          axisLine={false}
          width={format === "currency" ? 56 : 42}
          tickFormatter={(v) => fmt(v, format === "number" ? "compact" : format)}
          domain={domain ?? (format === "percent" ? [0, 100] : ["auto", "auto"])}
        />
        {hasRight && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v) => fmt(v, rightFormat ?? "compact")}
          />
        )}
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={
            <ChartTooltipContent
              labelFormatter={(v) => (typeof v === "string" ? new Date(v).toLocaleDateString("en-US", { dateStyle: "medium" }) : String(v))}
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 rounded-full" style={{ background: `var(--color-${String(name)})` }} />
                    {config[String(name)]?.label ?? String(name)}
                  </span>
                  <span className="font-medium tabular">
                    {fmt(value, series.find((s) => s.key === name)?.yAxis === "right" ? (rightFormat ?? "number") : format)}
                  </span>
                </div>
              )}
            />
          }
        />
        {markers?.map((m) => (
          <ReferenceLine
            key={m.x}
            x={m.x}
            yAxisId="left"
            stroke={m.color ?? "var(--brand)"}
            strokeDasharray="3 3"
            label={{ value: m.label, position: "top", fontSize: 10, fill: "var(--muted-foreground)" }}
          />
        ))}
        {series.map((s) =>
          type === "area" ? (
            <Area
              key={s.key}
              yAxisId={s.yAxis ?? "left"}
              dataKey={s.key}
              type="monotone"
              stroke={`var(--color-${s.key})`}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "4 4" : undefined}
              fill={`url(#g-${uid}-${s.key})`}
              stackId={stacked ? "1" : undefined}
              connectNulls={connectNulls}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ) : (
            <Line
              key={s.key}
              yAxisId={s.yAxis ?? "left"}
              dataKey={s.key}
              type="monotone"
              stroke={`var(--color-${s.key})`}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "4 4" : undefined}
              connectNulls={connectNulls}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ),
        )}
        {legend && <ChartLegend content={<ChartLegendContent />} />}
      </Chart>
    </ChartContainer>
  );
}

/* ───────────────────────────── Bars ───────────────────────────── */

export function BarsChart({
  data,
  series,
  xKey = "date",
  stacked,
  format = "number",
  height = 260,
  horizontal,
  legend,
  className,
  radius = 4,
  xFormatter = shortDate,
  barSize,
}: {
  data: Record<string, unknown>[];
  series: Series[];
  xKey?: string;
  stacked?: boolean;
  format?: ValueFormat;
  height?: number;
  horizontal?: boolean;
  legend?: boolean;
  className?: string;
  radius?: number;
  xFormatter?: (v: string) => string;
  barSize?: number;
}) {
  const config = toConfig(series);
  return (
    <ChartContainer config={config} className={cn("aspect-auto w-full", className)} style={{ height }}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={horizontal} horizontal={!horizontal} strokeDasharray="4 4" />
        {horizontal ? (
          <>
            <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v) => fmt(v, format === "number" ? "compact" : format)} />
            <YAxis type="category" dataKey={xKey} tickLine={false} axisLine={false} width={120} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tickFormatter={xFormatter} />
            <YAxis tickLine={false} axisLine={false} width={42} tickFormatter={(v) => fmt(v, format === "number" ? "compact" : format)} />
          </>
        )}
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<ChartTooltipContent />} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            fill={`var(--color-${s.key})`}
            stackId={stacked ? "a" : undefined}
            barSize={barSize}
            radius={
              stacked
                ? i === series.length - 1
                  ? horizontal
                    ? [0, radius, radius, 0]
                    : [radius, radius, 0, 0]
                  : 0
                : horizontal
                  ? [0, radius, radius, 0]
                  : [radius, radius, 0, 0]
            }
          />
        ))}
        {legend && <ChartLegend content={<ChartLegendContent />} />}
      </BarChart>
    </ChartContainer>
  );
}

/* ───────────────────────────── Donut ───────────────────────────── */

export function DonutChart({
  data,
  height = 220,
  center,
  className,
  format = "number",
}: {
  data: { name: string; value: number; color?: string }[];
  height?: number;
  center?: React.ReactNode;
  className?: string;
  format?: ValueFormat;
}) {
  const config: ChartConfig = Object.fromEntries(
    data.map((d, i) => [d.name, { label: d.name, color: d.color ?? CHART_COLORS[i % CHART_COLORS.length] }]),
  );
  return (
    <div className={cn("relative", className)} style={{ height }}>
      <ChartContainer config={config} className="aspect-auto h-full w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(v, n) => `${n}: ${fmt(v, format)}`} />} />
          <Pie
            data={data.map((d, i) => ({ ...d, fill: d.color ?? CHART_COLORS[i % CHART_COLORS.length] }))}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="92%"
            strokeWidth={2}
            stroke="var(--card)"
            paddingAngle={1}
          />
        </PieChart>
      </ChartContainer>
      {center && <div className="pointer-events-none absolute inset-0 flex items-center justify-center">{center}</div>}
    </div>
  );
}

export function LegendList({
  items,
  format = "percent",
  className,
}: {
  items: { name: string; value: number; color?: string }[];
  format?: ValueFormat;
  className?: string;
}) {
  return (
    <ul className={cn("space-y-1.5 text-sm", className)}>
      {items.map((d, i) => (
        <li key={d.name} className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color ?? CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="truncate">{d.name}</span>
          </span>
          <span className="text-muted-foreground tabular">{fmt(d.value, format)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────────── Radar ───────────────────────────── */

export function RadarView({
  data,
  series,
  axisKey = "axis",
  height = 300,
  className,
}: {
  data: Record<string, unknown>[];
  series: Series[];
  axisKey?: string;
  height?: number;
  className?: string;
}) {
  const config = toConfig(series);
  return (
    <ChartContainer config={config} className={cn("aspect-auto w-full", className)} style={{ height }}>
      <RadarChart data={data} outerRadius="72%">
        <ChartTooltip content={<ChartTooltipContent />} />
        <PolarGrid />
        <PolarAngleAxis dataKey={axisKey} tick={{ fontSize: 11 }} />
        <PolarRadiusAxis tick={false} axisLine={false} />
        {series.map((s) => (
          <Radar key={s.key} dataKey={s.key} stroke={`var(--color-${s.key})`} fill={`var(--color-${s.key})`} fillOpacity={0.22} strokeWidth={2} />
        ))}
      </RadarChart>
    </ChartContainer>
  );
}

/* ───────────────────────────── Sparkline ───────────────────────────── */

export function Sparkline({
  values,
  color = "var(--chart-1)",
  height = 36,
  className,
}: {
  values: number[];
  color?: string;
  height?: number;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  if (values.length < 2) return <div className={cn("h-9", className)} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const w = 120;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
    return [x, y] as const;
  });
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cn("w-full", className)} style={{ height }}>
      <defs>
        <linearGradient id={`sp-${uid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${d} L${w},${height} L0,${height} Z`} fill={`url(#sp-${uid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ───────────────────────────── Ranked bars (HTML) ───────────────────────────── */

export function RankedBars({
  items,
  format = "number",
  max,
  className,
  onSelect,
}: {
  items: { key: string; label: React.ReactNode; value: number; icon?: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }[];
  format?: ValueFormat;
  max?: number;
  className?: string;
  onSelect?: (key: string) => void;
}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ol className={cn("space-y-1.5", className)}>
      {items.map((item, idx) => (
        <li key={item.key}>
          <button
            type="button"
            disabled={!onSelect}
            onClick={() => onSelect?.(item.key)}
            className="relative flex w-full items-center gap-3 overflow-hidden rounded-lg px-2.5 py-2 text-left text-sm enabled:hover:ring-1 enabled:hover:ring-border"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-lg bg-muted"
              style={{ width: `${Math.max(2, (item.value / top) * 100)}%` }}
            />
            <span className="relative w-5 shrink-0 text-xs text-muted-foreground tabular">{idx + 1}</span>
            {item.icon && <span className="relative shrink-0">{item.icon}</span>}
            <span className="relative min-w-0 flex-1 truncate font-medium">
              {item.label}
              {item.sub && <span className="ml-2 text-xs font-normal text-muted-foreground">{item.sub}</span>}
            </span>
            <span className="relative shrink-0 text-xs text-muted-foreground tabular">{item.right ?? fmt(item.value, format)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/* ───────────────────────────── Heatmap ───────────────────────────── */

export function Heatmap({
  rows,
  cols,
  values,
  format = "number",
  rowHeader = "",
  onCellClick,
  className,
  color = "oklch(0.7 0.17 50)",
}: {
  rows: { key: string; label: React.ReactNode }[];
  cols: { key: string; label: React.ReactNode }[];
  values: Record<string, Record<string, number | null>>;
  format?: ValueFormat;
  rowHeader?: React.ReactNode;
  onCellClick?: (row: string, col: string) => void;
  className?: string;
  color?: string;
}) {
  const all = rows.flatMap((r) => cols.map((c) => values[r.key]?.[c.key] ?? 0));
  const max = Math.max(1, ...all.map((v) => v ?? 0));
  return (
    <div className={cn("overflow-x-auto rounded-xl border", className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/60 text-xs text-muted-foreground">
            <th className="px-3 py-2.5 text-left font-normal">{rowHeader}</th>
            {cols.map((c) => (
              <th key={c.key} className="min-w-24 px-3 py-2.5 text-center font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="px-3 py-2 font-medium whitespace-nowrap">{r.label}</td>
              {cols.map((c) => {
                const v = values[r.key]?.[c.key];
                const t = v ? v / max : 0;
                return (
                  <td key={c.key} className="p-0.5">
                    <button
                      type="button"
                      disabled={!onCellClick || !v}
                      onClick={() => onCellClick?.(r.key, c.key)}
                      className="flex h-9 w-full items-center justify-center rounded-md text-xs font-medium tabular"
                      style={{
                        background: v ? `color-mix(in oklch, ${color} ${Math.round(12 + t * 78)}%, transparent)` : "transparent",
                        color: t > 0.55 ? "white" : undefined,
                      }}
                    >
                      {v ? fmt(v, format) : <span className="text-muted-foreground">—</span>}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────────── Gauge & score ring ───────────────────────────── */

export function TickGauge({ value, size = 180, className }: { value: number; size?: number; className?: string }) {
  const ticks = 36;
  const active = Math.round((Math.max(0, Math.min(100, value)) / 100) * ticks);
  const r = size / 2 - 8;
  return (
    <svg viewBox={`0 0 ${size} ${size / 2 + 12}`} className={className} style={{ width: size }}>
      {Array.from({ length: ticks }).map((_, i) => {
        const angle = Math.PI - (i / (ticks - 1)) * Math.PI;
        const x1 = size / 2 + Math.cos(angle) * (r - 14);
        const y1 = size / 2 - Math.sin(angle) * (r - 14);
        const x2 = size / 2 + Math.cos(angle) * r;
        const y2 = size / 2 - Math.sin(angle) * r;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            strokeWidth={3}
            strokeLinecap="round"
            stroke={i < active ? "var(--brand)" : "var(--border)"}
          />
        );
      })}
    </svg>
  );
}

export function ScoreRing({
  value,
  size = 120,
  stroke = 10,
  label,
  className,
  color = "var(--brand)",
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: React.ReactNode;
  className?: string;
  color?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--muted)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tracking-tight tabular">{Math.round(pct)}</span>
        {label && <span className="text-[10px] text-muted-foreground uppercase">{label}</span>}
      </div>
    </div>
  );
}

/* ───────────────────────────── Stacked 100% bar ───────────────────────────── */

export function StackedBar({
  parts,
  className,
  height = 8,
}: {
  parts: { key: string; value: number; color: string; label?: string }[];
  className?: string;
  height?: number;
}) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className={cn("flex w-full overflow-hidden rounded-full bg-muted", className)} style={{ height }}>
      {parts.map((p) =>
        p.value > 0 ? (
          <div key={p.key} title={p.label ? `${p.label}: ${Math.round((p.value / total) * 100)}%` : undefined} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ) : null,
      )}
    </div>
  );
}
