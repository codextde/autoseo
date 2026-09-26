"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";
export type SortState = { id: string; dir: SortDir } | null;

export type Column<T> = {
  id: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  /** Enables client-side sorting for this column. */
  sortValue?: (row: T) => number | string | null | undefined;
  /** Enables server-side sorting (with `onSortChange`). */
  sortable?: boolean;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
  width?: string;
  hint?: string;
  /** Hide on small screens (table mode only). */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  /** Keep first column visible when scrolling horizontally. */
  sticky?: boolean;
};

const hideCls = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" };

export function DataTable<T>({
  columns,
  data,
  getRowId,
  loading,
  empty,
  initialSort = null,
  sort: controlledSort,
  onSortChange,
  pageSize: initialPageSize = 50,
  paginate = true,
  total,
  page: controlledPage,
  onPageChange,
  selectable,
  selected,
  onSelectedChange,
  renderExpanded,
  onRowClick,
  mobileCard,
  className,
  rowClassName,
  dense,
  stickyHeader = true,
  groupBy,
  renderGroupHeader,
}: {
  columns: Column<T>[];
  data: T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  empty?: React.ReactNode;
  initialSort?: SortState;
  sort?: SortState;
  onSortChange?: (s: SortState) => void;
  pageSize?: number;
  paginate?: boolean;
  /** Server-side pagination: total rows + controlled page (0-based). */
  total?: number;
  page?: number;
  onPageChange?: (page: number) => void;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (s: Set<string>) => void;
  renderExpanded?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
  /** Mobile (<640px) card renderer. When omitted the table scrolls horizontally. */
  mobileCard?: (row: T) => React.ReactNode;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
  dense?: boolean;
  stickyHeader?: boolean;
  /** Group rows (e.g. prompts by topic) — rows are rendered under a group header. */
  groupBy?: (row: T) => string;
  renderGroupHeader?: (group: string, rows: T[], open: boolean, toggle: () => void) => React.ReactNode;
}) {
  const [internalSort, setInternalSort] = useState<SortState>(initialSort);
  const sort = controlledSort !== undefined ? controlledSort : internalSort;
  const [internalPage, setInternalPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const rawPage = controlledPage ?? internalPage;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const serverPaged = total !== undefined && onPageChange;


  const sorted = useMemo(() => {
    if (!sort || onSortChange) return data;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return data;
    const get = col.sortValue;
    return [...data].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [data, sort, columns, onSortChange]);

  const totalRows = serverPaged ? total! : sorted.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  // Clamp instead of resetting in an effect: shrinking data (filters) never leaves an empty page.
  const page = serverPaged ? rawPage : Math.min(rawPage, pageCount - 1);

  const pageRows = useMemo(() => {
    if (!paginate || serverPaged || groupBy) return sorted;
    return sorted.slice(page * pageSize, page * pageSize + pageSize);
  }, [sorted, paginate, serverPaged, page, pageSize, groupBy]);

  const toggleSort = (col: Column<T>) => {
    if (!col.sortValue && !col.sortable) return;
    const next: SortState =
      sort?.id !== col.id ? { id: col.id, dir: "desc" } : sort.dir === "desc" ? { id: col.id, dir: "asc" } : null;
    if (onSortChange) onSortChange(next);
    else setInternalSort(next);
  };

  const setPage = (p: number) => (onPageChange ? onPageChange(p) : setInternalPage(p));
  const allIds = pageRows.map(getRowId);
  const allSelected = selectable && allIds.length > 0 && allIds.every((id) => selected?.has(id));
  const colCount = columns.length + (selectable ? 1 : 0) + (renderExpanded ? 1 : 0);

  const renderRow = (row: T, i: number) => {
    const id = getRowId(row);
    const isOpen = expanded.has(id);
    return (
      <Fragment key={id}>
        <tr
          className={cn(
            "group border-b transition-colors last:border-0 hover:bg-muted/40",
            onRowClick && "cursor-pointer",
            selected?.has(id) && "bg-brand-soft/40",
            rowClassName?.(row),
          )}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
        >
          {selectable && (
            <td className="w-10 px-3" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={selected?.has(id) ?? false}
                onCheckedChange={(v) => {
                  const next = new Set(selected);
                  if (v) next.add(id);
                  else next.delete(id);
                  onSelectedChange?.(next);
                }}
                aria-label="Select row"
              />
            </td>
          )}
          {columns.map((col) => (
            <td
              key={col.id}
              className={cn(
                dense ? "px-3 py-2" : "px-3 py-3",
                "align-middle text-sm",
                col.align === "right" && "text-right tabular",
                col.align === "center" && "text-center",
                col.sticky && "sticky left-0 z-[1] bg-card group-hover:bg-muted",
                col.hideBelow && hideCls[col.hideBelow],
                col.className,
              )}
              style={col.width ? { width: col.width } : undefined}
            >
              {col.cell(row, i)}
            </td>
          ))}
          {renderExpanded && (
            <td className="w-10 px-2 text-right" onClick={(e) => e.stopPropagation()}>
              <Button
                variant={isOpen ? "default" : "ghost"}
                size="icon"
                className="size-7"
                aria-label={isOpen ? "Collapse" : "Expand"}
                onClick={() => {
                  const next = new Set(expanded);
                  if (isOpen) next.delete(id);
                  else next.add(id);
                  setExpanded(next);
                }}
              >
                <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} />
              </Button>
            </td>
          )}
        </tr>
        {renderExpanded && isOpen && (
          <tr className="border-b bg-muted/20">
            <td colSpan={colCount} className="p-0">
              {renderExpanded(row)}
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const groups = useMemo(() => {
    if (!groupBy) return null;
    const map = new Map<string, T[]>();
    for (const row of pageRows) {
      const g = groupBy(row);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(row);
    }
    return [...map.entries()];
  }, [groupBy, pageRows]);

  const body = loading ? (
    Array.from({ length: 6 }).map((_, i) => (
      <tr key={i} className="border-b last:border-0">
        {Array.from({ length: colCount }).map((__, j) => (
          <td key={j} className="px-3 py-3">
            <Skeleton className="h-4 w-full max-w-40" />
          </td>
        ))}
      </tr>
    ))
  ) : pageRows.length === 0 ? (
    <tr>
      <td colSpan={colCount}>{empty ?? <div className="py-12 text-center text-sm text-muted-foreground">No results.</div>}</td>
    </tr>
  ) : groups ? (
    groups.map(([g, rows]) => {
      const open = !closedGroups.has(g);
      const toggle = () => {
        const next = new Set(closedGroups);
        if (open) next.add(g);
        else next.delete(g);
        setClosedGroups(next);
      };
      return (
        <Fragment key={`g-${g}`}>
          <tr className="border-b bg-muted/50">
            <td colSpan={colCount} className="px-3 py-2">
              {renderGroupHeader ? (
                renderGroupHeader(g, rows, open, toggle)
              ) : (
                <button type="button" onClick={toggle} className="flex items-center gap-2 text-sm font-medium">
                  <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
                  {g} <span className="text-xs font-normal text-muted-foreground">{rows.length}</span>
                </button>
              )}
            </td>
          </tr>
          {open && rows.map((row, i) => renderRow(row, i))}
        </Fragment>
      );
    })
  ) : (
    pageRows.map((row, i) => renderRow(row, i))
  );

  return (
    <div className={cn("min-w-0", className)}>
      {mobileCard && (
        <div className="space-y-2 sm:hidden">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
            : pageRows.length === 0
              ? (empty ?? <div className="py-10 text-center text-sm text-muted-foreground">No results.</div>)
              : pageRows.map((row) => (
                  <div
                    key={getRowId(row)}
                    className="rounded-xl border bg-card p-3"
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {mobileCard(row)}
                  </div>
                ))}
        </div>
      )}
      <div className={cn("overflow-x-auto rounded-xl border bg-card", mobileCard && "hidden sm:block")}>
        <table className="w-full border-collapse text-left">
          <thead className={cn(stickyHeader && "sticky top-0 z-[2]")}>
            <tr className="border-b bg-muted/60 text-xs text-muted-foreground">
              {selectable && (
                <th className="w-10 px-3 py-2.5">
                  <Checkbox
                    checked={!!allSelected}
                    onCheckedChange={(v) => {
                      const next = new Set(selected);
                      for (const id of allIds) {
                        if (v) next.add(id);
                        else next.delete(id);
                      }
                      onSelectedChange?.(next);
                    }}
                    aria-label="Select all"
                  />
                </th>
              )}
              {columns.map((col) => {
                const canSort = !!col.sortValue || !!col.sortable;
                const active = sort?.id === col.id;
                const inner = (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-medium whitespace-nowrap",
                      canSort && "cursor-pointer select-none hover:text-foreground",
                      active && "text-foreground",
                    )}
                    onClick={() => toggleSort(col)}
                  >
                    {col.header}
                    {canSort &&
                      (active ? (
                        sort!.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" />
                      ))}
                  </span>
                );
                return (
                  <th
                    key={col.id}
                    className={cn(
                      "px-3 py-2.5 font-normal",
                      col.align === "right" && "text-right",
                      col.align === "center" && "text-center",
                      col.sticky && "sticky left-0 z-[3] bg-muted",
                      col.hideBelow && hideCls[col.hideBelow],
                      col.headerClassName,
                    )}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.hint ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{inner}</TooltipTrigger>
                        <TooltipContent className="max-w-64">{col.hint}</TooltipContent>
                      </Tooltip>
                    ) : (
                      inner
                    )}
                  </th>
                );
              })}
              {renderExpanded && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
      {paginate && !groupBy && totalRows > Math.min(pageSize, 10) && (
        <div className="mt-3 flex flex-col items-center justify-between gap-2 text-xs text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <span>Show</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
            >
              <SelectTrigger size="sm" className="h-7 w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100, 250].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="tabular">
              Showing {totalRows === 0 ? 0 : page * pageSize + 1} to {Math.min(totalRows, (page + 1) * pageSize)} of{" "}
              {totalRows.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7" disabled={page <= 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="size-3.5" /> Previous
            </Button>
            <span className="px-2 tabular">
              {page + 1} / {pageCount}
            </span>
            <Button variant="outline" size="sm" className="h-7" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
