"use client";

import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column, type SortState } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { formatNumber } from "@/components/app/metrics";
import type { BacklinkRow, ReferringDomainRow, SortOrder, TopPageRow } from "@/server/seo/lib/backlinks";
import type { Cell } from "@/server/seo/lib/csv";
import { getBacklinksRowsAction } from "../../actions/backlinks";
import { unwrap } from "../../lib/client";
import { useSeoQuery } from "../../hooks/use-seo-query";
import { ExternalUrl, middleTruncate } from "../shared/external-link";
import { formatDfsDate, stripWww } from "./params";
import type { AhrefsDr } from "./use-ahrefs-dr";

const int = (v: number | null | undefined) => (v == null ? "—" : formatNumber(Math.round(v), { maximumFractionDigits: 0 }));
const dec1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function DrCell({ dr, domain }: { dr: AhrefsDr; domain: string | null }) {
  const v = dr.get(domain);
  if (v === undefined) return dr.loading ? <Loader2 className="ml-auto size-3 animate-spin text-muted-foreground" /> : <span className="text-muted-foreground">—</span>;
  return <span className="tabular">{v == null ? "—" : Math.round(v)}</span>;
}

type SortProps = { sort: string; order: SortOrder; onSort: (sort: string, order: SortOrder) => void };

function sortHandler({ sort, order, onSort }: SortProps) {
  return (s: SortState) => {
    if (!s || s.id === sort) onSort(sort, order === "desc" ? "asc" : "desc");
    else onSort(s.id, "desc");
  };
}

/* ───────────────────────────── Backlinks ───────────────────────────── */

export function backlinkExport(rows: BacklinkRow[], dr: AhrefsDr | null): { headers: string[]; rows: Cell[][] } {
  const headers = [
    "Domain",
    "Source URL",
    "Target URL",
    "Anchor",
    "Type",
    "Dofollow",
    "Rel Attributes",
    "Domain Rank",
    ...(dr?.enabled ? ["Ahrefs DR"] : []),
    "Source Page Rank",
    "Target Rank",
    "Spam Score",
    "First Seen",
    "Last Seen",
    "Lost",
    "Broken",
    "Links Count",
  ];
  return {
    headers,
    rows: rows.map((r) => [
      r.domainFrom ?? "",
      r.urlFrom ?? "",
      r.urlTo ?? "",
      r.anchor ?? "",
      r.itemType ?? "",
      r.isDofollow == null ? "" : r.isDofollow ? "true" : "false",
      r.relAttributes.join(", "),
      r.domainFromRank ?? "",
      ...(dr?.enabled ? [dr.get(r.domainFrom) ?? ""] : []),
      r.pageFromRank ?? "",
      r.rank ?? "",
      r.spamScore ?? "",
      r.firstSeen ?? "",
      r.lastSeen ?? "",
      r.isLost ? "true" : "false",
      r.isBroken ? "true" : "false",
      r.linksCount ?? "",
    ]),
  };
}

function Flags({ r }: { r: BacklinkRow }) {
  const flags: { label: string; cls: string }[] = [];
  if (r.isLost) flags.push({ label: "Lost", cls: "bg-destructive/10 text-destructive" });
  if (r.isBroken) flags.push({ label: "Broken", cls: "bg-warning/15 text-warning" });
  if (r.isDofollow === false) flags.push({ label: "Nofollow", cls: "bg-muted text-muted-foreground" });
  if ((r.linksCount ?? 0) > 1) flags.push({ label: `${r.linksCount} links`, cls: "bg-info/12 text-info" });
  if (!flags.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span key={f.label} className={`inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-medium ${f.cls}`}>
          {f.label}
        </span>
      ))}
    </div>
  );
}

