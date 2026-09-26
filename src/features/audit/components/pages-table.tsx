"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ExternalLink, FileSearch } from "lucide-react";
import { ExportMenu, fetchCsvTable } from "@/components/app/export-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type Column, type SortState } from "@/components/app/data-table";
import { FilterBar, SearchInput } from "@/components/app/filters";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlPatch } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { formatMs, HttpStatusBadge, pathOf, ScorePill } from "./bits";

export type PageRow = {
  id: string;
  url: string;
  statusCode: number | null;
  fetchClass: string;
  redirectUrl: string | null;
  title: string | null;
  h1Count: number;
  wordCount: number;
  imagesTotal: number;
  imagesMissingAlt: number;
  responseTimeMs: number;
  isIndexable: boolean;
  crawlDepth: number | null;
  inlinkCount: number | null;
  issueCount: number;
  score: number | null;
  contentType: string | null;
};

export type PagesFilterState = { q: string; status: string; idx: string; alt: string; sort: string; dir: "asc" | "desc"; page: number };

export function PagesTable({
  base,
  rows,
  total,
  pageSize,
  filters,
  predominantHost,
}: {
  base: string;
  rows: PageRow[];
  total: number;
  pageSize: number;
  filters: PagesFilterState;
  predominantHost: string | null;
}) {
  const router = useRouter();
  const [patch, pending] = useUrlPatch();
  const isContent = (r: PageRow) => r.fetchClass === "ok" && r.statusCode !== null && r.statusCode >= 200 && r.statusCode < 300 && (r.contentType ?? "").includes("html");
  const sort: SortState = filters.sort ? { id: filters.sort, dir: filters.dir } : null;

  const columns: Column<PageRow>[] = [
    {
      id: "url",
      header: "URL",
      sortable: true,
      cell: (r) => (
        <div className="flex min-w-0 max-w-[340px] items-center gap-1.5">
          <Link href={`${base}/pages/${r.id}`} className="truncate font-mono text-xs hover:underline" title={r.url} onClick={(e) => e.stopPropagation()}>
            {pathOf(r.url, predominantHost)}
          </Link>
          <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Open">
            <ExternalLink className="size-3" />
          </a>
        </div>
      ),
    },
    { id: "status", header: "Status", sortable: true, cell: (r) => <HttpStatusBadge status={r.statusCode} fetchClass={r.fetchClass} /> },
    {
      id: "title",
      header: "Title",
      sortable: true,
      hideBelow: "md",
      cell: (r) =>
        r.statusCode && r.statusCode >= 300 && r.statusCode < 400 ? (
          <span className="truncate text-xs text-muted-foreground">→ {r.redirectUrl ? pathOf(r.redirectUrl, predominantHost) : "?"}</span>
        ) : r.title ? (
          <span className="block max-w-[280px] truncate text-xs" title={r.title}>
            {r.title}
          </span>
        ) : isContent(r) ? (
          <span className="text-xs font-medium text-destructive">missing</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    { id: "h1", header: "H1", align: "right", sortable: true, hideBelow: "lg", cell: (r) => (isContent(r) ? <span className={cn(r.h1Count !== 1 && "text-warning")}>{r.h1Count}</span> : "-") },
    { id: "words", header: "Words", align: "right", sortable: true, hideBelow: "lg", cell: (r) => (isContent(r) ? r.wordCount.toLocaleString() : "-") },
    {
      id: "images",
      header: "Images",
      align: "right",
      sortable: true,
      hideBelow: "xl",
      cell: (r) => (r.imagesMissingAlt > 0 ? <span className="text-warning" title="missing alt / total">{r.imagesMissingAlt}/{r.imagesTotal}</span> : r.imagesTotal),
    },
    { id: "depth", header: "Depth", align: "right", sortable: true, hideBelow: "xl", cell: (r) => r.crawlDepth ?? <span className="text-muted-foreground">–</span> },
    { id: "inlinks", header: "Inlinks", align: "right", sortable: true, hideBelow: "xl", cell: (r) => r.inlinkCount ?? "–" },
    { id: "speed", header: "Speed", align: "right", sortable: true, hideBelow: "md", cell: (r) => <span className={cn(r.responseTimeMs > 1500 && "text-warning")}>{formatMs(r.responseTimeMs)}</span> },
    { id: "issues", header: "Issues", align: "right", sortable: true, cell: (r) => (r.issueCount ? <span className="font-medium">{r.issueCount}</span> : <span className="text-muted-foreground">0</span>) },
    { id: "score", header: "Score", align: "right", sortable: true, hideBelow: "sm", cell: (r) => <ScorePill score={r.score} /> },
  ];

  const active = [filters.status !== "all", filters.idx !== "all", filters.alt === "missing"].filter(Boolean).length;
  const set = (values: Record<string, string | null>) => patch({ ...values, page: null });

  return (
    <div className={cn("space-y-3 transition-opacity", pending && "opacity-60")}>
      <FilterBar
        activeCount={active}
        search={<SearchInput value={filters.q} onChange={(v) => set({ q: v || null })} placeholder="Search URL, title, meta…" />}
        right={
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground tabular sm:inline">{total.toLocaleString()} pages</span>
            <ExportMenu
              filename="audit-pages"
              title={`Site audit pages — ${new Date().toISOString().slice(0, 10)}`}
              csvHref={`${base}/export?kind=pages&format=csv`}
              getData={() => fetchCsvTable(`${base}/export?kind=pages&format=csv`)}
            />
          </div>
        }
      >
        <Select value={filters.status} onValueChange={(v) => set({ status: v === "all" ? null : v })}>
          <SelectTrigger size="sm" className="h-8 min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="2xx">2xx OK</SelectItem>
            <SelectItem value="3xx">3xx Redirect</SelectItem>
            <SelectItem value="4xx">4xx Client error</SelectItem>
            <SelectItem value="5xx">5xx Server error</SelectItem>
            <SelectItem value="blocked">Blocked / 429</SelectItem>
            <SelectItem value="error">Fetch error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.idx} onValueChange={(v) => set({ idx: v === "all" ? null : v })}>
          <SelectTrigger size="sm" className="h-8 min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Indexability: all</SelectItem>
            <SelectItem value="yes">Indexable</SelectItem>
            <SelectItem value="no">Not indexable</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.alt} onValueChange={(v) => set({ alt: v === "all" ? null : v })}>
          <SelectTrigger size="sm" className="h-8 min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alt text: all</SelectItem>
            <SelectItem value="missing">Missing alt</SelectItem>
            <SelectItem value="issues">Pages with issues</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={(s) => patch({ sort: s?.id ?? null, dir: s?.dir ?? null, page: null })}
        total={total}
        page={filters.page}
        pageSize={pageSize}
        onPageChange={(p) => patch({ page: p ? String(p) : null })}
        onRowClick={(r) => router.push(`${base}/pages/${r.id}`)}
        dense
        empty={<EmptyState compact icon={FileSearch} title="No pages match" description="Adjust the filters or search." />}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-xs">{pathOf(r.url, predominantHost)}</span>
              <HttpStatusBadge status={r.statusCode} fetchClass={r.fetchClass} />
            </div>
            {r.title && <p className="line-clamp-1 text-xs text-muted-foreground">{r.title}</p>}
            <div className="flex items-center justify-between text-xs text-muted-foreground tabular">
              <span>
                {formatMs(r.responseTimeMs)} · {r.wordCount.toLocaleString()} words · {r.issueCount} issues
              </span>
              <ArrowRight className="size-3.5" />
            </div>
          </div>
        )}
      />
    </div>
  );
}
