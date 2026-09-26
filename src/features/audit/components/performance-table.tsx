"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Gauge, Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportMenu, fetchCsvTable } from "@/components/app/export-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable, type Column } from "@/components/app/data-table";
import { FilterBar, SearchInput } from "@/components/app/filters";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";
import { formatMs, pathOf, ScorePill } from "./bits";

export type LighthouseRow = {
  id: string;
  url: string;
  strategy: "mobile" | "desktop";
  provider: string;
  status: string;
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
  ttfbMs: number | null;
  errorMessage: string | null;
  hasPayload: boolean;
};

export function PerformanceTable({ base, rows, predominantHost }: { base: string; rows: LighthouseRow[]; predominantHost: string | null }) {
  const [q, setQ] = useState("");
  const [device, setDevice] = useState("all");
  const [status, setStatus] = useState("all");
  const failed = (r: LighthouseRow) => r.status === "failed" || (!!r.errorMessage && r.status !== "done");
  const data = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!q || r.url.toLowerCase().includes(q.toLowerCase())) &&
          (device === "all" || r.strategy === device) &&
          (status === "all" || (status === "failed" ? failed(r) : !failed(r))),
      ),
    [rows, q, device, status],
  );

  const columns: Column<LighthouseRow>[] = [
    { id: "url", header: "URL", cell: (r) => <span className="block max-w-[280px] truncate font-mono text-xs" title={r.url}>{pathOf(r.url, predominantHost)}</span>, sortValue: (r) => r.url },
    {
      id: "device",
      header: "Device",
      cell: (r) => (
        <span className="inline-flex items-center gap-1 text-xs capitalize">
          {r.strategy === "mobile" ? <Smartphone className="size-3.5" /> : <Monitor className="size-3.5" />}
          {r.strategy}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) =>
        failed(r) ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">failed</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">{r.errorMessage ?? "Lighthouse returned no category scores"}</TooltipContent>
          </Tooltip>
        ) : r.status === "done" ? (
          <span className="rounded-md bg-success/12 px-1.5 py-0.5 text-xs text-success">ok</span>
        ) : (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{r.status}</span>
        ),
    },
    { id: "perf", header: "Perf", align: "right", cell: (r) => <ScorePill score={r.performanceScore} />, sortValue: (r) => r.performanceScore },
    { id: "a11y", header: "A11y", align: "right", hideBelow: "md", cell: (r) => <ScorePill score={r.accessibilityScore} />, sortValue: (r) => r.accessibilityScore },
    { id: "bp", header: "Best pr.", align: "right", hideBelow: "lg", cell: (r) => <ScorePill score={r.bestPracticesScore} />, sortValue: (r) => r.bestPracticesScore },
    { id: "seo", header: "SEO", align: "right", hideBelow: "md", cell: (r) => <ScorePill score={r.seoScore} />, sortValue: (r) => r.seoScore },
    {
      id: "lcp",
      header: "LCP",
      align: "right",
      hideBelow: "sm",
      cell: (r) => <span className={cn(r.lcpMs != null && r.lcpMs > 2500 && "text-warning", r.lcpMs != null && r.lcpMs > 4000 && "text-destructive")}>{r.lcpMs == null ? "—" : `${(r.lcpMs / 1000).toFixed(1)}s`}</span>,
      sortValue: (r) => r.lcpMs,
    },
    { id: "cls", header: "CLS", align: "right", hideBelow: "lg", cell: (r) => (r.cls == null ? "—" : r.cls.toFixed(3)), sortValue: (r) => r.cls },
    { id: "inp", header: "INP", align: "right", hideBelow: "xl", cell: (r) => formatMs(r.inpMs), sortValue: (r) => r.inpMs },
    { id: "ttfb", header: "TTFB", align: "right", hideBelow: "xl", cell: (r) => formatMs(r.ttfbMs), sortValue: (r) => r.ttfbMs },
    {
      id: "issues",
      header: "",
      align: "right",
      cell: (r) =>
        r.hasPayload && !failed(r) ? (
          <Button asChild variant="outline" size="sm" className="h-7">
            <Link href={`${base}/lighthouse/${r.id}?category=performance`}>View issues</Link>
          </Button>
        ) : null,
    },
  ];

  if (!rows.length) return <EmptyState icon={Gauge} title="No Lighthouse results" description="Enable “Include Lighthouse” when starting an audit to measure Core Web Vitals on sampled pages." />;

  return (
    <div className="space-y-3">
      <FilterBar
        activeCount={(device !== "all" ? 1 : 0) + (status !== "all" ? 1 : 0)}
        search={<SearchInput value={q} onChange={setQ} placeholder="Search URL…" />}
        right={
          <ExportMenu
            filename="audit-performance"
            title={`Site audit performance — ${new Date().toISOString().slice(0, 10)}`}
            csvHref={`${base}/export?kind=performance&format=csv`}
            getData={() => fetchCsvTable(`${base}/export?kind=performance&format=csv`)}
          />
        }
      >
        <Select value={device} onValueChange={setDevice}>
          <SelectTrigger size="sm" className="h-8 min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All devices</SelectItem>
            <SelectItem value="mobile">Mobile</SelectItem>
            <SelectItem value="desktop">Desktop</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="h-8 min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All results</SelectItem>
            <SelectItem value="ok">OK</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>
      <DataTable
        columns={columns}
        data={data}
        getRowId={(r) => r.id}
        initialSort={{ id: "perf", dir: "asc" }}
        dense
        mobileCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-xs">{pathOf(r.url, predominantHost)}</span>
              <span className="text-xs text-muted-foreground capitalize">{r.strategy}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <ScorePill score={r.performanceScore} /> <ScorePill score={r.accessibilityScore} /> <ScorePill score={r.bestPracticesScore} /> <ScorePill score={r.seoScore} />
              <span className="ml-auto tabular text-muted-foreground">{r.lcpMs == null ? "" : `LCP ${(r.lcpMs / 1000).toFixed(1)}s`}</span>
            </div>
            {r.hasPayload && !failed(r) && (
              <Link href={`${base}/lighthouse/${r.id}`} className="text-xs font-medium underline underline-offset-2">
                View issues
              </Link>
            )}
            {failed(r) && <p className="text-xs text-destructive">{r.errorMessage}</p>}
          </div>
        )}
      />
    </div>
  );
}
