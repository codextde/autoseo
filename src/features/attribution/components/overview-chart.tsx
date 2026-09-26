"use client";

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { money } from "./shared";

export type SeriesPoint = { date: string; ai: number; other: number; aiRevenue: number; otherRevenue: number };

/** Stacked bars (AI Search vs Other responses per day) + AI revenue line on a secondary axis. */
export function AttributionChart({ data, currency, height = 280 }: { data: SeriesPoint[]; currency: string; height?: number }) {
  const config: ChartConfig = {
    ai: { label: "AI Search", color: "var(--brand)" },
    other: { label: "Other", color: "color-mix(in oklch, var(--muted-foreground) 45%, transparent)" },
    aiRevenue: { label: "AI Revenue", color: "var(--chart-1)" },
  };
  const compactMoney = (v: number) => {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(v);
    } catch {
      return String(v);
    }
  };
  const barSize = data.length > 60 ? undefined : data.length > 20 ? 10 : 18;
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="4 4" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(v: string) => new Date(`${v}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
        />
        <YAxis yAxisId="left" tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => compactMoney(v)} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={
            <ChartTooltipContent
              labelFormatter={(v) => (typeof v === "string" ? new Date(`${v}T00:00:00Z`).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" }) : String(v))}
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 rounded-full" style={{ background: `var(--color-${String(name)})` }} />
                    {config[String(name)]?.label ?? String(name)}
                  </span>
                  <span className="font-medium tabular">{name === "aiRevenue" ? money(Number(value), currency) : Number(value).toLocaleString("en-US")}</span>
                </div>
              )}
            />
          }
        />
        <Bar yAxisId="left" dataKey="other" stackId="r" fill="var(--color-other)" barSize={barSize} radius={[0, 0, 0, 0]} />
        <Bar yAxisId="left" dataKey="ai" stackId="r" fill="var(--color-ai)" barSize={barSize} radius={[4, 4, 0, 0]} />
        <Line yAxisId="right" dataKey="aiRevenue" type="monotone" stroke="var(--color-aiRevenue)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        <ChartLegend content={<ChartLegendContent />} />
      </ComposedChart>
    </ChartContainer>
  );
}
