"use client";

import { useMemo, useState } from "react";
import { sankey, sankeyLinkHorizontal, type SankeyGraph } from "d3-sankey";
import { cn } from "@/lib/utils";
import { CHART_COLORS, fmt, type ValueFormat } from "./charts";

export type SankeyNodeIn = { id: string; label: string; color?: string };
export type SankeyLinkIn = { source: string; target: string; value: number };

/** Responsive SVG sankey (AI model → page → outcome, prompt flow between periods). */
export function SankeyChart({
  nodes,
  links,
  height = 380,
  format = "number",
  className,
}: {
  nodes: SankeyNodeIn[];
  links: SankeyLinkIn[];
  height?: number;
  format?: ValueFormat;
  className?: string;
}) {
  const width = 900;
  const [hover, setHover] = useState<number | null>(null);
  const graph = useMemo(() => {
    if (!nodes.length || !links.length) return null;
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    const g = sankey<{ id: string; label: string; color?: string }, { value: number }>()
      .nodeWidth(12)
      .nodePadding(14)
      .extent([
        [8, 8],
        [width - 8, height - 8],
      ])({
      nodes: nodes.map((n) => ({ ...n })),
      links: links
        .filter((l) => index.has(l.source) && index.has(l.target) && l.value > 0)
        .map((l) => ({ source: index.get(l.source)!, target: index.get(l.target)!, value: l.value })),
    } as unknown as SankeyGraph<{ id: string; label: string; color?: string }, { value: number }>);
    return g;
  }, [nodes, links, height]);

  if (!graph) return null;
  const path = sankeyLinkHorizontal();

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-auto w-full", className)}>
      <g fill="none">
        {graph.links.map((l, i) => {
          const src = l.source as unknown as { index: number; color?: string };
          return (
            <path
              key={i}
              d={path(l as never) ?? ""}
              stroke={src.color ?? CHART_COLORS[src.index % CHART_COLORS.length]}
              strokeOpacity={hover === null || hover === i ? 0.35 : 0.08}
              strokeWidth={Math.max(1, l.width ?? 1)}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${(l.source as unknown as SankeyNodeIn).label} → ${(l.target as unknown as SankeyNodeIn).label}: ${fmt(l.value, format)}`}</title>
            </path>
          );
        })}
      </g>
      {graph.nodes.map((n, i) => {
        const x0 = n.x0 ?? 0;
        const x1 = n.x1 ?? 0;
        const y0 = n.y0 ?? 0;
        const y1 = n.y1 ?? 0;
        const left = x0 < width / 2;
        return (
          <g key={i}>
            <rect x={x0} y={y0} width={x1 - x0} height={Math.max(1, y1 - y0)} rx={3} fill={n.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
            <text
              x={left ? x1 + 6 : x0 - 6}
              y={(y0 + y1) / 2}
              dy="0.35em"
              textAnchor={left ? "start" : "end"}
              className="fill-foreground text-[11px]"
            >
              {n.label} <tspan className="fill-muted-foreground">{fmt(n.value, format)}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}
