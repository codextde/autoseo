"use client";

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** "a–b of N" · Rows per page · Page x of y · prev/next (works with unknown totals via hasMore). */
export function TablePagination({
  page,
  pageSize,
  pageSizes,
  total,
  rowCount,
  hasMore,
  loading,
  onPageChange,
  onPageSizeChange,
}: {
  /** 1-based */
  page: number;
  pageSize: number;
  pageSizes: readonly number[];
  total: number | null;
  rowCount: number;
  hasMore?: boolean;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const start = rowCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = (page - 1) * pageSize + rowCount;
  const totalPages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const canNext = totalPages != null ? page < totalPages : Boolean(hasMore);
  return (
    <div className="flex flex-col items-center justify-between gap-2 pt-3 text-xs text-muted-foreground sm:flex-row">
      <div className="flex items-center gap-2">
        <span className="tabular">
          {start.toLocaleString()}–{end.toLocaleString()}
          {total != null ? ` of ${total.toLocaleString()}` : ""}
        </span>
        {loading && <Loader2 className="size-3.5 animate-spin" />}
      </div>
      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="hidden sm:inline">Rows per page</span>
            <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
              <SelectTrigger size="sm" className="h-7 w-[76px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizes.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <span className="tabular">
          Page {page}
          {totalPages != null ? ` of ${totalPages.toLocaleString()}` : ""}
        </span>
        <div className="flex gap-1">
          <Button variant="outline" size="icon-sm" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={!canNext || loading} onClick={() => onPageChange(page + 1)} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
