"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { RankedBars, TrendChart } from "@/components/app/charts";
import { KpiStrip, formatCurrency } from "@/components/app/metrics";
import { EngineIcon, EngineStack } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import { CountryFlag } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { getEngine } from "@/lib/engines";
import { cn } from "@/lib/utils";
import type { ProductDetail } from "@/server/ai/insights/products";
import { useClientParam } from "../../lib/client-url";
import { YouBadge } from "../brand";
import { openAnswer } from "../answer-sheet";
import { Price, ThumbTile } from "./product-bits";
import { PageCrumb } from "@/components/app/page-crumb";

type PromptRow = ProductDetail["prompts"][number];
const SOURCE_LABEL: Record<string, string> = { llm: "LLM mention", shopping: "Shopping card", both: "Both" };

export function ProductDetailView({ projectId, data, query, filters }: { projectId: string; data: ProductDetail; query: string; filters?: React.ReactNode }) {
  const [tab, setTab] = useClientParam("tab", "overview");
  const cur = (c: string | null) => (c && /^[A-Z]{3}$/.test(c) ? c : "USD");

  const promptColumns: Column<PromptRow>[] = [
    {
      id: "prompt",
      header: "Prompt",
      sortValue: (p) => p.text.toLowerCase(),
      cell: (p) => (
        <span className="flex min-w-56 items-start gap-1.5">
          <CountryFlag iso={p.country} className="mt-0.5" />
          <span className="line-clamp-2 text-sm">{p.text}</span>
        </span>
      ),
    },
    { id: "engines", header: "Engines", hideBelow: "md", cell: (p) => <EngineStack ids={p.engines} max={5} /> },
    { id: "n", header: "Appearances", align: "right", sortValue: (p) => p.n, cell: (p) => <span className="tabular">{p.n}</span> },
    { id: "pos", header: "Avg position", align: "right", hideBelow: "md", sortValue: (p) => p.avgPosition, cell: (p) => <span className="tabular">{p.avgPosition?.toFixed(1) ?? "—"}</span> },
    { id: "last", header: "Last seen", align: "right", hideBelow: "lg", sortValue: (p) => p.lastSeen, cell: (p) => <span className="text-xs text-muted-foreground tabular">{p.lastSeen}</span> },
    {
      id: "action",
      header: <span className="sr-only">Action</span>,
      align: "right",
      cell: (p) => (
        <Button variant="outline" size="sm" className="h-7" onClick={() => openAnswer(p.latestAnswerId)}>
          View answer
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex min-w-0 items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to products">
          <Link href={`/p/${projectId}/ai/products${query}`}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <ThumbTile src={data.imageUrl} name={data.name} className="size-12" />
        <div className="min-w-0">
          <PageCrumb label={data.name} />
          <h1 className="line-clamp-2 text-xl font-semibold tracking-tight sm:text-2xl">{data.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {data.brandName && (
              <span className="flex items-center gap-1.5">
                <Favicon domain={data.brandDomain} fallback={data.brandName} />
                {data.brandName}
              </span>
            )}
            {data.isOwn && <YouBadge />}
            {data.category && <Badge variant="outline">{data.category}</Badge>}
            {data.firstSeen && <span className="text-xs">First seen {data.firstSeen}</span>}
          </p>
        </div>
      </div>

      <div className="flex border-b">
        {[
          { k: "overview", label: "Overview" },
          { k: "prompts", label: `Prompts (${data.prompts.length})` },
        ].map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 text-sm",
              tab === t.k ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filters}

      {tab === "prompts" ? (
        <Panel title="Prompts where this product appears">
          <DataTable
            columns={promptColumns}
            data={data.prompts}
            getRowId={(p) => p.id}
            initialSort={{ id: "n", dir: "desc" }}
            pageSize={25}
            empty={<EmptyState compact title="Not surfaced in this period" />}
            mobileCard={(p) => (
              <button type="button" className="w-full space-y-1 text-left" onClick={() => openAnswer(p.latestAnswerId)}>
                <p className="text-sm">{p.text}</p>
                <span className="flex items-center justify-between text-xs text-muted-foreground">
                  <EngineStack ids={p.engines} />
                  <span className="tabular">{p.n}×</span>
                </span>
              </button>
            )}
          />
        </Panel>
      ) : (
        <>
          <KpiStrip
            items={[
              { key: "a", label: "Appearances", value: data.kpis.appearances.toLocaleString(), delta: data.kpis.appearancesDelta },
              { key: "e", label: "Engines", value: data.kpis.engines },
              { key: "l", label: "Last seen", value: data.lastSeen ?? "—" },
              { key: "p", label: "Avg position", value: data.kpis.avgPosition?.toFixed(1) ?? "—" },
              { key: "r", label: "Avg rating", value: data.kpis.rating == null ? "—" : `★ ${data.kpis.rating.toFixed(1)}`, sub: data.kpis.reviews ? `${data.kpis.reviews.toLocaleString()} reviews` : undefined },
            ]}
          />
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Panel title="Appearances over time">
              {data.kpis.appearances === 0 ? (
                <EmptyState compact title="Not surfaced in this period" />
              ) : (
                <TrendChart data={data.dates.map((d, i) => ({ date: d, n: data.daily[i] }))} series={[{ key: "n", label: "Appearances", color: "var(--chart-1)" }]} height={220} />
              )}
            </Panel>
            <Panel title="Models">
              <RankedBars
                items={data.engines.map((e) => ({ key: e.engine, label: getEngine(e.engine)?.name ?? e.engine, value: e.n, icon: <EngineIcon id={e.engine} size="xs" withTooltip={false} /> }))}
              />
              {data.sources.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5 border-t pt-3">
                  {data.sources.map((s) => (
                    <Badge key={s.source} variant="outline" className="font-normal">
                      {SOURCE_LABEL[s.source] ?? s.source} · {s.n}
                    </Badge>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Panel title="Prices by store">
              {data.stores.length === 0 ? (
                <EmptyState compact title="No store listings" description="This product was only named in answer text." />
              ) : (
                <ul className="divide-y">
                  {data.stores.map((s) => (
                    <li key={s.store} className="flex items-center gap-3 py-2.5">
                      <Favicon domain={s.domain} fallback={s.store} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{s.store}</span>
                        <span className="text-xs text-muted-foreground tabular">
                          {s.n} appearances
                          {s.min != null && s.max != null && s.min !== s.max && ` · ${formatCurrency(s.min, cur(s.currency))}–${formatCurrency(s.max, cur(s.currency))}`}
                        </span>
                      </span>
                      <Price price={s.price} oldPrice={s.oldPrice} currency={s.currency} />
                      {s.url && /^https?:\/\//i.test(s.url) && (
                        <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-muted-foreground hover:text-foreground" aria-label={`Open at ${s.store}`}>
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Attributes">
              {Object.keys(data.attributes).length === 0 ? (
                <p className="text-sm text-muted-foreground">No attributes captured.</p>
              ) : (
                <dl className="space-y-2 text-sm">
                  {Object.entries(data.attributes).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="text-right font-medium">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Panel>
          </div>

          <Panel title="Recent appearances" contentClassName="p-2 sm:p-3">
            {data.recent.length === 0 ? (
              <EmptyState compact title="No appearances in this period" />
            ) : (
              <ul className="space-y-0.5">
                {data.recent.map((r, i) => (
                  <li key={`${r.answerId}-${i}`}>
                    <button type="button" onClick={() => openAnswer(r.answerId)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted">
                      <EngineIcon id={r.engine} size="xs" withTooltip={false} />
                      <span className="w-20 shrink-0 text-xs text-muted-foreground tabular">{r.date}</span>
                      <span className="min-w-0 flex-1 truncate">{r.promptText}</span>
                      {r.store && <span className="hidden text-xs text-muted-foreground sm:inline">{r.store}</span>}
                      {r.price != null && <span className="text-xs tabular">{formatCurrency(r.price, cur(r.currency))}</span>}
                      {r.position != null && <span className="text-xs text-muted-foreground tabular">#{r.position}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
