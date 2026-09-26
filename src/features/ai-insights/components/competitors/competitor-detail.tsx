"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Pencil, Scale, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { StackedBar, TrendChart } from "@/components/app/charts";
import { Delta } from "@/components/app/metrics";
import { EmptyState } from "@/components/app/empty-state";
import { EngineIcon } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import { CountryFlag, TagChip } from "@/components/app/misc";
import { getEngine } from "@/lib/engines";
import { cn } from "@/lib/utils";
import type { CompetitorDetail } from "@/server/ai/insights/competitors";
import { useClientParam } from "../../lib/client-url";
import { formatMetric, METRICS, type MetricKey } from "../../lib/metrics";
import { SentimentPill } from "../brand";
import { openAnswer } from "../answer-sheet";
import { chartFormat } from "./competitors-view";
import { CompetitorDialog } from "./competitor-dialog";
import { PageCrumb } from "@/components/app/page-crumb";

type PromptRow = CompetitorDetail["prompts"][number];

export function CompetitorDetailView({
  projectId,
  data,
  canManage,
  query,
  filters,
}: {
  projectId: string;
  data: CompetitorDetail;
  canManage: boolean;
  query: string;
  filters?: React.ReactNode;
}) {
  const [metric, setMetric] = useClientParam("metric", "visibility");
  const [promptTab, setPromptTab] = useClientParam("prompts", "gaps");
  const [editOpen, setEditOpen] = useState(false);
  const m = (data.kpis.some((k) => k.key === metric) ? metric : "visibility") as MetricKey;
  const { brand, own } = data;

  const chartRows = data.dates.map((d, i) => ({ date: d, you: data.series.you[m]?.[i] ?? null, them: data.series.them[m]?.[i] ?? null }));
  const gaps = data.prompts.filter((p) => p.them > 0 && p.you === 0);
  const h = data.headToHead;
  const decided = h.wins + h.losses;

  const promptColumns: Column<PromptRow>[] = [
    {
      id: "text",
      header: "Prompt",
      cell: (p) => (
        <div className="min-w-56 space-y-1">
          <div className="flex items-start gap-1.5">
            <CountryFlag iso={p.country} className="mt-0.5" />
            <span className="line-clamp-2 text-sm">{p.text}</span>
          </div>
          {p.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {p.tags.slice(0, 3).map((t) => (
                <TagChip key={t.id} name={t.name} color={t.color} />
              ))}
            </div>
          )}
        </div>
      ),
      sortValue: (p) => p.text.toLowerCase(),
    },
    { id: "them", header: brand.name, align: "right", sortValue: (p) => p.them, cell: (p) => <span className="tabular">{p.them.toFixed(0)}%</span> },
    { id: "you", header: "You", align: "right", sortValue: (p) => p.you, cell: (p) => <span className="tabular">{p.you.toFixed(0)}%</span> },
    {
      id: "gap",
      header: "Gap",
      align: "right",
      sortValue: (p) => p.them - p.you,
      cell: (p) => {
        const g = p.you - p.them;
        return <span className={cn("font-medium tabular", g < 0 ? "text-destructive" : g > 0 ? "text-success" : "text-muted-foreground")}>{g > 0 ? "+" : ""}{g.toFixed(0)} pp</span>;
      },
    },
    { id: "themPos", header: "Their pos.", align: "right", hideBelow: "md", sortValue: (p) => p.themPos, cell: (p) => <span className="tabular">{p.themPos?.toFixed(1) ?? "—"}</span> },
    { id: "youPos", header: "Your pos.", align: "right", hideBelow: "md", sortValue: (p) => p.youPos, cell: (p) => <span className="tabular">{p.youPos?.toFixed(1) ?? "—"}</span> },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon-sm" aria-label="Back to competitors">
            <Link href={`/p/${projectId}/ai/competitors${query}`}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <Favicon domain={brand.domain} fallback={brand.name} className="size-9 rounded-lg" />
          <div className="min-w-0">
            <PageCrumb label={brand.name} />
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
              <span className="truncate">{brand.name}</span>
              {brand.tracked ? <Badge variant="outline">My List</Badge> : <Badge variant="secondary">Not in My List</Badge>}
            </h1>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {brand.domain ? (
                <a href={`https://${brand.domain}`} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:underline">
                  {brand.domain} <ExternalLink className="size-3" />
                </a>
              ) : (
                "No domain set"
              )}
              {brand.aliases.length > 0 && <span className="truncate">· aka {brand.aliases.join(", ")}</span>}
            </p>
          </div>
        </div>
        {canManage && (
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        )}
      </div>

      {filters}

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-6">
        {data.kpis.map((k) => {
          const def = METRICS[k.key];
          const youBetter = k.you != null && k.them != null && (def.invert ? k.you < k.them : k.you > k.them);
          return (
            <button
              key={k.key}
              type="button"
              onClick={() => setMetric(k.key)}
              className={cn(
                "rounded-2xl border bg-card p-3 text-left shadow-soft transition-colors hover:border-foreground/20",
                m === k.key && "ring-2 ring-foreground/80",
              )}
            >
              <div className="text-xs text-muted-foreground">{def.label}</div>
              <div className="mt-1.5 space-y-1 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: own.color }} /> You
                  </span>
                  <span className={cn("font-semibold tabular", youBetter && "text-success")}>
                    {formatMetric(k.key, k.you)} <Delta value={k.youDelta} invert={def.invert} showZero={false} />
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: brand.color }} />
                    <span className="truncate">{brand.name}</span>
                  </span>
                  <span className="font-semibold tabular">
                    {formatMetric(k.key, k.them)} <Delta value={k.themDelta} invert={def.invert} showZero={false} />
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <Panel title={`${METRICS[m].label} over time`} description={`You vs ${brand.name}`}>
        {data.totals.answers === 0 ? (
          <EmptyState compact icon={Swords} title="No answers in this period" description="Pick a longer period or wait for the next tracking run." />
        ) : (
          <TrendChart
            data={chartRows}
            series={[
              { key: "you", label: "You", color: own.color },
              { key: "them", label: brand.name, color: brand.color },
            ]}
            type="line"
            format={chartFormat(m)}
            domain={m === "sentiment" ? [0, 100] : METRICS[m].format === "percent" ? [0, "auto"] : ["auto", "auto"]}
            height={280}
            legend
          />
        )}
      </Panel>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <Panel title="Head-to-head" icon={<Scale className="size-4" />} description="Who AI names first when both brands appear in the same answer.">
          {h.shared === 0 ? (
            <EmptyState compact title="No shared answers yet" description={`Neither order nor claims can be compared until you and ${brand.name} appear in the same answers.`} />
          ) : (
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-semibold tabular">{decided ? Math.round((h.wins / decided) * 100) : 0}%</span>
                  <span className="text-xs text-muted-foreground">
                    named first in {h.wins} of {decided} decided · {h.shared} shared answers
                  </span>
                </div>
                <StackedBar
                  height={10}
                  parts={[
                    { key: "w", value: h.wins, color: own.color, label: "You first" },
                    { key: "t", value: h.ties, color: "var(--muted-foreground)", label: "Tie" },
                    { key: "l", value: h.losses, color: brand.color, label: `${brand.name} first` },
                  ]}
                />
                <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                  <span>You first · {h.wins}</span>
                  <span>
                    {brand.name} first · {h.losses}
                  </span>
                </div>
              </div>
              {h.byEngine.length > 0 && (
                <ul className="space-y-1.5">
                  {h.byEngine.map((e) => {
                    const d = e.wins + e.losses;
                    return (
                      <li key={e.engine} className="flex items-center gap-2 text-sm">
                        <EngineIcon id={e.engine} size="xs" />
                        <span className="w-28 truncate text-xs">{getEngine(e.engine)?.shortName ?? e.engine}</span>
                        <StackedBar
                          className="flex-1"
                          parts={[
                            { key: "w", value: e.wins, color: own.color },
                            { key: "l", value: e.losses, color: brand.color },
                          ]}
                        />
                        <span className="w-10 text-right text-xs tabular">{d ? Math.round((e.wins / d) * 100) : 0}%</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {data.claims.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                Claims judged from answers ({data.claims.filter((c) => c.winner === "you").length} for you ·{" "}
                {data.claims.filter((c) => c.winner === "them").length} for {brand.name})
              </div>
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {data.claims.slice(0, 40).map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => openAnswer(c.answerId)} className="flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-sm hover:bg-muted/50">
                      <Badge
                        variant="outline"
                        className={cn(
                          "mt-0.5 shrink-0",
                          c.winner === "you" && "border-success/40 text-success",
                          c.winner === "them" && "border-destructive/40 text-destructive",
                        )}
                      >
                        {c.winner === "you" ? "You" : c.winner === "them" ? brand.name : "Tie"}
                      </Badge>
                      <span className="min-w-0 flex-1">
                        <span className="block">{c.label}</span>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <EngineIcon id={c.engine} size="xs" withTooltip={false} /> {c.date} · {c.promptText}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="Sentiment" description={`How AI talks about ${brand.name}`}>
          <div className="flex items-center gap-4">
            <SentimentPill score={data.sentiment.score} className="px-3 py-1.5 text-lg" />
            <div className="flex-1">
              <StackedBar
                height={10}
                parts={[
                  { key: "p", value: data.sentiment.praise, color: "var(--success)", label: "Praise" },
                  { key: "n", value: data.sentiment.neutral, color: "var(--muted-foreground)", label: "Neutral" },
                  { key: "c", value: data.sentiment.criticism, color: "var(--destructive)", label: "Criticism" },
                ]}
              />
              <div className="mt-1.5 flex justify-between text-xs text-muted-foreground tabular">
                <span>Praise {data.sentiment.praise}</span>
                <span>Neutral {data.sentiment.neutral}</span>
                <span>Criticism {data.sentiment.criticism}</span>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <AttributeList title="AI praises" tone="praise" items={data.sentiment.topPraise} />
            <AttributeList title="AI criticises" tone="criticism" items={data.sentiment.topCriticism} />
          </div>
          <Button asChild variant="link" className="mt-2 h-auto px-0">
            <Link href={`/p/${projectId}/ai/sentiment?compare=${brand.competitorId}`}>Compare sentiment →</Link>
          </Button>
        </Panel>
      </div>

      <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="Prompts"
          description="Where they appear and you don't are your biggest opportunities."
          actions={
            <div className="flex rounded-lg bg-muted p-0.5 text-xs">
              {[
                { k: "gaps", label: `Gaps (${gaps.length})` },
                { k: "all", label: `All prompts (${data.prompts.length})` },
              ].map((t) => (
                <button
                  key={t.k}
                  type="button"
                  onClick={() => setPromptTab(t.k)}
                  className={cn("rounded-md px-2.5 py-1 font-medium", promptTab === t.k ? "bg-background shadow-xs" : "text-muted-foreground")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          }
        >
          <DataTable
            columns={promptColumns}
            data={promptTab === "gaps" ? gaps : data.prompts}
            getRowId={(p) => p.id}
            pageSize={25}
            empty={
              <EmptyState
                compact
                title={promptTab === "gaps" ? "No gaps" : "No prompts"}
                description={promptTab === "gaps" ? `Every prompt that names ${brand.name} also names you.` : "No answers in this period."}
              />
            }
            mobileCard={(p) => (
              <div className="space-y-1.5">
                <p className="text-sm">{p.text}</p>
                <div className="flex gap-3 text-xs text-muted-foreground tabular">
                  <span>
                    {brand.name}: <b className="text-foreground">{p.them.toFixed(0)}%</b>
                  </span>
                  <span>
                    You: <b className="text-foreground">{p.you.toFixed(0)}%</b>
                  </span>
                </div>
              </div>
            )}
          />
        </Panel>

        <Panel title="Their top cited sources" description={`Pages cited in answers that name ${brand.name}`} contentClassName="p-2 sm:p-3">
          {data.sources.length === 0 ? (
            <EmptyState compact title="No citations yet" />
          ) : (
            <ol className="space-y-0.5">
              {data.sources.map((s, i) => (
                <li key={s.id}>
                  <Link href={`/p/${projectId}/ai/sources/${s.id}${query}`} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-muted">
                    <span className="w-4 text-xs text-muted-foreground tabular">{i + 1}</span>
                    <Favicon domain={s.domain} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{s.title || s.url.replace(/^https?:\/\//, "")}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {s.domain} · {s.contentType}
                      </span>
                    </span>
                    <span className="text-right text-xs tabular">
                      <span className="block font-medium">{s.answers}</span>
                      <span className={cn("block", s.withYou === 0 ? "text-destructive" : "text-muted-foreground")}>
                        {s.withYou === 0 ? "you absent" : `${Math.round((s.withYou / s.answers) * 100)}% w/ you`}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {canManage && brand.competitorId && (
        <CompetitorDialog
          projectId={projectId}
          open={editOpen}
          onOpenChange={setEditOpen}
          initial={{ id: brand.competitorId, name: brand.name, domain: brand.domain, aliases: brand.aliases, tracked: brand.tracked }}
        />
      )}
    </div>
  );
}

function AttributeList({ title, tone, items }: { title: string; tone: "praise" | "criticism"; items: { attribute: string; count: number; quote: string }[] }) {
  return (
    <div>
      <div className={cn("mb-2 text-xs font-medium", tone === "praise" ? "text-success" : "text-destructive")}>{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing extracted yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.attribute} className="text-sm">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{it.attribute}</span>
                <span className="text-xs text-muted-foreground tabular">×{it.count}</span>
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">“{it.quote}”</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
