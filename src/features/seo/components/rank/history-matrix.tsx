"use client";

import { Fragment, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { formatShortDate } from "./rank-utils";
import { cn } from "@/lib/utils";

export type MatrixData = {
  runs: { id: string; startedAt: Date | string }[];
  cells: { runId: string; trackingKeywordId: string; position: number | null }[];
};

/** "By date" pivot: keyword rows × last N completed full runs, ▲/▼ vs the previous column. */
export function HistoryMatrix({
  data,
  loading,
  keywords,
  onKeywordClick,
}: {
  data: MatrixData | undefined;
  loading: boolean;
  keywords: { id: string; keyword: string }[];
  onKeywordClick: (k: { id: string; keyword: string }) => void;
}) {
  const lookup = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const c of data?.cells ?? []) m.set(`${c.runId}:${c.trackingKeywordId}`, c.position);
    return m;
  }, [data]);

  if (loading && !data)
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  const runs = data?.runs ?? [];
  if (runs.length === 0) return <p className="py-12 text-center text-sm text-muted-foreground">No completed checks yet.</p>;

  return (
    <div className="max-h-[70dvh] overflow-auto rounded-xl border bg-card">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 z-[2]">
          <tr className="border-b bg-muted text-xs text-muted-foreground">
            <th className="sticky left-0 z-[3] min-w-44 bg-muted px-3 py-2.5 font-normal">Keyword</th>
            {runs.map((r) => (
              <th key={r.id} className="px-3 py-2.5 text-right font-normal whitespace-nowrap tabular">
                {formatShortDate(r.startedAt)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keywords.length === 0 && (
            <tr>
              <td colSpan={runs.length + 1} className="py-10 text-center text-sm text-muted-foreground">
                No keywords match your search.
              </td>
            </tr>
          )}
          {keywords.map((k) => (
            <tr key={k.id} className="group border-b last:border-0 hover:bg-muted/40">
              <td className="sticky left-0 z-[1] max-w-60 bg-card px-3 py-2 group-hover:bg-muted">
                <button type="button" className="truncate text-left font-medium hover:underline" onClick={() => onKeywordClick(k)}>
                  {k.keyword}
                </button>
              </td>
              {runs.map((r, i) => {
                const key = `${r.id}:${k.id}`;
                const has = lookup.has(key);
                const pos = lookup.get(key) ?? null;
                const prevRun = i > 0 ? runs[i - 1] : undefined;
                const prev = prevRun ? lookup.get(`${prevRun.id}:${k.id}`) : undefined;
                const delta = pos != null && prev != null ? prev - pos : null;
                return (
                  <td key={r.id} className="px-3 py-2 text-right whitespace-nowrap tabular">
                    {!has || pos == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Fragment>
                        <span>{pos}</span>
                        {delta != null && delta !== 0 && (
                          <span className={cn("ml-1 text-[11px]", delta > 0 ? "text-success" : "text-warning")}>
                            {delta > 0 ? "▲" : "▼"}
                            {Math.abs(delta)}
                          </span>
                        )}
                      </Fragment>
                    )}
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
