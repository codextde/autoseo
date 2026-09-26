"use client";

import Link from "next/link";
import { ArrowLeft, Download, GitFork } from "lucide-react";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { FilterBar, PeriodSelect, SearchInput } from "@/components/app/filters";
import { EngineStack } from "@/components/app/engine-icon";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUrlPatch, useUrlState } from "@/hooks/use-url-state";
import type { FanoutRow } from "../types";

function day(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function FanoutsView({
  rows,
  period,
  from,
  to,
  backHref,
  trackerHref,
  exportHref,
}: {
  rows: FanoutRow[];
  period: string;
  from?: string;
  to?: string;
  backHref: string;
  trackerHref: string;
  exportHref: string;
}) {
  const [patch] = useUrlPatch();
  const [q, setQ] = useUrlState("q", "");
  const columns: Column<FanoutRow>[] = [
    {
      id: "query",
      header: "Fan-out query",
      cell: (r) => <span className="line-clamp-2 min-w-[200px] text-sm font-medium">{r.query}</span>,
      sortValue: (r) => r.query,
    },
    { id: "frequency", header: "Frequency", align: "right", cell: (r) => `${r.frequency}×`, sortValue: (r) => r.frequency },
    { id: "engines", header: "Models", cell: (r) => <EngineStack ids={r.engines} max={5} />, hideBelow: "sm" },
    {
      id: "prompts",
      header: "Prompts",
      align: "right",
      sortValue: (r) => r.prompts.length,
      cell: (r) => (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" className="tabular">
              {r.prompts.length} prompt{r.prompts.length === 1 ? "" : "s"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-2">
            <ul className="max-h-60 space-y-1 overflow-y-auto">
              {r.prompts.map((p) => (
                <li key={p.id}>
                  <Link href={`${trackerHref}?prompt=${p.id}`} className="line-clamp-2 rounded-md px-2 py-1 text-xs hover:bg-muted">
                    {p.text || p.id}
                  </Link>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ),
    },
    { id: "first", header: "First seen", cell: (r) => <span className="whitespace-nowrap text-xs text-muted-foreground">{day(r.firstSeen)}</span>, sortValue: (r) => r.firstSeen, hideBelow: "md" },
    { id: "last", header: "Last seen", cell: (r) => <span className="whitespace-nowrap text-xs">{day(r.lastSeen)}</span>, sortValue: (r) => r.lastSeen, hideBelow: "sm" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to tracker">
          <Link href={backHref}>
            <ArrowLeft />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Query Fanouts</h1>
          <p className="text-sm text-muted-foreground">The searches AI models ran behind the scenes while answering your tracked prompts.</p>
        </div>
      </div>
      <Panel contentClassName="space-y-3">
        <FilterBar
          search={<SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search fan-out queries…" />}
          right={
            <Button asChild size="sm" variant="outline">
              <a href={exportHref}>
                <Download /> <span className="hidden sm:inline">Download</span>
              </a>
            </Button>
          }
        >
          <PeriodSelect
            value={period}
            from={from}
            to={to}
            onChange={(p) => patch({ period: p === "90d" ? null : p, from: null, to: null })}
            onCustom={(r) => patch({ period: "custom", from: r.from, to: r.to })}
          />
        </FilterBar>
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(r) => r.query.toLowerCase()}
          initialSort={{ id: "frequency", dir: "desc" }}
          mobileCard={(r) => (
            <div className="space-y-1.5">
              <div className="text-sm font-medium">{r.query}</div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <EngineStack ids={r.engines} max={5} />
                <span className="tabular">
                  {r.frequency}× · {r.prompts.length} prompts · {day(r.lastSeen)}
                </span>
              </div>
            </div>
          )}
          empty={
            <EmptyState
              icon={GitFork}
              title={q ? "No fan-out queries match your search" : "No fan-out queries yet"}
              description={q ? "Try another search term." : "Once your tracked prompts are scored, the AI fan-out queries will appear here."}
              compact
            />
          }
        />
      </Panel>
    </div>
  );
}
