"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { DataTable, type Column } from "@/components/app/data-table";
import { SearchInput } from "@/components/app/filters";
import { useUrlPatch } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { formatDetails, pathOf } from "./bits";

export type AffectedRow = { id: string; pageId: string | null; pageUrl: string; details: Record<string, unknown> | null };

function DetailsCell({ details, predominantHost }: { details: Record<string, unknown> | null; predominantHost: string | null }) {
  if (!details) return <span className="text-muted-foreground">—</span>;
  const hops = Array.isArray(details.hops) ? (details.hops as string[]) : null;
  if (hops) {
    return (
      <span className="flex flex-wrap items-center gap-1 font-mono text-[11px]">
        {hops.map((h, i) => (
          <span key={`${h}-${i}`} className="inline-flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <span className="rounded bg-muted px-1">{pathOf(h, predominantHost)}</span>
          </span>
        ))}
      </span>
    );
  }
  if (typeof details.targetUrl === "string") {
    return (
      <span className="font-mono text-[11px]">
        → {pathOf(details.targetUrl, predominantHost)} <span className="text-destructive">({String(details.targetStatus)})</span>
      </span>
    );
  }
  if (Array.isArray(details.otherUrls)) {
    return (
      <span className="text-[11px] text-muted-foreground">
        {String(details.groupSize)} pages share this · e.g. {(details.otherUrls as string[]).slice(0, 2).map((u) => pathOf(u, predominantHost)).join(", ")}
      </span>
    );
  }
  return <span className="text-[11px] text-muted-foreground">{formatDetails(details)}</span>;
}

export function AffectedTable({
  base,
  rows,
  total,
  page,
  pageSize,
  q,
  predominantHost,
}: {
  base: string;
  rows: AffectedRow[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  predominantHost: string | null;
}) {
  const [patch, pending] = useUrlPatch();
  const columns: Column<AffectedRow>[] = [
    {
      id: "url",
      header: "URL",
      cell: (r) => (
        <div className="flex min-w-0 max-w-[420px] items-center gap-1.5">
          {r.pageId ? (
            <Link href={`${base}/pages/${r.pageId}`} className="truncate font-mono text-xs hover:underline" title={r.pageUrl}>
              {pathOf(r.pageUrl, predominantHost)}
            </Link>
          ) : (
            <span className="truncate font-mono text-xs">{pathOf(r.pageUrl, predominantHost)}</span>
          )}
          <a href={r.pageUrl} target="_blank" rel="noopener noreferrer nofollow" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Open">
            <ExternalLink className="size-3" />
          </a>
        </div>
      ),
    },
    { id: "details", header: "Details", cell: (r) => <DetailsCell details={r.details} predominantHost={predominantHost} /> },
  ];
  return (
    <div className={cn("space-y-3", pending && "opacity-60")}>
      <SearchInput value={q} onChange={(v) => patch({ q: v || null, page: null })} placeholder="Filter URLs…" className="max-w-sm" />
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(p) => patch({ page: p ? String(p) : null })}
        dense
        mobileCard={(r) => (
          <div className="space-y-1">
            <p className="truncate font-mono text-xs">{pathOf(r.pageUrl, predominantHost)}</p>
            <DetailsCell details={r.details} predominantHost={predominantHost} />
          </div>
        )}
      />
    </div>
  );
}
