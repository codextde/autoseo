"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RotateCw, Sheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/app/page";
import type { SerpAnalysisResult } from "@/server/seo/lib/serp";
import { estimateSerpAnalysis } from "@/server/seo/lib/costs";
import { getSerpAnalysisAction } from "../../actions/keywords";
import { copyTableForSheets, unwrap } from "../../lib/client";
import { peekSeoQuery, useSeoQuery } from "../../hooks/use-seo-query";
import { SheetsDialog } from "../shared/export-menu";
import { ExternalUrl } from "../shared/external-link";
import { CostPill } from "../shared/badges";
import { capitalize, serpKey } from "./params";

type SerpData = SerpAnalysisResult & { cached: boolean };

const PER_PAGE = 10;
const SERP_STALE_MS = 12 * 60 * 60_000;

/**
 * SERP Analysis card (open-seo SerpAnalysisCard): opens at depth 20, 10 rows per page; on the last loaded page the
 * Next button becomes "Load top 100" (depth 100 re-crawl, shallow results stay visible). A failed depth-100 crawl
 * offers "Show top 20" instead of re-buying.
 */
export function SerpPanel({ projectId, keyword, locationCode, bare }: { projectId: string; keyword: string; locationCode: number; bare?: boolean }) {  const [depth, setDepth] = useState<20 | 100>(20);
  const [requestedPage, setPage] = useState(0);
  const [sheetsOpen, setSheetsOpen] = useState(false);

  // State resets per keyword because the parent keys this component by keyword + location (a depth-100 crawl
  // for one keyword must never leak into the next one's first fetch).
  const key = keyword ? serpKey(projectId, keyword, locationCode, depth) : null;
  const query = useSeoQuery<SerpData>(
    key,
    async () => unwrap(await getSerpAnalysisAction(projectId, { keyword, locationCode, depth })),
    { staleMs: SERP_STALE_MS },
  );
  const shallow = depth === 100 ? peekSeoQuery<SerpData>(serpKey(projectId, keyword, locationCode, 20)) : undefined;
  const data = query.data ?? (depth === 100 ? shallow : undefined);
  const items = data?.items ?? [];
  const loadedDepth = data?.depth ?? depth;
  const pageCount = Math.max(1, Math.ceil(items.length / PER_PAGE));
  // "Load top 100" requests the next page up front; it becomes reachable once the deeper crawl lands.
  const page = Math.min(requestedPage, pageCount - 1);
  const onLastPage = page >= pageCount - 1;
  const canLoadMore = onLastPage && loadedDepth < 100 && items.length > 0;
  const loadingMore = depth === 100 && query.loading;

  const rows = items.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  const exportSheets = async () => {
    const ok = await copyTableForSheets(
      ["Rank", "Title", "URL", "Domain"],
      items.map((i) => [i.rank, i.title, i.url, i.domain]),
    );
    if (ok) setSheetsOpen(true);
  };

  const body = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground tabular">
          {data ? `${items.length} organic result${items.length === 1 ? "" : "s"}` : query.loading ? "Loading SERP…" : ""}
          {data?.cached ? " · cached" : ""}
        </span>
        <Button variant="outline" size="sm" className="h-7" disabled={items.length === 0} onClick={exportSheets}>
          <Sheet /> Export to Sheets
        </Button>
      </div>

      {query.error && !loadingMore ? (
        <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="text-destructive">{query.error}</p>
          {depth === 100 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDepth(20);
                setPage(0);
              }}
            >
              Show top 20
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              <RotateCw /> Retry
            </Button>
          )}
        </div>
      ) : !data && query.loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No SERP details available for this keyword yet. Try clicking another keyword to load data.
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="w-12 px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Page</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={`${item.rank}-${item.url}`} className="border-t align-top">
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground tabular">{item.rank}</td>
                    <td className="min-w-0 px-3 py-2.5">
                      <ExternalUrl href={item.url} label={item.title || item.url} maxWidth="max-w-full" className="font-medium" />
                      <div className="truncate text-xs text-muted-foreground">{item.domain}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {loadingMore && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading more results…
            </p>
          )}
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular">
              Page {page + 1} of {pageCount}
            </span>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-7" disabled={page === 0} onClick={() => setPage(page - 1)}>
                <ChevronLeft /> Prev
              </Button>
              {canLoadMore ? (
                <>
                  <CostPill usd={estimateSerpAnalysis(100)} className="hidden sm:inline-flex" />
                  <Button
                    size="sm"
                    className="h-7"
                    disabled={loadingMore}
                    onClick={() => {
                      setPage(page + 1);
                      setDepth(100);
                    }}
                  >
                    {loadingMore ? <Loader2 className="animate-spin" /> : null}
                    Load top 100
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" className="h-7" disabled={onLastPage} onClick={() => setPage(page + 1)}>
                  Next <ChevronRight />
                </Button>
              )}
            </div>
          </div>
        </>
      )}
      <SheetsDialog open={sheetsOpen} onOpenChange={setSheetsOpen} />
    </div>
  );

  if (bare) return body;
  return (
    <Panel title={<span className="truncate">SERP Analysis: {capitalize(keyword)}</span>} description="Top organic results on Google (desktop)">
      {body}
    </Panel>
  );
}
