"use client";

import { motion } from "motion/react";
import { Crosshair, Navigation, SearchX } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/app/empty-state";
import { KpiStrip } from "@/components/app/metrics";
import { ExportMenu } from "../shared/export-menu";
import { bool, formatLatLng, num, rec, recs, str } from "./shared";
import { cn } from "@/lib/utils";

type Cell = {
  row: number;
  col: number;
  latitude: number;
  longitude: number;
  rank: number | null;
  resultsCount: number | null;
  top: { title: string | null; cid: string | null } | null;
  error: boolean;
};

function tone(c: Cell): { bg: string; fg: string; label: string } {
  if (c.error) return { bg: "", fg: "text-muted-foreground", label: "Failed" };
  if (c.rank == null) return { bg: "bg-muted-foreground/25", fg: "text-muted-foreground", label: "Not in top 20" };
  if (c.rank <= 3) return { bg: "bg-emerald-500", fg: "text-white", label: "Top 3" };
  if (c.rank <= 10) return { bg: "bg-amber-400", fg: "text-amber-950", label: "4–10" };
  return { bg: "bg-orange-500", fg: "text-white", label: "11–20" };
}

const LEGEND = [
  { cls: "bg-emerald-500", label: "1–3" },
  { cls: "bg-amber-400", label: "4–10" },
  { cls: "bg-orange-500", label: "11–20" },
  { cls: "bg-muted-foreground/25", label: "Not found" },
  { cls: "stripes", label: "Search failed" },
];

const STRIPES = "repeating-linear-gradient(135deg, var(--muted) 0 4px, var(--border) 4px 8px)";

/** Geo-grid heatmap: north on top, each point a circle coloured by the target's Maps rank. */
export function RankGridResult({ result }: { result: unknown }) {
  const r = rec(result);
  const gridSize = num(r?.gridSize) ?? 3;
  const cells: Cell[] = recs(r?.grid).map((c) => {
    const top = rec(c.topResult);
    return {
      row: num(c.row) ?? 0,
      col: num(c.col) ?? 0,
      latitude: num(c.latitude) ?? 0,
      longitude: num(c.longitude) ?? 0,
      rank: num(c.rank),
      resultsCount: num(c.resultsCount),
      top: top ? { title: str(top.title), cid: str(top.cid) } : null,
      error: bool(c.error) === true,
    };
  });
  const summary = rec(r?.summary);
  const matched = rec(r?.matchedBusiness);
  const center = rec(r?.center);
  const spacing = num(r?.spacingKm);
  const zoom = num(r?.zoom);
  const middle = (gridSize - 1) / 2;
  if (!cells.length) return <EmptyState compact icon={SearchX} title="No grid data" />;
  const avg = num(summary?.averageRank);
  const found = num(summary?.pointsFound) ?? 0;
  const searched = num(summary?.pointsSearched) ?? cells.length;
  const exportRows = () => cells.map((c) => [c.row, c.col, c.latitude, c.longitude, c.error ? "error" : (c.rank ?? ""), c.resultsCount ?? "", c.top?.title ?? ""]);
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">“{str(r?.keyword) ?? "keyword"}”</h3>
          <p className="text-xs text-muted-foreground">
            {matched ? (
              <>
                Matched <span className="font-medium text-foreground">{str(matched.title) ?? "business"}</span>
                {str(matched.cid) ? ` · CID ${str(matched.cid)}` : ""}
              </>
            ) : (
              "The target business wasn't found at any grid point."
            )}
          </p>
        </div>
        <ExportMenu
          getData={() => ({ headers: ["Row", "Col", "Latitude", "Longitude", "Rank", "Results", "#1 business"], rows: exportRows(), filename: "local-rank-grid" })}
        />
      </div>

      <KpiStrip
        items={[
          { key: "searched", label: "Points searched", value: searched.toLocaleString() },
          { key: "found", label: "Found at", value: `${found}/${searched}`, sub: `${searched ? Math.round((found / searched) * 100) : 0}% coverage` },
          { key: "avg", label: "Average rank", value: avg != null ? avg.toFixed(1) : "—" },
          { key: "top3", label: "Top 3", value: String(num(summary?.top3Count) ?? 0) },
          { key: "top10", label: "Top 10", value: String(num(summary?.top10Count) ?? 0) },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="relative mx-auto w-full max-w-[34rem] overflow-hidden rounded-2xl border bg-[radial-gradient(circle,var(--border)_1px,transparent_1.2px)] bg-muted/30 [background-size:18px_18px] p-5 sm:p-8">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,transparent_49.6%,var(--border)_49.6%,var(--border)_50.4%,transparent_50.4%),linear-gradient(to_bottom,transparent_49.6%,var(--border)_49.6%,var(--border)_50.4%,transparent_50.4%)] opacity-60" />
          <div className="absolute top-2 left-1/2 flex -translate-x-1/2 flex-col items-center text-[10px] font-semibold text-muted-foreground">
            <Navigation className="size-3 fill-current" />N
          </div>
          <div className="relative grid gap-2 sm:gap-3" style={{ gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))` }}>
            {cells.map((c, i) => {
              const t = tone(c);
              const isCenter = c.row === middle && c.col === middle;
              return (
                <Tooltip key={`${c.row}-${c.col}`}>
                  <TooltipTrigger asChild>
                    <motion.button
                      type="button"
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: i * 0.025, type: "spring", stiffness: 380, damping: 24 }}
                      className={cn(
                        "relative mx-auto flex aspect-square w-full max-w-20 items-center justify-center rounded-full text-sm font-semibold shadow-sm ring-offset-2 ring-offset-background tabular transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring sm:text-base",
                        t.bg,
                        t.fg,
                        isCenter && "ring-2 ring-foreground",
                      )}
                      style={c.error ? { background: STRIPES } : undefined}
                      aria-label={`Row ${c.row + 1}, column ${c.col + 1}: ${c.error ? "search failed" : c.rank != null ? `rank ${c.rank}` : "not found"}`}
                    >
                      {c.error ? "×" : (c.rank ?? "–")}
                    </motion.button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64 space-y-0.5">
                    <div className="font-medium">
                      {c.error ? "Search failed at this point" : c.rank != null ? `Rank #${c.rank}` : "Not in the top 20"}
                      {isCenter ? " · center" : ""}
                    </div>
                    <div className="tabular opacity-80">{formatLatLng(c)}</div>
                    {c.resultsCount != null && <div className="opacity-80">{c.resultsCount} businesses returned</div>}
                    {c.top?.title && <div className="opacity-80">#1: {c.top.title}</div>}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
        <div className="space-y-3 text-sm">
          <div className="rounded-xl border p-3">
            <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Legend</div>
            <ul className="space-y-1.5">
              {LEGEND.map((l) => (
                <li key={l.label} className="flex items-center gap-2 text-xs">
                  <span className={cn("size-3.5 rounded-full", l.cls !== "stripes" && l.cls)} style={l.cls === "stripes" ? { background: STRIPES } : undefined} />
                  {l.label}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-1 rounded-xl border p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 text-foreground">
              <Crosshair className="size-3.5" /> {center ? formatLatLng({ latitude: num(center.latitude) ?? 0, longitude: num(center.longitude) ?? 0 }) : "—"}
            </div>
            <div>
              {gridSize} × {gridSize} grid{spacing != null ? ` · ${spacing} km spacing` : ""}
            </div>
            <div>
              {zoom != null ? `Zoom ${zoom}` : "Auto zoom"} · {str(r?.device) === "desktop" ? "Desktop" : "Mobile"}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
