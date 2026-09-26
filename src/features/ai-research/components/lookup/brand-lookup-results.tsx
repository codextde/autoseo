"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Download, ExternalLink, Filter, Info, MessageSquareText, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { TrendChart } from "@/components/app/charts";
import { formatCompact, formatNumber } from "@/components/app/metrics";
import { Favicon } from "@/components/app/favicon";
import { EngineIcon } from "@/components/app/engine-icon";
import { EmptyState } from "@/components/app/empty-state";
import { TimeAgo } from "@/components/app/misc";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { downloadCsv, slugify } from "../../lib/csv";
import { LOOKUP_PLATFORM_LABELS, type BrandLookupParams, type BrandLookupResult, type LookupPlatform } from "../../types";

const PLATFORM_ENGINE: Record<LookupPlatform, string> = { chat_gpt: "chatgpt", google: "ai_overview" };

function PlatformLabel({ p }: { p: LookupPlatform }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <EngineIcon id={PLATFORM_ENGINE[p]} size="xs" withTooltip={false} />
      <span className="hidden sm:inline">{LOOKUP_PLATFORM_LABELS[p]}</span>
    </span>
  );
}

type Query = BrandLookupResult["topQueries"][number];
type Page = BrandLookupResult["topPages"][number];

export function BrandLookupResults({
  projectId,
  result,
  params,
  costUsd,
  createdAt,
}: {
  projectId: string;
  result: BrandLookupResult;
  params: BrandLookupParams;
  costUsd: number;
  createdAt: string;
}) {
  const [tab, setTab] = useUrlState("rt", "queries");
  const [showFilters, setShowFilters] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [platform, setPlatform] = useState<string>("all");
  const [minVol, setMinVol] = useState("");
  const platforms = [...new Set([...result.topQueries.map((q) => q.platform), ...result.topPages.map((p) => p.platform)])];
  const hb = result.target.type === "domain" ? result.target.value.split(".")[0] : result.target.value;

  const queries = useMemo(
    () =>
      result.topQueries.filter((q) => {
        const hay = `${q.question} ${q.brandsMentioned.join(" ")}`.toLowerCase();
        if (include && !hay.includes(include.toLowerCase())) return false;
        if (exclude && hay.includes(exclude.toLowerCase())) return false;
        if (platform !== "all" && q.platform !== platform) return false;
        if (minVol && (q.aiSearchVolume ?? 0) < Number(minVol)) return false;
        return true;
      }),
    [result.topQueries, include, exclude, platform, minVol],
  );
  const pages = useMemo(
    () =>
      result.topPages.filter((p) => {
        const hay = `${p.url} ${p.domain} ${p.prompts.join(" ")}`.toLowerCase();
        if (include && !hay.includes(include.toLowerCase())) return false;
        if (exclude && hay.includes(exclude.toLowerCase())) return false;
        if (platform !== "all" && p.platform !== platform) return false;
        if (minVol && (p.mentions ?? 0) < Number(minVol)) return false;
        return true;
      }),
    [result.topPages, include, exclude, platform, minVol],
  );

  if (!result.hasData) {
    const unavailable = result.perPlatform.filter((p) => p.status === "error");
    return (
      <Panel>
        <EmptyState
          icon={MessageSquareText}
          title={unavailable.length === result.perPlatform.length ? "AI mention data is temporarily unavailable" : `No AI mentions found for ${result.target.value}`}
          description={
            unavailable.length
              ? `Unavailable: ${unavailable.map((p) => LOOKUP_PLATFORM_LABELS[p.platform]).join(", ")}. Try again later.`
              : "DataForSEO has no ChatGPT / Google AI Overview answers mentioning this brand in the selected market yet. Try the domain instead of the brand name (or vice versa)."
          }
        />
      </Panel>
    );
  }

  const queryCols: Column<Query>[] = [
    {
      id: "q",
      header: "Query",
      cell: (q) => (
        <div className="min-w-0">
          <p className="text-sm leading-snug">{q.question}</p>
          {q.brandsMentioned.length > 0 && <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">Brands: {q.brandsMentioned.join(", ")}</p>}
        </div>
      ),
    },
    ...(platforms.length > 1 ? [{ id: "platform", header: "Platform", cell: (q: Query) => <PlatformLabel p={q.platform} /> } as Column<Query>] : []),
    { id: "vol", header: "AI search vol.", align: "right", cell: (q) => formatNumber(q.aiSearchVolume), sortValue: (q) => q.aiSearchVolume },
    {
      id: "action",
      header: "",
      align: "right",
      cell: (q) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon-sm">
              <Link href={`/p/${projectId}/ai/prompt-explorer?q=${encodeURIComponent(q.question.slice(0, 500))}&hb=${encodeURIComponent(hb)}`} aria-label="Run in Prompt Explorer">
                <Sparkles className="size-3.5" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Run this prompt in Prompt Explorer</TooltipContent>
        </Tooltip>
      ),
    },
  ];

  const pageCols: Column<Page>[] = [
    {
      id: "url",
      header: "Source",
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-2">
          <Favicon domain={p.domain} />
          <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 truncate text-sm hover:underline">
            {p.url.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
          {p.isTarget && <Badge className="h-[18px] shrink-0 bg-brand text-[10px] text-brand-foreground">You</Badge>}
        </div>
      ),
    },
    ...(platforms.length > 1 ? [{ id: "platform", header: "Platform", cell: (p: Page) => <PlatformLabel p={p.platform} /> } as Column<Page>] : []),
    {
      id: "for",
      header: "Cited for",
      hideBelow: "md",
      cell: (p) => (p.prompts.length ? <span className="line-clamp-2 text-xs text-muted-foreground">{p.prompts.slice(0, 3).join(" · ")}</span> : <span className="text-xs text-muted-foreground">—</span>),
    },
    { id: "mentions", header: "Mentions", align: "right", cell: (p) => formatNumber(p.mentions), sortValue: (p) => p.mentions },
    { id: "vol", header: "Source vol.", align: "right", cell: (p) => formatNumber(p.capturedVolume), sortValue: (p) => p.capturedVolume },
  ];

  const exportCsv = () => {
    const slug = slugify(result.target.value);
    if (tab === "pages")
      downloadCsv(
        `ai-brand-lookup-pages-${slug}.csv`,
        ["URL", "Domain", "Platform", "Source mentions", "Source AI search volume", "Fetched-sample prompt examples"],
        pages.map((p) => [p.url, p.domain, LOOKUP_PLATFORM_LABELS[p.platform], p.mentions ?? "", p.capturedVolume ?? "", p.prompts.join(" | ")]),
      );
    else
      downloadCsv(
        `ai-brand-lookup-queries-${slug}.csv`,
        ["Query", "Platform", "AI search volume", "First seen", "Last seen"],
        queries.map((q) => [q.question, LOOKUP_PLATFORM_LABELS[q.platform], q.aiSearchVolume ?? "", q.firstSeenAt ?? "", q.lastSeenAt ?? ""]),
      );
  };

  const sov = result.shareOfVoice;
  const maxShare = Math.max(1, ...(sov?.entries.map((e) => e.sharePct ?? 0) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold tracking-tight">{result.target.value}</h2>
            <Badge variant="outline" className="capitalize">
              {result.target.type}
            </Badge>
            {result.target.type === "domain" && <Badge variant="secondary">{params.scope === "subdomains" ? "incl. subdomains" : "domain only"}</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Updated <TimeAgo date={result.fetchedAt} /> · market {params.country} · cost ${costUsd.toFixed(3)} · requested {format(new Date(createdAt), "MMM d, HH:mm")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Mentions & AI search volume">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Mentions</p>
              <p className="text-3xl font-semibold tracking-tight tabular">{formatCompact(result.totalMentions)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">AI search volume</p>
              <p className="text-3xl font-semibold tracking-tight tabular">{formatCompact(result.totalAiSearchVolume)}</p>
            </div>
          </div>
          <ul className="mt-4 divide-y">
            {result.perPlatform.map((p) => (
              <li key={p.platform} className="flex items-center gap-2 py-2 text-sm">
                <EngineIcon id={PLATFORM_ENGINE[p.platform]} size="xs" />
                <span className="flex-1">{LOOKUP_PLATFORM_LABELS[p.platform]}</span>
                {p.locationNote && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="size-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-60">{p.locationNote} Not included in the totals.</TooltipContent>
                  </Tooltip>
                )}
                {p.status === "error" ? (
                  <span className="text-xs text-muted-foreground">unavailable</span>
                ) : (
                  <>
                    <span className="w-20 text-right tabular">{formatNumber(p.mentions)}</span>
                    <span className="w-24 text-right text-muted-foreground tabular">{formatCompact(p.aiSearchVolume)} vol.</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Mention trend" description="AI search volume of prompts mentioning the target (last 12 months)">
          {result.monthlyVolume.length > 1 ? (
            <TrendChart
              data={result.monthlyVolume.map((m) => ({ date: `${m.month}-01`, volume: m.volume }))}
              series={[{ key: "volume", label: "AI search volume", color: "var(--chart-3)" }]}
              type="line"
              format="compact"
              height={200}
              xFormatter={(v) => format(new Date(v), "MMM yy")}
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Not enough monthly data.</p>
          )}
        </Panel>
      </div>

      {sov && (
        <Panel
          title="Share of Voice"
          description={`Mentions summed across ${sov.platforms.map((p) => LOOKUP_PLATFORM_LABELS[p]).join(" + ")}`}
          actions={
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="size-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">Share of Voice compares whole domains / brand names — it is not narrowed to a page or folder.</TooltipContent>
            </Tooltip>
          }
        >
          <ol className="space-y-2">
            {sov.entries.map((e, i) => (
              <li key={e.key} className="flex items-center gap-3 text-sm">
                <span className="w-4 text-xs text-muted-foreground tabular">{i + 1}</span>
                <span className="flex w-40 min-w-0 items-center gap-1.5 sm:w-56">
                  <Favicon domain={e.key.includes(".") ? e.key : null} fallback={e.label} />
                  <span className="truncate font-medium">{e.label}</span>
                  {e.isTarget && <Badge className="h-[18px] bg-brand text-[10px] text-brand-foreground">You</Badge>}
                </span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className={cn("absolute inset-y-0 left-0 rounded-full", e.isTarget ? "bg-brand" : "bg-chart-3/70")} style={{ width: `${((e.sharePct ?? 0) / maxShare) * 100}%` }} />
                </span>
                <span className="w-16 text-right text-xs text-muted-foreground tabular">{formatNumber(e.mentions)}</span>
                <span className="w-12 text-right font-medium tabular">{e.sharePct != null ? `${Math.round(e.sharePct)}%` : "—"}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel contentClassName="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-muted p-0.5">
            {[
              { key: "queries", label: `Queries (${result.topQueries.length})` },
              { key: "pages", label: `Cited sources (${result.topPages.length})` },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn("rounded-md px-2.5 py-1 text-xs font-medium", tab === t.key ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowFilters((v) => !v)} className={cn(showFilters && "bg-muted")}>
            <Filter className="size-3.5" /> Filters
          </Button>
          <Button variant="outline" size="sm" className="ml-auto" onClick={exportCsv}>
            <Download className="size-3.5" /> CSV
          </Button>
        </div>
        {showFilters && (
          <div className="grid gap-2 rounded-xl bg-muted/50 p-3 sm:grid-cols-4">
            <Input value={include} onChange={(e) => setInclude(e.target.value)} placeholder="Include term" className="h-8 text-xs" />
            <Input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="Exclude term" className="h-8 text-xs" />
            <NativeSelect size="sm" value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full">
              <NativeSelectOption value="all">All platforms</NativeSelectOption>
              {platforms.map((p) => (
                <NativeSelectOption key={p} value={p}>
                  {LOOKUP_PLATFORM_LABELS[p]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input value={minVol} onChange={(e) => setMinVol(e.target.value.replace(/\D/g, ""))} placeholder={tab === "pages" ? "Min mentions" : "Min volume"} className="h-8 text-xs" inputMode="numeric" />
          </div>
        )}
        {tab === "pages" ? (
          <DataTable
            columns={pageCols}
            data={pages}
            getRowId={(p) => `${p.platform}:${p.url}`}
            initialSort={{ id: "vol", dir: "desc" }}
            pageSize={25}
            mobileCard={(p) => (
              <div className="space-y-1">
                <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1.5 text-sm font-medium">
                  <Favicon domain={p.domain} />
                  <span className="truncate">{p.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <PlatformLabel p={p.platform} />
                  <span>{formatNumber(p.mentions)} mentions</span>
                  <span>{formatCompact(p.capturedVolume)} vol.</span>
                </div>
              </div>
            )}
            empty={<div className="py-10 text-center text-sm text-muted-foreground">No cited sources.</div>}
          />
        ) : (
          <DataTable
            columns={queryCols}
            data={queries}
            getRowId={(q) => `${q.platform}:${q.question}`}
            initialSort={{ id: "vol", dir: "desc" }}
            pageSize={25}
            mobileCard={(q) => (
              <div className="space-y-1.5">
                <p className="text-sm">{q.question}</p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <PlatformLabel p={q.platform} />
                  <span className="tabular">{formatNumber(q.aiSearchVolume)} vol.</span>
                  <Link href={`/p/${projectId}/ai/prompt-explorer?q=${encodeURIComponent(q.question.slice(0, 500))}&hb=${encodeURIComponent(hb)}`} className="inline-flex items-center gap-1 font-medium text-foreground">
                    <Sparkles className="size-3" /> Explore
                  </Link>
                </div>
              </div>
            )}
            empty={<div className="py-10 text-center text-sm text-muted-foreground">No queries.</div>}
          />
        )}
      </Panel>
    </div>
  );
}
