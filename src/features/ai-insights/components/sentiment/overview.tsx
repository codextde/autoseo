"use client";

import Link from "next/link";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { StackedBar } from "@/components/app/charts";
import { Delta } from "@/components/app/metrics";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";
import type { SentimentOverview } from "@/server/ai/insights/sentiment";
import { sentimentLabel } from "../../lib/metrics";
import { useTabHref } from "../../lib/client-url";
import type { BrandDTO } from "../../types";
import { BrandLabel, SentimentPill } from "../brand";
import { openAnswer } from "../answer-sheet";

const POL = {
  praise: { label: "Praise", color: "var(--success)" },
  neutral: { label: "Neutral", color: "oklch(0.72 0.01 95)" },
  criticism: { label: "Criticism", color: "var(--destructive)" },
} as const;

type TableRow = SentimentOverview["table"][number] & { brand: BrandDTO; rank: number };

export function SentimentOverviewView({
  data,
  own,
  compare,
  brands,
}: {
  data: SentimentOverview;
  own: BrandDTO;
  compare: BrandDTO | null;
  brands: BrandDTO[];
}) {
  const hrefFor = useTabHref(["brand", "aspects", "q"]);
  const byKey = new Map(brands.map((b) => [b.key, b]));
  const k = data.kpis;
  const hasStatements = k.you.statements > 0 || (k.compare?.statements ?? 0) > 0;
  const tableRows: TableRow[] = data.table.filter((r) => byKey.has(r.key)).map((r, i) => ({ ...r, brand: byKey.get(r.key)!, rank: i + 1 }));

  const columns: Column<TableRow>[] = [
    { id: "rank", header: "#", width: "40px", cell: (r) => <span className="text-xs text-muted-foreground tabular">{r.rank}</span> },
    {
      id: "brand",
      header: "Brand",
      sortValue: (r) => r.brand.name.toLowerCase(),
      cell: (r) => <BrandLabel name={r.brand.name} domain={r.brand.domain} isOwn={r.brand.isOwn} className="min-w-36" />,
    },
    {
      id: "score",
      header: "Sentiment",
      align: "right",
      sortValue: (r) => r.score,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <SentimentPill score={r.score} />
          <Delta value={r.scoreDelta} digits={0} showZero={false} />
        </span>
      ),
    },
    {
      id: "win",
      header: "Win rate",
      align: "right",
      hint: "Share of head-to-head comparisons (judged from answers) the brand won.",
      sortValue: (r) => r.winRate,
      cell: (r) => (r.winRate == null ? <span className="text-muted-foreground">—</span> : <span className="tabular" title={`${r.claims} decided claims`}>{r.winRate.toFixed(0)}%</span>),
    },
    {
      id: "mix",
      header: "Sentiment mix",
      hideBelow: "md",
      cell: (r) => (
        <StackedBar
          className="w-32"
          parts={[
            { key: "p", value: r.praise, color: POL.praise.color, label: "Praise" },
            { key: "n", value: r.neutral, color: POL.neutral.color, label: "Neutral" },
            { key: "c", value: r.criticism, color: POL.criticism.color, label: "Criticism" },
          ]}
        />
      ),
    },
    {
      id: "praises",
      header: "AI praises",
      hideBelow: "lg",
      cell: (r) => (
        <div className="flex max-w-64 flex-wrap gap-1">
          {r.praises.length ? r.praises.map((p) => <Badge key={p} variant="outline" className="border-success/30 text-[11px] font-normal">{p}</Badge>) : <span className="text-muted-foreground">—</span>}
        </div>
      ),
    },
    {
      id: "crit",
      header: "Top criticism",
      hideBelow: "lg",
      cell: (r) =>
        r.topCriticism ? (
          <Badge variant="outline" className="border-destructive/30 text-[11px] font-normal">
            {r.topCriticism.attribute} <span className="text-muted-foreground">×{r.topCriticism.count}</span>
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "leads",
      header: "Leads on",
      hideBelow: "xl",
      cell: (r) => (
        <div className="flex max-w-56 flex-wrap gap-1">
          {r.leadsOn.length ? r.leadsOn.slice(0, 3).map((a) => <Badge key={a} className="bg-foreground text-[11px] font-normal text-background">#1 {a}</Badge>) : <span className="text-muted-foreground">—</span>}
        </div>
      ),
    },
    {
      id: "action",
      header: <span className="sr-only">Action</span>,
      align: "right",
      cell: (r) => (
        <Button asChild variant="outline" size="sm" className="h-7">
          <Link href={hrefFor("praise", { brand: r.brand.isOwn ? "own" : r.brand.key })}>View Sentiment</Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Panel title="Sentiment" description={`${k.you.statements.toLocaleString()} statements about ${own.name}`}>
          <div className="flex items-end gap-2">
            <span className="text-4xl font-semibold tracking-tight tabular">{k.you.score == null ? "—" : Math.round(k.you.score)}</span>
            <span className="pb-1 text-sm text-muted-foreground">/100</span>
            <Delta value={k.you.scoreDelta} digits={0} className="pb-1.5" showZero={false} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{sentimentLabel(k.you.score).label}</div>
          <div className="mt-4 space-y-2.5">
            {(["praise", "neutral", "criticism"] as const).map((p) => (
              <div key={p}>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: POL[p].color }} />
                    {POL[p].label}
                  </span>
                  <span className="font-medium tabular">
                    {k.you[p].toFixed(1)}%
                    {k.compare && <span className="ml-2 text-xs font-normal text-muted-foreground">{compare?.name} {k.compare[p].toFixed(1)}%</span>}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${k.you[p]}%`, background: POL[p].color }} />
                </div>
              </div>
            ))}
          </div>
          {k.compare && (
            <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-xs">
              <span>{compare?.name} sentiment</span>
              <SentimentPill score={k.compare.score} />
            </div>
          )}
        </Panel>

        <Panel
          title="Sentiment over time"
          description={compare ? `Solid = ${own.name}, light = ${compare.name}` : `Daily share of praise, neutral and critical statements`}
          actions={
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {(["praise", "neutral", "criticism"] as const).map((p) => (
                <span key={p} className="flex items-center gap-1">
                  <span className="size-2 rounded-sm" style={{ background: POL[p].color }} />
                  {POL[p].label}
                </span>
              ))}
            </div>
          }
        >
          {hasStatements ? <DailyStack data={data.daily} compare={!!compare} ownName={own.name} compareName={compare?.name ?? ""} /> : <EmptyState compact title="No statements yet" description="Aspect sentiment is extracted from new answers going forward." />}
        </Panel>
      </div>

      <div className="grid gap-4 sm:gap-5 md:grid-cols-2">
        <AspectCard title={`What AI praises about ${own.name}`} tone="praise" items={data.praises} href={hrefFor("praise")} />
        <AspectCard title={`What AI criticises about ${own.name}`} tone="criticism" items={data.criticisms} href={hrefFor("criticism")} />
      </div>

      <Panel title="Brand sentiment" description="How AI talks about every tracked brand">
        <DataTable
          columns={columns}
          data={tableRows}
          getRowId={(r) => r.key}
          paginate={false}
          rowClassName={(r) => (r.brand.isOwn ? "bg-brand-soft/30" : undefined)}
          empty={<EmptyState compact title="No sentiment data yet" description="Sentiment appears once answers have been analysed." />}
          mobileCard={(r) => (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <BrandLabel name={r.brand.name} domain={r.brand.domain} isOwn={r.brand.isOwn} />
                <SentimentPill score={r.score} />
              </div>
              <StackedBar
                parts={[
                  { key: "p", value: r.praise, color: POL.praise.color },
                  { key: "n", value: r.neutral, color: POL.neutral.color },
                  { key: "c", value: r.criticism, color: POL.criticism.color },
                ]}
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Win rate {r.winRate == null ? "—" : `${r.winRate.toFixed(0)}%`}</span>
                <Link className="font-medium text-foreground underline-offset-2 hover:underline" href={hrefFor("praise", { brand: r.brand.isOwn ? "own" : r.brand.key })}>
                  View Sentiment
                </Link>
              </div>
            </div>
          )}
        />
      </Panel>
    </div>
  );
}

function AspectCard({
  title,
  tone,
  items,
  href,
}: {
  title: string;
  tone: "praise" | "criticism";
  items: SentimentOverview["praises"];
  href: string;
}) {
  const Icon = tone === "praise" ? ThumbsUp : ThumbsDown;
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <Panel
      title={title}
      icon={<Icon className={cn("size-4", tone === "praise" ? "text-success" : "text-destructive")} />}
      actions={
        <Button asChild variant="link" size="sm" className="h-auto px-0">
          <Link href={href}>Explore more →</Link>
        </Button>
      }
    >
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing extracted yet.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.attribute}>
              <button type="button" onClick={() => openAnswer(it.answerId)} className="w-full text-left">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {it.attribute}
                    {it.theme && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{it.theme}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground tabular">×{it.count}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${(it.count / max) * 100}%`, background: tone === "praise" ? POL.praise.color : POL.criticism.color }} />
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground hover:text-foreground">“{it.quote}”</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DailyStack({ data, compare, ownName, compareName }: { data: SentimentOverview["daily"]; compare: boolean; ownName: string; compareName: string }) {
  const rows = data.map((d) => {
    const yt = d.you.praise + d.you.neutral + d.you.criticism;
    const tt = d.them.praise + d.them.neutral + d.them.criticism;
    const share = (n: number, t: number) => (t ? (n / t) * 100 : 0);
    return {
      date: d.date,
      yp: share(d.you.praise, yt),
      yn: share(d.you.neutral, yt),
      yc: share(d.you.criticism, yt),
      tp: share(d.them.praise, tt),
      tn: share(d.them.neutral, tt),
      tc: share(d.them.criticism, tt),
      yt,
      tt,
    };
  });
  const config: ChartConfig = {
    yp: { label: `${ownName} · Praise`, color: POL.praise.color },
    yn: { label: `${ownName} · Neutral`, color: POL.neutral.color },
    yc: { label: `${ownName} · Criticism`, color: POL.criticism.color },
    tp: { label: `${compareName} · Praise`, color: POL.praise.color },
    tn: { label: `${compareName} · Neutral`, color: POL.neutral.color },
    tc: { label: `${compareName} · Criticism`, color: POL.criticism.color },
  };
  return (
    <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={1} barCategoryGap={compare ? "18%" : "12%"}>
        <CartesianGrid vertical={false} strokeDasharray="4 4" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(v: string) => new Date(`${v}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
        />
        <YAxis tickLine={false} axisLine={false} width={36} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0]!.payload as (typeof rows)[number];
            return (
              <div className="min-w-44 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                <div className="mb-1 font-medium">{new Date(`${String(label)}T00:00:00Z`).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}</div>
                <div className="font-medium">{ownName} <span className="font-normal text-muted-foreground">({r.yt})</span></div>
                <div className="tabular text-muted-foreground">
                  {r.yp.toFixed(0)}% praise · {r.yn.toFixed(0)}% neutral · {r.yc.toFixed(0)}% critical
                </div>
                {compare && (
                  <>
                    <div className="mt-1 font-medium">{compareName} <span className="font-normal text-muted-foreground">({r.tt})</span></div>
                    <div className="tabular text-muted-foreground">
                      {r.tp.toFixed(0)}% praise · {r.tn.toFixed(0)}% neutral · {r.tc.toFixed(0)}% critical
                    </div>
                  </>
                )}
              </div>
            );
          }}
        />
        <Bar dataKey="yc" stackId="you" fill="var(--color-yc)" />
        <Bar dataKey="yn" stackId="you" fill="var(--color-yn)" />
        <Bar dataKey="yp" stackId="you" fill="var(--color-yp)" radius={[3, 3, 0, 0]} />
        {compare && <Bar dataKey="tc" stackId="them" fill="var(--color-tc)" fillOpacity={0.35} />}
        {compare && <Bar dataKey="tn" stackId="them" fill="var(--color-tn)" fillOpacity={0.35} />}
        {compare && <Bar dataKey="tp" stackId="them" fill="var(--color-tp)" fillOpacity={0.35} radius={[3, 3, 0, 0]} />}
      </BarChart>
    </ChartContainer>
  );
}
