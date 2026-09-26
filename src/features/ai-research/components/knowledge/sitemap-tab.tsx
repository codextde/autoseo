"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Bot, ChevronRight, ExternalLink, FileCode2, Star } from "lucide-react";
import { toast } from "sonner";
import { KpiStrip, formatNumber } from "@/components/app/metrics";
import { StackedBar } from "@/components/app/charts";
import { Panel } from "@/components/app/page";
import { StatusBadge } from "@/components/app/misc";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AnalysisShell } from "./analysis-shell";
import { setImportantSectionsAction } from "../../actions/knowledge";
import { PAGE_TYPE_LABELS, type KnowledgeState, type PageType, type SitemapData, type SitemapNode } from "../../types";

const TYPE_COLORS: Record<PageType, string> = {
  home: "var(--chart-8)",
  product: "var(--chart-2)",
  category: "var(--chart-7)",
  blog: "var(--chart-3)",
  help: "var(--chart-6)",
  legal: "var(--chart-5)",
  company: "var(--chart-4)",
  contact: "var(--chart-1)",
  landing: "oklch(0.7 0.1 180)",
  account: "oklch(0.6 0.02 250)",
  other: "oklch(0.8 0.01 95)",
};

function TypeBadge({ type }: { type: PageType }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full" style={{ background: TYPE_COLORS[type] }} />
      {PAGE_TYPE_LABELS[type]}
    </span>
  );
}

function TreeNode({
  node,
  depth,
  parentCount,
  important,
  onToggleImportant,
  canManage,
  defaultOpen,
}: {
  node: SitemapNode;
  depth: number;
  parentCount: number;
  important: Set<string>;
  onToggleImportant: (path: string) => void;
  canManage: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const hasKids = node.children.length > 0;
  const pct = parentCount ? (node.count / parentCount) * 100 : 100;
  const isImportant = important.has(node.path);
  return (
    <li>
      <div className={cn("group flex items-center gap-2 rounded-lg py-1.5 pr-2 hover:bg-muted/50", isImportant && "bg-brand-soft/40")} style={{ paddingLeft: depth * 16 + 4 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn("flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground", !hasKids && !node.samples.length && "invisible")}
          aria-label={open ? "Collapse" : "Expand"}
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <span className="block truncate font-mono text-xs">{depth === 0 ? node.name : node.path}</span>
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: TYPE_COLORS[node.type] }} />
          </span>
        </button>
        <span className="hidden sm:inline-flex">
          <TypeBadge type={node.type} />
        </span>
        <span className="w-14 text-right text-xs font-medium tabular">{formatNumber(node.count)}</span>
        {canManage && depth > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onToggleImportant(node.path)}
                className={cn("rounded p-1", isImportant ? "text-warning" : "text-muted-foreground/40 hover:text-muted-foreground")}
                aria-label={isImportant ? "Unmark important section" : "Mark as important section"}
              >
                <Star className={cn("size-3.5", isImportant && "fill-current")} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{isImportant ? "Important section" : "Mark as important"}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="w-[22px]" />
        )}
      </div>
      {open && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c.path} node={c} depth={depth + 1} parentCount={node.count} important={important} onToggleImportant={onToggleImportant} canManage={canManage} />
          ))}
          {node.more ? (
            <li className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: (depth + 1) * 16 + 32 }}>
              + {node.more} more sections
            </li>
          ) : null}
          {!hasKids &&
            node.samples.map((u) => (
              <li key={u} className="truncate py-0.5 text-xs" style={{ paddingLeft: (depth + 1) * 16 + 32 }}>
                <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 text-muted-foreground hover:text-foreground">
                  <span className="truncate">{u}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              </li>
            ))}
        </ul>
      )}
    </li>
  );
}

