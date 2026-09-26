"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Crown, Grid3x3, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/app/page";
import { Heatmap, RadarView } from "@/components/app/charts";
import { KpiStrip } from "@/components/app/metrics";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";
import type { Perception } from "@/server/ai/insights/sentiment";
import { useClientParam } from "../../lib/client-url";
import type { BrandDTO } from "../../types";
import { YouBadge } from "../brand";

const PAGE_SIZE = 12;

export function PerceptionView({ data, own, compare, brands }: { data: Perception; own: BrandDTO; compare: BrandDTO | null; brands: BrandDTO[] }) {
  const [shape, setShape] = useClientParam("shape", "prominence");
  const [view, setView] = useClientParam("view", "bars");
  const [page, setPage] = useState(0);
  const byKey = new Map(brands.map((b) => [b.key, b]));
  const name = (k: string | null | undefined) => (k ? (byKey.get(k)?.name ?? k) : "—");

  if (!data.themes.length)
    return (
      <Panel>
        <EmptyState title="Nothing to show yet" description="Perception is built from praise and criticism statements extracted from AI answers. They appear after the next analysed tracking run." />
      </Panel>
    );

  const source = shape === "association" ? data.association : data.prominence;
  const radarRows = data.themes.map((t) => ({
    axis: t,
    own: Number((source[own.key]?.[t] ?? 0).toFixed(1)),
    ...(compare ? { cmp: Number((source[compare.key]?.[t] ?? 0).toFixed(1)) } : {}),
  }));
  const k = data.kpis;
  const pages = Math.max(1, Math.ceil(data.attributes.length / PAGE_SIZE));
  const pageAttrs = data.attributes.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const themesOnPage = [...new Set(pageAttrs.map((a) => a.theme))];
  const maxAvg = Math.max(1, ...data.avgProminence.map((a) => a.value));
  const gridBrands = [own, ...brands.filter((b) => !b.isOwn && data.attributes.some((a) => (a.shares[b.key] ?? 0) > 0))].slice(0, 9);

  return (
    <div className="space-y-4 sm:space-y-5">
      <KpiStrip
        items={[
          {
            key: "assoc",
            label: "Most associated",
            value: k.mostAssociated ? `${k.mostAssociated.share.toFixed(0)}%` : "—",
            sub: k.mostAssociated?.attribute ?? "No statements yet",
            hint: `Attribute AI mentions most when talking about ${own.name}.`,
          },
          {
            key: "best",
            label: "Best vs competitors",
            value: k.best ? `#${k.best.rank} of ${k.best.of}` : "—",
            sub: k.best?.attribute,
            hint: "Your best rank on any attribute (by share of praise).",
          },
          {
            key: "gap",
            label: "Biggest gap",
            value: k.biggestGap ? `#1 → #${k.biggestGap.rank}` : "—",
            sub: k.biggestGap ? `${k.biggestGap.attribute} · led by ${name(k.biggestGap.leader)}` : "You lead everywhere",
            hint: "Attribute where you rank furthest behind the leader.",
          },
          {
            key: "strongest",
            label: "Strongest competitor",
            value: k.strongest ? `Ø ${k.strongest.value.toFixed(1)}` : "—",
            sub: k.strongest ? name(k.strongest.key) : undefined,
            hint: "Competitor with the highest average prominence across themes.",
          },
        ]}
      />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title="Brand shape"
          description={shape === "association" ? "Share of each brand's statements per theme" : "Share of each theme's statements that are about the brand"}
          actions={
            <div className="flex rounded-lg bg-muted p-0.5 text-xs">
              {["prominence", "association"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setShape(s)}
                  className={cn("rounded-md px-2.5 py-1 font-medium capitalize", shape === s ? "bg-background shadow-xs" : "text-muted-foreground")}
                >
                  {s}
                </button>
              ))}
            </div>
          }
        >
          <RadarView
            data={radarRows}
            series={[{ key: "own", label: own.name, color: own.color }, ...(compare ? [{ key: "cmp", label: compare.name, color: compare.color }] : [])]}
            height={320}
          />
          <div className="mt-2 flex justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: own.color }} /> {own.name}
            </span>
            {compare && (
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: compare.color }} /> {compare.name}
              </span>
            )}
          </div>
        </Panel>
        <Panel title="Ø prominence across themes" contentClassName="p-3">
          <ol className="space-y-1">
            {data.avgProminence.map((a, i) => {
              const b = byKey.get(a.key);
              return (
                <li key={a.key} className="relative flex items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 text-sm">
                  <span className="absolute inset-y-0 left-0 rounded-lg bg-muted" style={{ width: `${(a.value / maxAvg) * 100}%` }} />
                  <span className="relative w-4 text-xs text-muted-foreground tabular">{i + 1}</span>
                  <span className="relative size-2 shrink-0 rounded-full" style={{ background: b?.color }} />
                  <span className="relative min-w-0 flex-1 truncate font-medium">{b?.name ?? a.key}</span>
                  {b?.isOwn && <YouBadge className="relative" />}
                  <span className="relative text-xs tabular">{a.value.toFixed(1)}</span>
                </li>
              );
            })}
          </ol>
        </Panel>
      </div>

      <Panel
        title="Who leads each attribute"
        description={`Share of praise per attribute — ${own.name}${compare ? ` vs ${compare.name}` : ""}`}
        actions={
          <div className="flex rounded-lg bg-muted p-0.5">
            {[
              { k: "bars", icon: Rows3, label: "Bars" },
              { k: "grid", icon: Grid3x3, label: "Grid" },
            ].map(({ k: key, icon: Icon, label }) => (
              <button
                key={key}
                type="button"
                title={label}
                aria-label={label}
                onClick={() => setView(key)}
                className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium", view === key ? "bg-background shadow-xs" : "text-muted-foreground")}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>
        }
      >
        {view === "grid" ? (
          <Heatmap
            rows={data.attributes.map((a) => ({ key: a.attribute, label: <span title={a.theme}>{a.attribute}</span> }))}
            cols={gridBrands.map((b) => ({ key: b.key, label: b.isOwn ? `${b.name} (You)` : b.name }))}
            values={Object.fromEntries(data.attributes.map((a) => [a.attribute, Object.fromEntries(gridBrands.map((b) => [b.key, a.shares[b.key] ?? null]))]))}
            format="percent"
            rowHeader="Attribute"
          />
        ) : (
          <div className="space-y-5">
            {themesOnPage.map((theme) => (
              <div key={theme}>
                <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{theme}</div>
                <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
                  {pageAttrs
                    .filter((a) => a.theme === theme)
                    .map((a) => {
                      const youShare = a.shares[own.key] ?? 0;
                      const themShare = compare ? (a.shares[compare.key] ?? 0) : 0;
                      const leaderShare = a.leader ? (a.shares[a.leader] ?? 0) : 0;
                      return (
                        <li key={a.attribute} className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-medium">{a.attribute}</span>
                              {a.leader === own.key && (
                                <Badge className="h-4 gap-0.5 bg-foreground px-1.5 text-[10px] text-background">
                                  <Crown className="size-2.5" /> #1
                                </Badge>
                              )}
                              {a.isNew && (
                                <Badge variant="outline" className="h-4 border-info/40 px-1.5 text-[10px] text-info">
                                  new
                                </Badge>
                              )}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular">{a.mentions} mentions</span>
                          </div>
                          <PairBar label={own.name} value={youShare} color={own.color} />
                          {compare && <PairBar label={compare.name} value={themShare} color={compare.color} />}
                          {a.leader && a.leader !== own.key && a.leader !== compare?.key && (
                            <p className="text-[11px] text-muted-foreground">
                              Led by {name(a.leader)} ({leaderShare.toFixed(0)}%)
                            </p>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
            {pages > 1 && (
              <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                <Button variant="outline" size="sm" className="h-7" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="size-3.5" />
                </Button>
                <span className="px-2 tabular">
                  {page + 1} / {pages}
                </span>
                <Button variant="outline" size="sm" className="h-7" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function PairBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 truncate text-[11px] text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(value > 0 ? 2 : 0, value)}%`, background: color }} />
      </div>
      <span className="w-9 text-right text-[11px] tabular">{value.toFixed(0)}%</span>
    </div>
  );
}
