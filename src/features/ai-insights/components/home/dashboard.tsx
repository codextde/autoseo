"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  FlaskConical,
  Link2,
  ListChecks,
  Loader2,
  Radar,
  Search,
  Sparkles,
  Swords,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/app/page";
import { PeriodSelect } from "@/components/app/filters";
import { Sparkline, TrendChart } from "@/components/app/charts";
import { Delta } from "@/components/app/metrics";
import { EngineIcon, EngineStack } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import { CountryFlag } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlPatch } from "@/hooks/use-url-state";
import { getEngine } from "@/lib/engines";
import { cn } from "@/lib/utils";
import type { DashboardData } from "@/server/ai/insights/dashboard";
import type { SeoCards } from "@/server/ai/insights/seo-dashboard";
import { formatMetric, METRICS } from "../../lib/metrics";
import { INSIGHT_PERIODS } from "../insight-filters";
import { YouBadge } from "../brand";
import { SetupChecklist } from "./checklist";
import { DemoDataButton } from "./demo-button";
import { SeoCardsGrid } from "./seo-cards";

type ProjectInfo = { id: string; name: string; domain: string; country: string; engines: string[] };

const noopSubscribe = () => () => {};
function greetingNow() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Greeting({ name }: { name: string | null }) {
  // Client time of day; the server renders a neutral greeting.
  const text = useSyncExternalStore(noopSubscribe, greetingNow, () => "Welcome back");
  const first = name?.split(/\s+/)[0];
  return (
    <span>
      {text}
      {first ? `, ${first}` : ""}
    </span>
  );
}

const KPI_COLORS: Record<string, string> = {
  visibility: "var(--chart-2)",
  mentionRate: "var(--chart-3)",
  citationRate: "var(--chart-4)",
  sov: "var(--chart-1)",
  sentiment: "var(--chart-7)",
};

export function DashboardView({
  project,
  userName,
  data,
  seo,
  canManageProjects,
}: {
  project: ProjectInfo;
  userName: string | null;
  data: DashboardData;
  seo: SeoCards;
  canManageProjects: boolean;
}) {
  const params = useSearchParams();
  const [patch, pending] = useUrlPatch();
  const period = params.get("period") ?? "30d";
  const base = `/p/${project.id}`;
  const q = period !== "30d" ? `?period=${period}` : "";
  const openItems = data.checklist.filter((c) => !c.done && !c.skipped).length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm text-muted-foreground">
            <Greeting name={userName} />
          </p>
          <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight sm:text-2xl">
            <Favicon domain={project.domain} fallback={project.name} className="size-7 rounded-lg" />
            <span className="truncate">{project.name}</span>
            {data.isDemo && (
              <Badge variant="outline" className="border-warning/50 text-warning">
                <FlaskConical className="size-3" /> Demo data
              </Badge>
            )}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{project.domain}</span>
            <span>·</span>
            <CountryFlag iso={project.country} withName />
            <span>·</span>
            <EngineStack ids={project.engines} max={6} />
          </div>
        </div>
        {data.hasData && (
          <div className="flex items-center gap-2">
            {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            <PeriodSelect value={period} presets={INSIGHT_PERIODS} onChange={(p) => patch({ period: p === "30d" ? null : p })} />
          </div>
        )}
      </div>

      {data.isDemo && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs sm:items-center">
          <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-warning sm:mt-0" />
          <span>
            This is a <b>demo project</b> with generated sample data (fictional brands). Tracking is paused and no provider credits are used.
          </span>
        </div>
      )}

      {!data.hasData ? <EmptyDashboard project={project} data={data} canManageProjects={canManageProjects} /> : <FilledDashboard base={base} q={q} data={data} />}

      {data.hasData && openItems > 0 && <SetupChecklist projectId={project.id} items={data.checklist} />}
      <SeoCardsGrid projectId={project.id} domain={project.domain} cards={seo} isDemo={data.isDemo} />
      <QuickLinks base={base} />
    </div>
  );
}