function SourceCell({ r }: { r: BacklinkRow }) {
  return (
    <div className="min-w-0 max-w-[18rem]">
      <div className="truncate font-medium">{stripWww(r.domainFrom) || "—"}</div>
      {r.urlFrom && <ExternalUrl href={r.urlFrom} label={middleTruncate(r.urlFrom.replace(/^https?:\/\//, ""), 48)} className="text-xs text-muted-foreground" />}
    </div>
  );
}

function FirstSeenCell({ r }: { r: BacklinkRow }) {
  return (
    <div className="text-right text-xs whitespace-nowrap">
      <div className="tabular">{formatDfsDate(r.firstSeen)}</div>
      {r.lastSeen && <div className="text-muted-foreground tabular">Last {formatDfsDate(r.lastSeen)}</div>}
    </div>
  );
}

function backlinkColumns(dr: AhrefsDr): Column<BacklinkRow>[] {
  return [
    { id: "source", header: "Source", hint: "Page linking to you", cell: (r) => <SourceCell r={r} /> },
    {
      id: "target",
      header: "Target",
      hint: "Destination on your site",
      hideBelow: "lg",
      cell: (r) => (r.urlTo ? <ExternalUrl href={r.urlTo} label={truncate(r.urlTo.replace(/^https?:\/\//, ""), 40)} maxWidth="max-w-[16rem]" className="text-xs" /> : "—"),
    },
    {
      id: "anchor",
      header: "Anchor",
      hint: "Text or format of the link",
      hideBelow: "md",
      cell: (r) => (
        <div className="max-w-[14rem] min-w-0">
          <div className={r.anchor ? "truncate" : "truncate text-muted-foreground italic"}>{r.anchor || "No anchor text"}</div>
          {r.itemType && <div className="text-[11px] text-muted-foreground">{r.itemType}</div>}
        </div>
      ),
    },
    { id: "flags", header: "Flags", hideBelow: "md", cell: (r) => <Flags r={r} /> },
    { id: "rank", header: "Link", hint: "Authority of the linking page", sortable: true, align: "right", cell: (r) => int(r.rank) },
    { id: "domainRank", header: "DA", hint: "Authority of the linking domain", sortable: true, align: "right", cell: (r) => int(r.domainFromRank) },
    ...(dr.enabled
      ? [{ id: "ahrefsDr", header: "Ahrefs DR", hint: "Ahrefs Domain Rating (free public API)", align: "right" as const, cell: (r: BacklinkRow) => <DrCell dr={dr} domain={r.domainFrom} /> }]
      : []),
    { id: "spamScore", header: "Spam", sortable: true, align: "right", cell: (r) => (r.spamScore ? Math.round(r.spamScore) : "") },
    { id: "firstSeen", header: "First Seen", sortable: true, align: "right", cell: (r) => <FirstSeenCell r={r} /> },
  ];
}

const rowKey = (r: BacklinkRow) => `${r.urlFrom ?? ""}\u0000${r.urlTo ?? ""}\u0000${r.anchor ?? ""}`;

export function BacklinksTable({
  rows,
  dr,
  expandable,
  expansion,
  resetKey,
  ...sortProps
}: SortProps & {
  rows: BacklinkRow[];
  dr: AhrefsDr;
  /** One-per-domain view: rows expand into the domain's other links. */
  expandable: boolean;
  expansion: { projectId: string; target: string; scope: string; hideSpam: boolean };
  /** Collapses expansions when the target / scope changes. */
  resetKey: string;
}) {
  return (
    <DataTable
      key={resetKey}
      columns={backlinkColumns(dr)}
      data={rows}
      getRowId={rowKey}
      sort={{ id: sortProps.sort, dir: sortProps.order }}
      onSortChange={sortHandler(sortProps)}
      paginate={false}
      dense
      renderExpanded={expandable ? (r) => <DomainLinks parent={r} {...expansion} /> : undefined}
      empty={<EmptyState compact title="No backlinks found" description="Try another scope, or loosen the filters." />}
      mobileCard={(r) => (
        <div className="space-y-2">
          <SourceCell r={r} />
          <div className="text-xs">
            <span className="text-muted-foreground">Anchor: </span>
            {r.anchor || <span className="italic text-muted-foreground">No anchor text</span>}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span>
              <span className="text-muted-foreground">Link</span> <span className="tabular">{int(r.rank)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">DA</span> <span className="tabular">{int(r.domainFromRank)}</span>
            </span>
            {dr.enabled && (
              <span>
                <span className="text-muted-foreground">DR</span> <DrCell dr={dr} domain={r.domainFrom} />
              </span>
            )}
            <span className="text-muted-foreground">{formatDfsDate(r.firstSeen)}</span>
          </div>
          <Flags r={r} />
        </div>
      )}
    />
  );
}

/** Lazily loads the domain's other links (one billed request per expansion, cached). */
function DomainLinks({ parent, projectId, target, scope, hideSpam }: { parent: BacklinkRow; projectId: string; target: string; scope: string; hideSpam: boolean }) {
  const domain = parent.domainFrom ?? "";
  const input = {
    target,
    scope: scope as "exact_url" | "subfolder" | "domain" | "subdomains",
    page: 1,
    pageSize: 100 as const,
    sortField: "rank" as const,
    sortOrder: "desc" as const,
    filters: { domainFrom: domain },
    mode: "as_is" as const,
    hideSpam,
  };
  const q = useSeoQuery(domain ? `bl-expand:${projectId}:${JSON.stringify(input)}` : null, async () => unwrap(await getBacklinksRowsAction(projectId, input)));
  const parentKey = rowKey(parent);
  const children = (q.data?.rows ?? []).filter((r) => rowKey(r) !== parentKey);
  if (q.loading && !q.data) return <Status>Loading links…</Status>;
  if (q.error) return <Status>Couldn&apos;t load this domain&apos;s links.</Status>;
  if (!children.length) return <Status>No other links from this domain.</Status>;
  return (
    <div className="divide-y border-l-2 border-l-brand/40 bg-muted/30 pl-4">
      {children.map((r) => (
        <div key={rowKey(r)} className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-xs sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto_auto]">
          <div className="min-w-0">{r.urlFrom ? <ExternalUrl href={r.urlFrom} label={middleTruncate(r.urlFrom.replace(/^https?:\/\//, ""), 56)} /> : "—"}</div>
          <div className="hidden min-w-0 sm:block">{r.urlTo ? <ExternalUrl href={r.urlTo} label={truncate(r.urlTo.replace(/^https?:\/\//, ""), 40)} className="text-muted-foreground" /> : "—"}</div>
          <div className="min-w-0 truncate">{r.anchor || <span className="italic text-muted-foreground">No anchor text</span>}</div>
          <div className="hidden sm:block">
            <Flags r={r} />
          </div>
          <div className="text-right text-muted-foreground tabular">
            Link {int(r.rank)} · {formatDfsDate(r.firstSeen)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return <div className="border-l-2 border-l-brand/40 bg-muted/30 px-6 py-3 text-xs text-muted-foreground">{children}</div>;
}

/* ───────────────────────────── Referring domains ───────────────────────────── */

export function referringDomainsExport(rows: ReferringDomainRow[], dr: AhrefsDr | null): { headers: string[]; rows: Cell[][] } {
  return {
    headers: ["Domain", "Backlinks", "Referring Pages", "Rank", ...(dr?.enabled ? ["Ahrefs DR"] : []), "Spam Score", "First Seen", "Broken Backlinks", "Broken Pages"],
    rows: rows.map((r) => [
      r.domain ?? "",
      r.backlinks ?? "",
      r.referringPages ?? "",
      r.rank ?? "",
      ...(dr?.enabled ? [dr.get(r.domain) ?? ""] : []),
      r.spamScore ?? "",
      r.firstSeen ?? "",
      r.brokenBacklinks ?? "",
      r.brokenPages ?? "",
    ]),
  };
}

export function ReferringDomainsTable({ rows, dr, ...sortProps }: SortProps & { rows: ReferringDomainRow[]; dr: AhrefsDr }) {
  const columns: Column<ReferringDomainRow>[] = [
    { id: "domain", header: "Domain", sortable: true, cell: (r) => (r.domain ? <ExternalUrl href={`https://${r.domain}`} label={r.domain} className="font-medium" maxWidth="max-w-[16rem]" /> : "—") },
    { id: "backlinks", header: "Backlinks", sortable: true, align: "right", cell: (r) => int(r.backlinks) },
    { id: "referringPages", header: "Referring Pages", sortable: true, align: "right", hideBelow: "md", cell: (r) => int(r.referringPages) },
    { id: "rank", header: "Rank", sortable: true, align: "right", cell: (r) => int(r.rank) },
    ...(dr.enabled ? [{ id: "ahrefsDr", header: "Ahrefs DR", align: "right" as const, cell: (r: ReferringDomainRow) => <DrCell dr={dr} domain={r.domain} /> }] : []),
    { id: "spamScore", header: "Spam", sortable: true, align: "right", cell: (r) => dec1(r.spamScore) },
    { id: "firstSeen", header: "First Seen", sortable: true, align: "right", hideBelow: "md", cell: (r) => <span className="text-xs tabular whitespace-nowrap">{formatDfsDate(r.firstSeen)}</span> },
    {
      id: "brokenBacklinks",
      header: "Issues",
      sortable: true,
      hideBelow: "lg",
      cell: (r) => (
        <div className="text-xs whitespace-nowrap text-muted-foreground">
          <div>Broken links: {int(r.brokenBacklinks)}</div>
          <div>Broken pages: {int(r.brokenPages)}</div>
        </div>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.domain ?? ""}
      sort={{ id: sortProps.sort, dir: sortProps.order }}
      onSortChange={sortHandler(sortProps)}
      paginate={false}
      dense
      empty={<EmptyState compact title="No referring domains found" description="Try loosening the filters." />}
      mobileCard={(r) => (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            {r.domain ? <ExternalUrl href={`https://${r.domain}`} label={r.domain} className="font-medium" /> : "—"}
            <Badge variant="secondary" className="tabular">
              Rank {int(r.rank)}
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <MiniStat label="Backlinks" value={int(r.backlinks)} />
            <MiniStat label="Ref. pages" value={int(r.referringPages)} />
            <MiniStat label={dr.enabled ? "Ahrefs DR" : "Spam"} value={dr.enabled ? <DrCell dr={dr} domain={r.domain} /> : dec1(r.spamScore)} />
          </div>
        </div>
      )}
    />
  );
}

/* ───────────────────────────── Top pages ───────────────────────────── */

export function topPagesExport(rows: TopPageRow[]): { headers: string[]; rows: Cell[][] } {
  return {
    headers: ["Page", "Backlinks", "Referring Domains", "Rank", "Broken Backlinks"],
    rows: rows.map((r) => [r.page ?? "", r.backlinks ?? "", r.referringDomains ?? "", r.rank ?? "", r.brokenBacklinks ?? ""]),
  };
}

export function TopPagesTable({ rows, ...sortProps }: SortProps & { rows: TopPageRow[] }) {
  const columns: Column<TopPageRow>[] = [
    { id: "page", header: "Page", cell: (r) => (r.page ? <ExternalUrl href={r.page} label={r.page.replace(/^https?:\/\//, "")} maxWidth="max-w-[26rem]" /> : "—") },
    { id: "backlinks", header: "Backlinks", sortable: true, align: "right", cell: (r) => int(r.backlinks) },
    { id: "referringDomains", header: "Referring Domains", sortable: true, align: "right", cell: (r) => int(r.referringDomains) },
    { id: "rank", header: "Rank", sortable: true, align: "right", hideBelow: "md", cell: (r) => int(r.rank) },
    { id: "brokenBacklinks", header: "Broken Backlinks", sortable: true, align: "right", hideBelow: "md", cell: (r) => int(r.brokenBacklinks) },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.page ?? ""}
      sort={{ id: sortProps.sort, dir: sortProps.order }}
      onSortChange={sortHandler(sortProps)}
      paginate={false}
      dense
      empty={<EmptyState compact title="No pages found" description="Try loosening the filters." />}
      mobileCard={(r) => (
        <div className="space-y-2">
          {r.page ? <ExternalUrl href={r.page} label={r.page.replace(/^https?:\/\//, "")} className="text-sm font-medium" maxWidth="max-w-full" /> : "—"}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <MiniStat label="Backlinks" value={int(r.backlinks)} />
            <MiniStat label="Ref. domains" value={int(r.referringDomains)} />
            <MiniStat label="Rank" value={int(r.rank)} />
          </div>
        </div>
      )}
    />
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="truncate tabular">{value}</div>
    </div>
  );
}