export function SitemapTab({ projectId, state, canManage, domain }: { projectId: string; state: KnowledgeState<SitemapData>; canManage: boolean; domain: string }) {
  const data = state.data;
  const [important, setImportant] = useState<Set<string>>(new Set(data?.important ?? []));
  const [, start] = useTransition();

  const toggleImportant = (path: string) => {
    const next = new Set(important);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setImportant(next);
    start(async () => {
      const res = await setImportantSectionsAction(projectId, [...next]);
      if (!res.ok) toast.error(res.error);
    });
  };

  const types = data ? (Object.entries(data.pageTypes) as [PageType, number][]).sort((a, b) => b[1] - a[1]) : [];
  const findNode = (path: string, n: SitemapNode | undefined): SitemapNode | null => {
    if (!n) return null;
    if (n.path === path) return n;
    for (const c of n.children) {
      const f = findNode(path, c);
      if (f) return f;
    }
    return null;
  };

  return (
    <AnalysisShell
      projectId={projectId}
      kind="sitemap"
      state={state}
      canManage={canManage}
      source="Your sitemap"
      hasData={!!data}
      estimate="Usually done within a few minutes for most sites (large sites take longer)."
      intro={
        <>
          <p className="text-base font-semibold text-foreground">Map the structure of {domain}</p>
          <p>We read robots.txt and every sitemap (incl. sitemap indexes), build a page tree with page types (products, categories, blog, help, legal…) and check which AI crawlers may access your site.</p>
        </>
      }
    >
      {data && (
        <div className="space-y-4">
          <KpiStrip
            items={[
              { key: "pages", label: "Pages in sitemaps", value: formatNumber(data.totalUrls), sub: data.truncated ? "capped" : undefined },
              { key: "sitemaps", label: "Sitemap files", value: formatNumber(data.sitemaps.filter((s) => !s.error).length) },
              { key: "sections", label: "Top-level sections", value: formatNumber(data.tree.children.length) },
              { key: "fresh", label: "Updated last 30 days", value: formatNumber(data.lastmod.updatedLast30d) },
            ]}
          />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Panel
              title="Page tree"
              description={`${data.origin} · star the sections that matter most — they are used as context for prompts and content.`}
              contentClassName="p-2 sm:p-3"
            >
              <ul className="max-h-[640px] overflow-y-auto">
                <TreeNode node={data.tree} depth={0} parentCount={data.tree.count} important={important} onToggleImportant={toggleImportant} canManage={canManage} defaultOpen />
              </ul>
            </Panel>
            <div className="space-y-4">
              <Panel title="Page types">
                <StackedBar parts={types.map(([t, n]) => ({ key: t, value: n, color: TYPE_COLORS[t], label: PAGE_TYPE_LABELS[t] }))} height={10} />
                <ul className="mt-3 space-y-1.5">
                  {types.map(([t, n]) => (
                    <li key={t} className="flex items-center gap-2 text-sm">
                      <span className="size-2 rounded-full" style={{ background: TYPE_COLORS[t] }} />
                      <span className="flex-1">{PAGE_TYPE_LABELS[t]}</span>
                      <span className="text-xs text-muted-foreground tabular">{formatNumber(n)}</span>
                      <span className="w-10 text-right text-xs text-muted-foreground tabular">{Math.round((n / Math.max(1, data.totalUrls)) * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title="Important sections" icon={<Star className="size-4 text-warning" />}>
                {important.size === 0 ? (
                  <p className="text-xs text-muted-foreground">No sections marked yet. Use the ☆ in the page tree.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {[...important].map((p) => {
                      const n = findNode(p, data.tree);
                      return (
                        <li key={p} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{p}</span>
                          {n && <TypeBadge type={n.type} />}
                          <span className="text-xs text-muted-foreground tabular">{n ? formatNumber(n.count) : "—"}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
              <Panel title="AI crawler access" icon={<Bot className="size-4 text-muted-foreground" />} description={data.robots.found ? "From robots.txt" : "No robots.txt found — everything is allowed"}>
                <div className="flex flex-wrap gap-1.5">
                  {data.robots.aiBots.map((b) => (
                    <Tooltip key={b.bot}>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-inset",
                            b.status === "allowed" ? "bg-success/8 text-success ring-success/20" : b.status === "blocked" ? "bg-destructive/8 text-destructive ring-destructive/20" : "bg-warning/10 text-warning ring-warning/25",
                          )}
                        >
                          {b.bot}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {b.company} · {b.status === "allowed" ? "allowed" : b.status === "blocked" ? "blocked in robots.txt" : "partially blocked"}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </Panel>
              {data.languages.length > 0 && (
                <Panel title="Language folders">
                  <div className="flex flex-wrap gap-1.5">
                    {data.languages.map((l) => (
                      <span key={l.code} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">
                        /{l.code} <span className="text-muted-foreground">{formatNumber(l.count)}</span>
                      </span>
                    ))}
                  </div>
                </Panel>
              )}
            </div>
          </div>
          <Panel title="Sitemap files" icon={<FileCode2 className="size-4 text-muted-foreground" />} description={data.lastmod.newest ? `Newest lastmod ${formatDistanceToNowStrict(new Date(data.lastmod.newest), { addSuffix: true })}` : undefined} contentClassName="p-0">
            <ul className="divide-y">
              {data.sitemaps.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No sitemap found (robots.txt lists none and /sitemap.xml does not exist).</li>}
              {data.sitemaps.map((s) => (
                <li key={s.url} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.url}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{s.kind === "index" ? "Index" : s.kind === "text" ? "Text" : "URL set"}</span>
                    <span className="text-xs tabular">{formatNumber(s.urls)} {s.kind === "index" ? "sitemaps" : "URLs"}</span>
                    {s.error ? <StatusBadge status="error" label={s.error} /> : <StatusBadge status="success" label="OK" />}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </AnalysisShell>
  );
}
