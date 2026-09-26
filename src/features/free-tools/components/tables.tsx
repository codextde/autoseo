"use client";

import { FileText, Search } from "lucide-react";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { DifficultyBadge } from "@/features/seo/components/shared/badges";
import type { GapRow, KeywordIdea, RankedKeywordRow, RelevantPageRow } from "../lib/types";
import { formatCount, UrlLink } from "./results";

function Position({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex h-6 min-w-8 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-semibold tabular">#{value}</span>
  );
}

const keywordCell = (k: string | null) => <span className="text-sm font-medium break-words">{k ?? "—"}</span>;

export function RankedKeywordsTable({ rows, compact }: { rows: (RankedKeywordRow & { traffic?: number | null })[]; compact?: boolean }) {
  const withTraffic = rows.some((r) => r.traffic !== undefined);
  const columns: Column<RankedKeywordRow & { traffic?: number | null }>[] = [
    { id: "keyword", header: "Keyword", cell: (r) => keywordCell(r.keyword), sortValue: (r) => r.keyword },
    { id: "volume", header: "Volume", cell: (r) => <span className="tabular">{formatCount(r.searchVolume)}</span>, sortValue: (r) => r.searchVolume, align: "right" },
    ...(compact
      ? []
      : [{ id: "kd", header: "KD", cell: (r: RankedKeywordRow) => <DifficultyBadge value={r.difficulty} />, sortValue: (r: RankedKeywordRow) => r.difficulty, align: "center" as const, hideBelow: "sm" as const }]),
    { id: "position", header: "Position", cell: (r) => <Position value={r.position} />, sortValue: (r) => r.position, align: "center" },
    ...(withTraffic
      ? [{ id: "traffic", header: "Traffic", cell: (r: GapRow) => <span className="tabular">{formatCount(r.traffic)}</span>, sortValue: (r: GapRow) => r.traffic, align: "right" as const }]
      : []),
    { id: "url", header: "Ranking URL", cell: (r) => <UrlLink url={r.url} className="max-w-[260px] text-xs text-muted-foreground" />, hideBelow: "md" },
  ] as Column<RankedKeywordRow & { traffic?: number | null }>[];
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => `${rows.indexOf(r)}|${r.keyword}`}
      paginate={false}
      dense
      empty={<EmptyState compact icon={Search} title="No ranking keywords" description="No organic rankings are on record for this domain in the selected country." />}
      mobileCard={(r) => (
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            {keywordCell(r.keyword)}
            <Position value={r.position} />
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="tabular">{formatCount(r.searchVolume)} / mo</span>
            {r.traffic !== undefined && <span className="tabular">{formatCount(r.traffic)} visits</span>}
            {r.difficulty != null && <span>KD {Math.round(r.difficulty)}</span>}
          </div>
          <UrlLink url={r.url} className="text-xs text-muted-foreground" />
        </div>
      )}
    />
  );
}

export function PagesTable({ rows }: { rows: RelevantPageRow[] }) {
  const columns: Column<RelevantPageRow>[] = [
    { id: "url", header: "Page", cell: (r) => <UrlLink url={r.url} className="max-w-[420px] text-sm" /> },
    { id: "traffic", header: "Traffic / mo", cell: (r) => <span className="tabular">{formatCount(r.traffic)}</span>, sortValue: (r) => r.traffic, align: "right" },
    { id: "keywords", header: "Keywords", cell: (r) => <span className="tabular">{formatCount(r.keywords)}</span>, sortValue: (r) => r.keywords, align: "right" },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => `${rows.indexOf(r)}|${r.url}`}
      paginate={false}
      dense
      empty={<EmptyState compact icon={FileText} title="No ranking pages" description="No pages with organic traffic are on record for the selected country." />}
      mobileCard={(r) => (
        <div className="space-y-1">
          <UrlLink url={r.url} className="text-sm" />
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="tabular">{formatCount(r.traffic)} visits / mo</span>
            <span className="tabular">{formatCount(r.keywords)} keywords</span>
          </div>
        </div>
      )}
    />
  );
}

export function KeywordIdeasTable({ rows }: { rows: KeywordIdea[] }) {
  const columns: Column<KeywordIdea>[] = [
    { id: "keyword", header: "Keyword", cell: (r) => keywordCell(r.keyword), sortValue: (r) => r.keyword },
    { id: "volume", header: "Search volume", cell: (r) => <span className="tabular">{formatCount(r.searchVolume)}</span>, sortValue: (r) => r.searchVolume, align: "right" },
    { id: "kd", header: "Difficulty", cell: (r) => <DifficultyBadge value={r.difficulty} />, sortValue: (r) => r.difficulty, align: "center" },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.keyword}
      paginate={false}
      dense
      empty={<EmptyState compact icon={Search} title="No keyword ideas" description="Try a broader phrase or another country." />}
    />
  );
}
