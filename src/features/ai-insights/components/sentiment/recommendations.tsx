"use client";

import { useState } from "react";
import { Award, Scale, UserMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Panel } from "@/components/app/page";
import { Heatmap } from "@/components/app/charts";
import { EmptyState } from "@/components/app/empty-state";
import { EngineIcon } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import { cn } from "@/lib/utils";
import type { Recommendations } from "@/server/ai/insights/sentiment";
import type { BrandDTO } from "../../types";
import { YouBadge } from "../brand";
import { openAnswer } from "../answer-sheet";

export function RecommendationsView({ data, own, brands }: { data: Recommendations; own: BrandDTO; brands: BrandDTO[] }) {
  const byKey = new Map(brands.map((b) => [b.key, b]));
  const [openH2h, setOpenH2h] = useState<string | null>(null);
  const [cell, setCell] = useState<{ brand: string; label: string } | null>(null);
  const cellData = cell ? data.bestFor.cells[cell.brand]?.[cell.label] : null;
  const cellBrand = cell ? (data.bestFor.brands.find((b) => b.key === cell.brand)?.name ?? "") : "";
  const maxTaker = Math.max(1, ...data.takers.map((t) => t.answers));

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <Panel title="Head-to-head" icon={<Scale className="size-4" />} description="When AI compares you with another brand, whom does it favour?">
          {data.headToHead.length === 0 ? (
            <EmptyState compact title="No comparisons yet" description="Head-to-head claims appear when answers directly compare you with a competitor." />
          ) : (
            <ul className="space-y-3">
              {data.headToHead.map((h) => {
                const b = byKey.get(h.key);
                const total = h.youWins + h.themWins + h.ties;
                const favoursYou = h.youWins >= h.themWins;
                const open = openH2h === h.key;
                return (
                  <li key={h.key}>
                    <button type="button" onClick={() => setOpenH2h(open ? null : h.key)} className="w-full text-left">
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <Favicon domain={b?.domain} fallback={b?.name} />
                          <span className="truncate font-medium">vs {b?.name ?? "Unknown"}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          AI favours <b className={cn(favoursYou ? "text-success" : "text-destructive")}>{favoursYou ? own.name : b?.name}</b> in{" "}
                          {favoursYou ? h.youWins : h.themWins} of {total} claims
                        </span>
                      </div>
                      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                        <div style={{ width: `${(h.youWins / (total || 1)) * 100}%`, background: own.color }} />
                        <div style={{ width: `${(h.ties / (total || 1)) * 100}%` }} className="bg-muted-foreground/30" />
                        <div style={{ width: `${(h.themWins / (total || 1)) * 100}%`, background: b?.color ?? "var(--chart-1)" }} />
                      </div>
                    </button>
                    {open && (
                      <ul className="mt-2 space-y-1 border-l-2 pl-3">
                        {h.claims.map((c) => (
                          <li key={c.id}>
                            <button type="button" onClick={() => openAnswer(c.answerId)} className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted">
                              <EngineIcon id={c.engine} size="xs" withTooltip={false} />
                              <span className="flex-1">{c.label}</span>
                              <Badge variant="outline" className={cn("h-4 px-1 text-[10px]", c.winner === "you" ? "text-success" : c.winner === "them" ? "text-destructive" : "")}>
                                {c.winner === "you" ? "You" : c.winner === "them" ? b?.name : "Tie"}
                              </Badge>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title="Who takes your picks"
          icon={<UserMinus className="size-4" />}
          description="Answers that mention you but recommend another brand"
        >
          {data.takers.length === 0 ? (
            <EmptyState compact title="Nobody takes your picks" description="Whenever you're mentioned, AI either recommends you or nobody in particular." />
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                <b className="text-foreground tabular">{data.takersTotal}</b> answers named you but picked someone else.
              </p>
              <ol className="space-y-1.5">
                {data.takers.map((t, i) => {
                  const b = byKey.get(t.key);
                  return (
                    <li key={t.key}>
                      <button
                        type="button"
                        onClick={() => t.answerIds[0] && openAnswer(t.answerIds[0])}
                        className="relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 text-left text-sm hover:ring-1 hover:ring-border"
                      >
                        <span className="absolute inset-y-0 left-0 rounded-lg bg-muted" style={{ width: `${(t.answers / maxTaker) * 100}%` }} />
                        <span className="relative w-4 text-xs text-muted-foreground tabular">{i + 1}</span>
                        <Favicon domain={b?.domain} fallback={t.name} className="relative" />
                        <span className="relative min-w-0 flex-1 truncate font-medium">
                          {t.name}
                          {!b && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">untracked</span>}
                        </span>
                        <span className="relative text-xs text-muted-foreground tabular">
                          {t.answers} answers · {t.prompts} prompts
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Recommended for…" icon={<Award className="size-4" />} description="Which brand AI picks for each situation. Click a cell to read the answers.">
        {data.bestFor.labels.length === 0 ? (
          <EmptyState compact title="No recommendations yet" description="“Best for …” picks are extracted from answers to recommendation prompts." />
        ) : (
          <Heatmap
            rows={data.bestFor.brands.map((b) => ({
              key: b.key,
              label: (
                <span className="flex items-center gap-1.5">
                  {byKey.get(b.key) && <span className="size-2 rounded-full" style={{ background: byKey.get(b.key)!.color }} />}
                  {b.name}
                  {b.isOwn && <YouBadge />}
                </span>
              ),
            }))}
            cols={data.bestFor.labels.map((l) => ({ key: l, label: l }))}
            values={Object.fromEntries(data.bestFor.brands.map((b) => [b.key, Object.fromEntries(data.bestFor.labels.map((l) => [l, data.bestFor.cells[b.key]?.[l]?.n ?? null]))]))}
            rowHeader="Brand"
            onCellClick={(brand, label) => setCell({ brand, label })}
          />
        )}
      </Panel>

      <Dialog open={!!cell} onOpenChange={(o) => !o && setCell(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {cellBrand} · {cell?.label}
            </DialogTitle>
            <DialogDescription>{cellData?.n ?? 0} answers picked {cellBrand} for this situation.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {cellData?.answers.map((a) => (
              <li key={a.answerId}>
                <button
                  type="button"
                  onClick={() => {
                    setCell(null);
                    openAnswer(a.answerId);
                  }}
                  className="flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-sm hover:bg-muted"
                >
                  <EngineIcon id={a.engine} size="xs" withTooltip={false} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2">{a.promptText}</span>
                    <span className="text-xs text-muted-foreground">{a.date}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
