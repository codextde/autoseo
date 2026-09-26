"use client";

import { useMemo, useState } from "react";
import { Ban, CircleCheck, CircleDashed, CircleHelp, CircleMinus, TriangleAlert } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable, type Column } from "@/components/app/data-table";
import { FilterBar, SearchInput } from "@/components/app/filters";
import { cn } from "@/lib/utils";
import type { BotResult, HttpVerdict, RobotsAccess } from "@/server/crawlability/types";

const PURPOSE: Record<string, { label: string; cls: string }> = {
  search: { label: "AI search", cls: "bg-brand-soft text-brand" },
  user: { label: "User fetch", cls: "bg-info/12 text-info" },
  training: { label: "Training", cls: "bg-chart-4/15 text-chart-4" },
  seo: { label: "SEO tool", cls: "bg-muted text-muted-foreground" },
};

export function AccessPill({ status }: { status: RobotsAccess | BotResult["overall"] }) {
  const map = {
    allowed: { icon: CircleCheck, label: "Allowed", cls: "bg-success/12 text-success" },
    partial: { icon: CircleMinus, label: "Partial", cls: "bg-warning/15 text-warning" },
    blocked: { icon: Ban, label: "Blocked", cls: "bg-destructive/10 text-destructive" },
    unknown: { icon: CircleHelp, label: "Unknown", cls: "bg-muted text-muted-foreground" },
  } as const;
  const m = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", m.cls)}>
      <m.icon className="size-3" />
      {m.label}
    </span>
  );
}

function HttpPill({ verdict }: { verdict: HttpVerdict }) {
  const map: Record<HttpVerdict, { label: string; cls: string; icon: typeof CircleCheck }> = {
    ok: { label: "Same as browser", cls: "text-success", icon: CircleCheck },
    blocked: { label: "Blocked", cls: "text-destructive", icon: Ban },
    different: { label: "Different", cls: "text-warning", icon: TriangleAlert },
    error: { label: "Error", cls: "text-muted-foreground", icon: CircleHelp },
    inconclusive: { label: "Inconclusive", cls: "text-muted-foreground", icon: CircleHelp },
    not_tested: { label: "robots.txt only", cls: "text-muted-foreground", icon: CircleDashed },
  };
  const m = map[verdict];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", m.cls)}>
      <m.icon className="size-3.5" /> {m.label}
    </span>
  );
}

export function BotMatrix({ bots }: { bots: BotResult[] }) {
  const [purpose, setPurpose] = useState("all");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const data = useMemo(
    () =>
      bots.filter(
        (b) =>
          (purpose === "all" || (purpose === "ai" ? b.purpose !== "seo" && b.purpose !== "training" : b.purpose === purpose)) &&
          (status === "all" || b.overall === status) &&
          (!q || `${b.name} ${b.company} ${b.token}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [bots, purpose, status, q],
  );

  const columns: Column<BotResult>[] = [
    {
      id: "bot",
      header: "Crawler",
      sticky: true,
      cell: (b) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {b.name}
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", PURPOSE[b.purpose]?.cls)}>{PURPOSE[b.purpose]?.label}</span>
          </div>
          <div className="text-xs text-muted-foreground">{b.company}</div>
        </div>
      ),
      sortValue: (b) => b.name,
    },
    {
      id: "robots",
      header: "robots.txt",
      cell: (b) => (
        <div className="space-y-0.5">
          <AccessPill status={b.robots.status} />
          <div className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground" title={b.robots.rule ?? undefined}>
            {b.robots.status === "allowed"
              ? b.robots.disallowRules
                ? `${b.robots.disallowRules} excluded path${b.robots.disallowRules === 1 ? "" : "s"} · no content affected`
                : b.robots.source === "none"
                  ? "no matching group"
                  : "no restriction"
              : b.robots.rule
                ? `${b.robots.rule}${b.robots.ruleLine ? ` · L${b.robots.ruleLine}` : ""}${b.robots.status === "partial" ? ` · ${Math.round(b.robots.blockedShare * 100)}% of URLs` : ""}`
                : "blocked"}
            {b.robots.source === "specific" ? " · own group" : b.robots.source === "wildcard" ? " · via *" : ""}
          </div>
        </div>
      ),
      sortValue: (b) => b.robots.status,
    },
    {
      id: "http",
      header: "HTTP with bot UA",
      hint: "We request your pages with each crawler's user agent and compare the response to a regular browser.",
      cell: (b) => (
        <div className="space-y-0.5">
          <HttpPill verdict={b.http.verdict} />
          {b.http.pages.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {b.http.pages.map((p) => (
                <Tooltip key={p.url}>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        "cursor-help rounded px-1 font-mono text-[10px]",
                        p.verdict === "ok" ? "bg-success/12 text-success" : p.verdict === "blocked" ? "bg-destructive/10 text-destructive" : p.verdict === "different" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {p.status ?? "ERR"}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80">
                    <div className="font-mono text-[11px] break-all">{p.url}</div>
                    <div className="text-[11px]">
                      {p.reason ?? "Same response as a browser"}
                      {p.ttfbMs != null ? ` · ${p.ttfbMs} ms` : ""}
                      {p.words != null ? ` · ${p.words} words` : ""}
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
      ),
      sortValue: (b) => b.http.verdict,
    },
    {
      id: "meta",
      header: "Meta robots",
      hideBelow: "md",
      cell: (b) => (b.metaBlocked ? <span className="text-xs text-destructive">noindex</span> : <span className="text-xs text-success">OK</span>),
    },
    { id: "overall", header: "Access", align: "right", cell: (b) => <AccessPill status={b.overall} />, sortValue: (b) => ({ blocked: 0, partial: 1, unknown: 2, allowed: 3 })[b.overall] },
  ];

  return (
    <div className="space-y-3">
      <FilterBar
        activeCount={(purpose !== "all" ? 1 : 0) + (status !== "all" ? 1 : 0)}
        search={<SearchInput value={q} onChange={setQ} placeholder="Search crawlers…" />}
      >
        <Select value={purpose} onValueChange={setPurpose}>
          <SelectTrigger size="sm" className="h-8 min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All crawlers</SelectItem>
            <SelectItem value="ai">AI search & assistants</SelectItem>
            <SelectItem value="training">Training crawlers</SelectItem>
            <SelectItem value="seo">SEO tools</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="h-8 min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any access</SelectItem>
            <SelectItem value="allowed">Allowed</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>
      <DataTable
        columns={columns}
        data={data}
        getRowId={(b) => b.token}
        paginate={false}
        initialSort={{ id: "overall", dir: "asc" }}
        mobileCard={(b) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{b.name}</div>
                <div className="text-xs text-muted-foreground">
                  {b.company} · {PURPOSE[b.purpose]?.label}
                </div>
              </div>
              <AccessPill status={b.overall} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="flex items-center gap-1">
                robots <AccessPill status={b.robots.status} />
              </span>
              <HttpPill verdict={b.http.verdict} />
            </div>
            {b.robots.rule && <div className="truncate font-mono text-[11px] text-muted-foreground">{b.robots.rule}</div>}
          </div>
        )}
      />
    </div>
  );
}
