"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { RankedBars, Sparkline } from "@/components/app/charts";
import { SearchInput } from "@/components/app/filters";
import { Delta, KpiStrip } from "@/components/app/metrics";
import { EngineIcon, EngineStack } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import { EmptyState } from "@/components/app/empty-state";
import { getEngine } from "@/lib/engines";
import type { AdDetail, AdRow, AdsOverview } from "@/server/ai/insights/ads";
import { getAdDetailAction } from "../../actions";
import { useClientParam } from "../../lib/client-url";
import { YouBadge } from "../brand";
import { openAnswer } from "../answer-sheet";
import { Rating, ThumbTile } from "../products/product-bits";

type AdvRow = AdsOverview["advertisers"][number];

function displayUrl(u: string | null) {
  if (!u) return null;
  try {
    const url = new URL(u);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return null;
  }
}

export function AdsView({ projectId, data }: { projectId: string; data: AdsOverview }) {
  const [adId, setAdId] = useClientParam("ad", "");
  const [q, setQ] = useClientParam("q", "");
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? data.ads.filter((a) => `${a.headline} ${a.description ?? ""} ${a.advertiser}`.toLowerCase().includes(n)) : data.ads;
  }, [data.ads, q]);

  if (data.totals.appearances === 0)
    return (
      <>
        <Panel>
          <EmptyState
            icon={Megaphone}
            title="No ads in AI answers yet"
            description="Sponsored placements are captured when an engine renders paid ads next to or inside its answer (e.g. Google AI Overviews / AI Mode, ChatGPT and Perplexity sponsored results via DataForSEO). They appear after the next tracking run that returns ads."
          />
        </Panel>
        <AdSheet projectId={projectId} adId={adId} onClose={() => setAdId(null)} />
      </>
    );

  const top = data.ads.slice(0, 6);
  const advColumns: Column<AdvRow>[] = [
    { id: "rank", header: "#", width: "36px", cell: (_r, i) => <span className="text-xs text-muted-foreground tabular">{i + 1}</span> },
    {
      id: "adv",
      header: "Advertiser",
      cell: (a) => (
        <span className="flex min-w-32 items-center gap-2">
          <Favicon domain={a.domain} fallback={a.name} className="size-5 rounded-md" />
          <span className="truncate font-medium">{a.name}</span>
          {a.isOwn && <YouBadge />}
          {!a.isOwn && a.tracked && (
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
              Competitor
            </Badge>
          )}
        </span>
      ),
    },
    { id: "ads", header: "Ads", align: "right", sortValue: (a) => a.ads, cell: (a) => <span className="tabular">{a.ads}</span> },
    {
      id: "appearances",
      header: "Appearances",
      align: "right",
      sortValue: (a) => a.appearances,
      cell: (a) => (
        <span className="inline-flex flex-col items-end leading-tight">
          <span className="font-medium tabular">{a.appearances.toLocaleString()}</span>
          <Delta value={a.appearancesDelta} digits={0} showZero={false} />
        </span>
      ),
    },
    {
      id: "share",
      header: "Share",
      align: "right",
      sortValue: (a) => a.share,
      cell: (a) => (
        <span className="inline-flex flex-col items-end leading-tight">
          <span className="font-medium tabular">{a.share.toFixed(1)}%</span>
          <Delta value={a.shareDelta} suffix="pp" showZero={false} />
        </span>
      ),
    },
  ];

  const columns: Column<AdRow>[] = [
    {
      id: "ad",
      header: "Ad",
      sticky: true,
      cell: (a) => (
        <button type="button" onClick={() => setAdId(a.id)} className="flex max-w-md min-w-60 items-start gap-2.5 text-left">
          <ThumbTile src={a.imageUrl} name={a.advertiser} />
          <span className="min-w-0">
            <span className="line-clamp-1 text-sm font-medium hover:underline">{a.headline}</span>
            {a.description && <span className="line-clamp-2 text-xs text-muted-foreground">{a.description}</span>}
          </span>
        </button>
      ),
    },
    {
      id: "adv",
      header: "Advertiser",
      hideBelow: "md",
      sortValue: (a) => a.advertiser.toLowerCase(),
      cell: (a) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <Favicon domain={a.advertiserDomain} fallback={a.advertiser} />
          {a.advertiser}
          {a.isOwn && <YouBadge />}
        </span>
      ),
    },
    { id: "rank", header: "Rank", align: "right", sortValue: (a) => a.avgPosition, cell: (a) => <span className="tabular">{a.avgPosition == null ? "—" : `#${a.avgPosition.toFixed(1)}`}</span> },
    { id: "rating", header: "Rating", align: "right", hideBelow: "lg", sortValue: (a) => a.rating, cell: (a) => <Rating rating={a.rating} /> },
    { id: "engines", header: "Engines", hideBelow: "lg", cell: (a) => <EngineStack ids={a.engines} max={4} /> },
    { id: "appearances", header: "Appearances", align: "right", sortValue: (a) => a.appearances, cell: (a) => <span className="font-medium tabular">{a.appearances}×</span> },
    {
      id: "action",
      header: <span className="sr-only">Action</span>,
      align: "right",
      cell: (a) => (
        <span className="flex items-center justify-end gap-1">
          <Button variant="outline" size="sm" className="h-7" onClick={() => setAdId(a.id)}>
            View Ad
          </Button>
          {a.landingUrl && (
            <Button asChild variant="ghost" size="icon-sm" aria-label="Open landing page">
              <a href={a.landingUrl} target="_blank" rel="noopener noreferrer nofollow">
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <KpiStrip
        items={[
          { key: "ap", label: "Ad appearances", value: data.totals.appearances.toLocaleString() },
          { key: "ads", label: "Distinct ads", value: data.totals.ads },
          { key: "adv", label: "Advertisers", value: data.advertisers.length },
          {
            key: "rate",
            label: "Answers with ads",
            value: data.totals.answers ? `${((data.totals.answersWithAds / data.totals.answers) * 100).toFixed(1)}%` : "—",
            sub: `${data.totals.answersWithAds.toLocaleString()} of ${data.totals.answers.toLocaleString()}`,
          },
        ]}
      />
      <div className="grid gap-4 sm:gap-5 xl:grid-cols-2">
        <Panel title="Top ads" description="Ad creatives surfaced most across AI answers" contentClassName="p-2 sm:p-3">
          <RankedBars
            items={top.map((a) => ({
              key: a.id,
              label: a.headline,
              sub: a.advertiser,
              value: a.appearances,
              icon: <Favicon domain={a.advertiserDomain} fallback={a.advertiser} />,
              right: `${a.appearances}×`,
            }))}
            onSelect={(id) => setAdId(id)}
          />
        </Panel>
        <Panel title="Top advertisers">
          <DataTable
            columns={advColumns}
            data={data.advertisers.slice(0, 10)}
            getRowId={(a) => a.key}
            paginate={false}
            dense
            rowClassName={(a) => (a.isOwn ? "bg-brand-soft/30" : undefined)}
            mobileCard={(a) => (
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Favicon domain={a.domain} fallback={a.name} />
                  <span className="truncate font-medium">{a.name}</span>
                  {a.isOwn && <YouBadge />}
                </span>
                <span className="text-xs text-muted-foreground tabular">
                  {a.ads} ads · {a.appearances}× · {a.share.toFixed(0)}%
                </span>
              </div>
            )}
          />
        </Panel>
      </div>
      <Panel title="Ads" description="Paid ads surfaced in AI answers">
        <SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search ads or advertisers…" className="mb-3 sm:max-w-72" />
        <DataTable
          columns={columns}
          data={filtered}
          getRowId={(a) => a.id}
          initialSort={{ id: "appearances", dir: "desc" }}
          pageSize={25}
          rowClassName={(a) => (a.isOwn ? "bg-brand-soft/20" : undefined)}
          empty={<EmptyState compact title="No ads match" />}
          mobileCard={(a) => (
            <button type="button" onClick={() => setAdId(a.id)} className="flex w-full items-start gap-3 text-left">
              <ThumbTile src={a.imageUrl} name={a.advertiser} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 text-sm font-medium">{a.headline}</span>
                <span className="block text-xs text-muted-foreground">
                  {a.advertiser} · {a.appearances}× · {a.avgPosition == null ? "—" : `#${a.avgPosition.toFixed(1)}`}
                </span>
              </span>
            </button>
          )}
        />
      </Panel>
      <AdSheet projectId={projectId} adId={adId} onClose={() => setAdId(null)} />
    </div>
  );
}

function AdSheet({ projectId, adId, onClose }: { projectId: string; adId: string; onClose: () => void }) {
  const params = useSearchParams();
  const filterKey = ["period", "from", "to", "models", "tags"].map((k) => params.get(k) ?? "").join("|");
  const key = `${adId}|${filterKey}`;
  const [result, setResult] = useState<{ key: string; data: AdDetail | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!adId || result?.key === key) return;
    let cancelled = false;
    const [period, from, to, models, tags] = filterKey.split("|");
    getAdDetailAction(projectId, adId, {
      period: period || undefined,
      from: from || undefined,
      to: to || undefined,
      models: models || undefined,
      tags: tags || undefined,
    }).then((r) => {
      if (cancelled) return;
      setResult({ key, data: r.ok ? r.data : null, error: r.ok ? null : r.error });
    });
    return () => {
      cancelled = true;
    };
  }, [adId, filterKey, key, result?.key, projectId]);

  const current = result?.key === key ? result : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;

  return (
    <Sheet open={!!adId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b p-4 pr-12 sm:p-5">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Megaphone className="size-4" /> Ad details
          </SheetTitle>
          <SheetDescription className="text-left">{data ? `${data.advertiser} · first seen ${data.firstSeen ?? "—"}` : "Loading…"}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 p-4 sm:p-5">
          {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          {!data && !error && (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {data && (
            <>
              <div className="rounded-xl border bg-background p-4 shadow-xs">
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <span className="font-semibold tracking-wide text-muted-foreground uppercase">Sponsored</span>
                  <span className="text-muted-foreground">·</span>
                  <Favicon domain={data.advertiserDomain} fallback={data.advertiser} />
                  <span className="font-medium">{data.advertiser}</span>
                  {data.isOwn && <YouBadge />}
                </div>
                <div className="flex gap-3">
                  {data.imageUrl && <ThumbTile src={data.imageUrl} name={data.advertiser} className="size-16" />}
                  <div className="min-w-0">
                    <p className="text-base font-medium text-info">{data.headline}</p>
                    {displayUrl(data.landingUrl) && <p className="truncate text-xs text-success">{displayUrl(data.landingUrl)}</p>}
                    {data.description && <p className="mt-1 text-sm text-muted-foreground">{data.description}</p>}
                  </div>
                </div>
                {data.landingUrl && (
                  <Button asChild variant="outline" size="sm" className="mt-3">
                    <a href={data.landingUrl} target="_blank" rel="noopener noreferrer nofollow">
                      Open landing page <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { l: "Appearances", v: data.kpis.appearances.toLocaleString() },
                  { l: "Engines", v: data.kpis.engines },
                  { l: "Avg position", v: data.kpis.avgPosition == null ? "—" : `#${data.kpis.avgPosition.toFixed(1)}` },
                  { l: "Last seen", v: data.lastSeen ?? "—" },
                ].map((k) => (
                  <div key={k.l} className="rounded-lg bg-muted/60 px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">{k.l}</div>
                    <div className="font-semibold tabular">{k.v}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Appearances over time</div>
                <Sparkline values={data.daily} height={48} color="var(--chart-1)" />
              </div>
              {data.engines.length > 0 && (
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Models</div>
                  <RankedBars
                    items={data.engines.map((e) => ({ key: e.engine, label: getEngine(e.engine)?.name ?? e.engine, value: e.n, icon: <EngineIcon id={e.engine} size="xs" withTooltip={false} /> }))}
                  />
                </div>
              )}
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Recent appearances</div>
                {data.recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No appearances in this period.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {data.recent.map((r, i) => (
                      <li key={`${r.answerId}-${i}`}>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            setTimeout(() => openAnswer(r.answerId), 0);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                        >
                          <EngineIcon id={r.engine} size="xs" withTooltip={false} />
                          <span className="w-20 shrink-0 text-xs text-muted-foreground tabular">{r.date}</span>
                          <span className="min-w-0 flex-1 truncate">{r.promptText}</span>
                          {r.position != null && <span className="text-xs text-muted-foreground tabular">#{r.position}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