function EmptyDashboard({ project, data, canManageProjects }: { project: ProjectInfo; data: DashboardData; canManageProjects: boolean }) {
  const run = data.latestRun;
  const running = run && (run.status === "queued" || run.status === "running");
  const pct = run && run.total ? Math.round((run.done / run.total) * 100) : 0;
  const noPrompts = data.counts.prompts === 0;
  return (
    <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
      <Panel className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative flex flex-col items-start gap-4 py-4 sm:py-8">
          <div className="flex size-12 items-center justify-center rounded-2xl border bg-background shadow-xs">
            {running ? <Loader2 className="size-5 animate-spin text-brand" /> : <Radar className="size-5 text-brand" />}
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
              {noPrompts ? "Add prompts to start tracking your AI visibility" : running ? "Your first AI visibility run is in progress" : "Your first results are on the way"}
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              {noPrompts
                ? `Tell us which questions your customers ask AI engines. We ask them daily on ${project.engines.length} engines and measure how often ${project.name} is named, ranked and cited.`
                : `We're asking ${data.counts.prompts} prompts on ${data.counts.engines} AI engines. Visibility, competitors, sentiment and sources appear here as soon as the first answers are analysed — usually within a few minutes, depending on your providers.`}
            </p>
          </div>
          {run && (
            <div className="w-full max-w-md space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium capitalize">{run.status === "running" ? "Running" : run.status}</span>
                <span className="text-muted-foreground tabular">
                  {run.done}/{run.total} answers{run.failed ? ` · ${run.failed} failed` : ""}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8 }} />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/p/${project.id}/ai/tracker`}>{noPrompts ? "Add prompts" : "Open Tracker"}</Link>
            </Button>
            {canManageProjects && <DemoDataButton projectId={project.id} variant="outline" />}
          </div>
          {canManageProjects && (
            <p className="text-xs text-muted-foreground">
              Demo data creates a separate, clearly labelled “Demo · …” project with 90 days of sample answers — your project stays untouched.
            </p>
          )}
        </div>
      </Panel>
      <SetupChecklist projectId={project.id} items={data.checklist} alwaysShow />
    </div>
  );
}

function FilledDashboard({ base, q, data }: { base: string; q: string; data: DashboardData }) {
  const trendRows = data.trend.dates.map((d, i) => {
    const row: Record<string, unknown> = { date: d };
    for (const s of data.trend.series) row[s.key] = s.values[i];
    return row;
  });
  const maxSrc = Math.max(1, ...data.sources.map((s) => s.citations));
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
        {data.kpis.map((k, i) => {
          const def = METRICS[k.key];
          return (
            <motion.div
              key={k.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              className={cn("flex min-w-0 flex-col rounded-2xl border bg-card p-3 shadow-soft sm:p-4", i === 4 && "col-span-2 lg:col-span-1")}
              title={def.hint}
            >
              <span className="text-xs font-medium text-muted-foreground">{def.label}</span>
              <span className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold tracking-tight tabular">
                  {formatMetric(k.key, k.value)}
                  {k.key === "sentiment" && k.value != null && <span className="text-sm font-normal text-muted-foreground">/100</span>}
                </span>
                <Delta value={k.delta} invert={def.invert} showZero={false} digits={k.key === "sentiment" ? 0 : 1} />
              </span>
              <Sparkline values={k.spark} color={KPI_COLORS[k.key]} height={32} className="mt-2" />
            </motion.div>
          );
        })}
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title="Visibility trend"
          description="You vs your top competitors"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href={`${base}/ai/competitors${q}`}>
                Competitors <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
        >
          <TrendChart
            data={trendRows}
            series={data.trend.series.map((s) => ({ key: s.key, label: s.brand.name, color: s.brand.color }))}
            type="line"
            format="percent"
            domain={[0, "auto"]}
            height={260}
            legend
          />
        </Panel>
        <Panel title="Top competitors" icon={<Swords className="size-4" />} contentClassName="p-2 sm:p-3">
          <ol className="space-y-0.5">
            {data.ranking.map((r, i) => (
              <li key={r.brand.key}>
                <Link
                  href={r.brand.isOwn ? `${base}/ai/tracker` : `${base}/ai/competitors/${r.brand.competitorId}${q}`}
                  className={cn("flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-muted", r.brand.isOwn && "bg-brand-soft/40")}
                >
                  <span className="w-4 text-xs text-muted-foreground tabular">{i + 1}</span>
                  <Favicon domain={r.brand.domain} fallback={r.brand.name} />
                  <span className="min-w-0 flex-1 truncate font-medium">{r.brand.name}</span>
                  {r.brand.isOwn && <YouBadge />}
                  <span className="text-right">
                    <span className="block text-xs font-medium tabular">{formatMetric("visibility", r.visibility)}</span>
                    <Delta value={r.delta} showZero={false} className="text-[10px]" />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
        <Panel title="Notable changes" icon={<Activity className="size-4" />} description="Prompts with the biggest visibility moves" contentClassName="p-2 sm:p-3">
          {data.movers.length === 0 ? (
            <EmptyState compact title="No big moves" description="Your prompt visibility is stable compared with the previous period." />
          ) : (
            <ul className="space-y-0.5">
              {data.movers.map((m) => (
                <li key={m.promptId} className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", m.delta > 0 ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive")}>
                    {m.delta > 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-sm">{m.text}</span>
                    <span className="text-xs text-muted-foreground tabular">now {m.visibility.toFixed(0)}% visible</span>
                  </span>
                  <Delta value={m.delta} suffix="pp" digits={0} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title="Top sources"
          icon={<Link2 className="size-4" />}
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href={`${base}/ai/sources${q}`}>
                All <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
          contentClassName="p-2 sm:p-3"
        >
          {data.sources.length === 0 ? (
            <EmptyState compact title="No citations yet" />
          ) : (
            <ol className="space-y-0.5">
              {data.sources.map((s) => (
                <li key={s.domain}>
                  <Link href={`${base}/ai/sources/${encodeURIComponent(s.domain)}${q}`} className="relative flex items-center gap-2.5 overflow-hidden rounded-lg px-2 py-2 text-sm hover:ring-1 hover:ring-border">
                    <span className="absolute inset-y-0 left-0 rounded-lg bg-muted" style={{ width: `${(s.citations / maxSrc) * 100}%` }} />
                    <Favicon domain={s.domain} className="relative" />
                    <span className="relative min-w-0 flex-1 truncate">{s.domain}</span>
                    {s.ownership === "own" && <YouBadge className="relative" />}
                    <span className="relative text-xs tabular">{s.citations.toLocaleString()}</span>
                    <Delta value={s.delta} digits={0} showZero={false} className="relative text-[10px]" />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel
          title="Engine coverage"
          icon={<Bot className="size-4" />}
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href={`${base}/ai/models`}>
                Settings <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
        >
          <ul className="space-y-2.5">
            {data.engines.map((e) => (
              <li key={e.engine} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <EngineIcon id={e.engine} size="xs" active={e.enabled} />
                    <span className={cn(!e.enabled && "text-muted-foreground")}>{getEngine(e.engine)?.name ?? e.engine}</span>
                    {!e.enabled && <span className="text-[10px] text-muted-foreground">disabled</span>}
                  </span>
                  <span className="text-xs tabular">
                    {e.visibility == null ? "—" : `${e.visibility.toFixed(0)}%`}
                    <span className="ml-1.5 text-muted-foreground">{e.answers.toLocaleString()} answers</span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${e.visibility ?? 0}%`, background: getEngine(e.engine)?.color ?? "var(--brand)" }} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

const QUICK = [
  {
    title: "AI Visibility",
    icon: Sparkles,
    links: [
      { label: "Tracker", href: "/ai/tracker" },
      { label: "Competitors", href: "/ai/competitors" },
      { label: "Sentiment", href: "/ai/sentiment" },
      { label: "Sources", href: "/ai/sources" },
    ],
  },
  {
    title: "SEO",
    icon: Search,
    links: [
      { label: "Keyword Research", href: "/seo/keywords" },
      { label: "Rank Tracking", href: "/seo/rank-tracking" },
      { label: "Site Audit", href: "/seo/audit" },
      { label: "Backlinks", href: "/seo/backlinks" },
    ],
  },
  {
    title: "Analytics",
    icon: BarChart3,
    links: [
      { label: "Human Traffic", href: "/analytics/traffic" },
      { label: "Bot Traffic", href: "/analytics/bots" },
      { label: "Search Console", href: "/analytics/search-console" },
      { label: "Attribution", href: "/attribution" },
    ],
  },
  {
    title: "Optimize",
    icon: ListChecks,
    links: [
      { label: "Tasks", href: "/tasks" },
      { label: "Content", href: "/content" },
      { label: "Crawlability", href: "/crawlability" },
      { label: "Reports", href: "/reports" },
    ],
  },
];

function QuickLinks({ base }: { base: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
      {QUICK.map((g) => (
        <div key={g.title} className="rounded-2xl border bg-card p-4 shadow-soft">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-muted">
              <g.icon className="size-3.5" />
            </span>
            {g.title}
          </div>
          <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {g.links.map((l) => (
              <li key={l.href}>
                <Link href={`${base}${l.href}`} className="group flex items-center gap-1 rounded-md py-1 text-sm text-muted-foreground hover:text-foreground">
                  <span className="truncate">{l.label}</span>
                  <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
