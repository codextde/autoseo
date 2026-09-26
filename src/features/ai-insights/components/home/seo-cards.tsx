"use client";

import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  Bug,
  CheckCircle2,
  LineChart,
  Link2,
  ListChecks,
  Loader2,
  Search,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/app/charts";
import { Delta, formatCompact, formatNumber } from "@/components/app/metrics";
import { cn } from "@/lib/utils";
import type { SeoCards } from "@/server/ai/insights/seo-dashboard";

type CardDef = { key: string; hasData: boolean; node: React.ReactNode };

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function CardShell({
  title,
  icon: Icon,
  href,
  action = "More details",
  stamp,
  children,
  className,
}: {
  title: string;
  icon: LucideIcon;
  href?: string;
  action?: string;
  stamp?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-soft",
        className,
      )}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-7 items-center justify-center rounded-lg bg-muted">
            <Icon className="size-3.5" />
          </span>
          {title}
        </h3>
        {href && (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {action} <ArrowRight className="size-3" />
          </Link>
        )}
      </header>
      <div className="flex-1">{children}</div>
      {stamp && (
        <footer className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
          {stamp}
        </footer>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  delta,
  invert,
  suffix = "%",
}: {
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  invert?: boolean;
  suffix?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-semibold tracking-tight tabular">
          {value}
        </span>
        {delta !== undefined && (
          <Delta
            value={delta}
            invert={invert}
            suffix={suffix}
            digits={0}
            showZero={false}
            className="text-[10px]"
          />
        )}
      </div>
    </div>
  );
}

function EmptyCard({
  text,
  cta,
  href,
  secondary,
}: {
  text: string;
  cta: string;
  href: string;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-start justify-between gap-3">
      <p className="text-sm text-muted-foreground">{text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={href}>{cta}</Link>
        </Button>
        {secondary}
      </div>
    </div>
  );
}

const SEV_DOT: Record<string, string> = {
  critical: "bg-destructive",
  warning: "bg-warning",
  info: "bg-muted-foreground/50",
};

function scoreTone(score: number | null) {
  if (score == null) return "text-muted-foreground";
  return score >= 80
    ? "text-success"
    : score >= 50
      ? "text-warning"
      : "text-destructive";
}

export function SeoCardsGrid({
  projectId,
  domain,
  cards,
  isDemo,
}: {
  projectId: string;
  domain: string;
  cards: SeoCards;
  /** Demo projects use fictional domains — no backlink lookups are possible. */
  isDemo?: boolean;
}) {
  const base = `/p/${projectId}`;
  const defs: CardDef[] = [];

  /* Search performance */
  const sc = cards.searchConsole;
  defs.push({
    key: "sc",
    hasData: !!sc.data,
    node: (
      <CardShell
        title="Search performance"
        icon={Search}
        href={
          sc.status !== "not_connected"
            ? `${base}/analytics/search-console`
            : undefined
        }
        stamp={
          sc.status !== "not_connected"
            ? `${sc.source === "bing" ? "Bing Webmaster Tools" : "Google Search Console"}${sc.site ? ` · ${sc.site}` : ""} · ${sc.label}`
            : undefined
        }
      >
        {sc.data ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Clicks"
                value={formatCompact(sc.data.clicks)}
                delta={sc.data.clicksDelta}
              />
              <Stat
                label="Impressions"
                value={formatCompact(sc.data.impressions)}
                delta={sc.data.impressionsDelta}
              />
              <Stat
                label="CTR"
                value={sc.data.ctr == null ? "—" : `${sc.data.ctr.toFixed(1)}%`}
              />
              <Stat
                label="Avg position"
                value={
                  sc.data.position == null ? "—" : sc.data.position.toFixed(1)
                }
              />
            </div>
            <Sparkline
              values={sc.data.series}
              color="var(--chart-3)"
              height={40}
            />
          </div>
        ) : sc.status === "not_connected" ? (
          <EmptyCard
            text="Bring your real clicks, impressions and AI-style queries into view."
            cta="Connect Search Console"
            href={`${base}/integrations`}
          />
        ) : sc.status === "pending" ? (
          <EmptyCard
            text="Almost there — select the Search Console property to finish connecting."
            cta="Finish setup"
            href={`${base}/integrations`}
          />
        ) : sc.status === "error" ? (
          <EmptyCard
            text="The last Search Console sync failed. Reconnect or check the integration."
            cta="Check integration"
            href={`${base}/integrations`}
          />
        ) : (
          <EmptyCard
            text="Connected — the first data appears after the initial sync (Search Console data lags 2–3 days)."
            cta="View Search Console"
            href={`${base}/analytics/search-console`}
          />
        )}
      </CardShell>
    ),
  });

  /* AI traffic (GA4 / Matomo / Piwik) */
  const tr = cards.traffic;
  defs.push({
    key: "traffic",
    hasData: !!tr.data,
    node: (
      <CardShell
        title="AI traffic"
        icon={BarChart3}
        href={
          tr.status !== "not_connected"
            ? `${base}/analytics/traffic`
            : undefined
        }
        stamp={
          tr.status !== "not_connected"
            ? `${tr.providerLabel ?? "Analytics"}${tr.propertyLabel ? ` · ${tr.propertyLabel}` : ""} · ${tr.label}`
            : undefined
        }
      >
        {tr.data ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="AI sessions"
                value={formatCompact(tr.data.sessions)}
                delta={tr.data.sessionsDelta}
              />
              <Stat
                label="Share of all"
                value={
                  tr.data.aiShare == null
                    ? "—"
                    : `${tr.data.aiShare.toFixed(1)}%`
                }
              />
              <Stat
                label="Conversions"
                value={formatCompact(tr.data.conversions)}
                delta={tr.data.conversionsDelta}
              />
              <Stat
                label="Top platform"
                value={
                  <span className="block truncate text-sm">
                    {tr.data.topPlatform ?? "—"}
                  </span>
                }
              />
            </div>
            <Sparkline
              values={tr.data.series}
              color="var(--chart-2)"
              height={40}
            />
          </div>
        ) : tr.status === "not_connected" ? (
          <EmptyCard
            text="See how many visitors ChatGPT, Perplexity, Gemini & co. send to your site — and whether they convert."
            cta="Connect GA4"
            href={`${base}/integrations`}
          />
        ) : tr.status === "pending" ? (
          <EmptyCard
            text="Almost there — pick the analytics property to finish connecting."
            cta="Finish setup"
            href={`${base}/integrations`}
          />
        ) : tr.status === "error" ? (
          <EmptyCard
            text="The last analytics sync failed. Reconnect or check the integration."
            cta="Check integration"
            href={`${base}/integrations`}
          />
        ) : (
          <EmptyCard
            text="No AI-referred sessions recorded in this period yet."
            cta="View AI traffic"
            href={`${base}/analytics/traffic`}
          />
        )}
      </CardShell>
    ),
  });

  /* Site audit */
  const au = cards.audit;
  const auRunning = au && (au.status === "running" || au.status === "queued");
  defs.push({
    key: "audit",
    hasData: !!au,
    node: (
      <CardShell
        title="Site audit"
        icon={Bug}
        href={au ? `${base}/seo/audit` : undefined}
        stamp={
          au
            ? auRunning
              ? "Site audit · crawl in progress"
              : au.status === "failed"
                ? "Site audit · last crawl failed"
                : `Site audit · crawled ${formatNumber(au.pagesCrawled)} pages · ${fmtDate(au.completedAt ?? au.startedAt)}`
            : undefined
        }
      >
        {au ? (
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[11px] text-muted-foreground">
                  Health score
                </div>
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-2xl font-semibold tracking-tight tabular",
                    scoreTone(au.score),
                  )}
                >
                  {auRunning && (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  )}
                  {au.score ?? "—"}
                  {au.score != null && (
                    <span className="text-sm font-normal text-muted-foreground">
                      /100
                    </span>
                  )}
                </div>
              </div>
              {au.issueCounts && (
                <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs tabular">
                  {(
                    [
                      ["critical", "critical"],
                      ["warning", "warnings"],
                      ["info", "notices"],
                    ] as const
                  ).map(([k, label]) => (
                    <span key={k} className="flex items-center gap-1">
                      <span className={cn("size-2 rounded-full", SEV_DOT[k])} />{" "}
                      {formatNumber(au.issueCounts![k])}
                      <span className="text-muted-foreground">{label}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {au.history.length > 1 && (
              <Sparkline
                values={au.history}
                color="var(--chart-2)"
                height={32}
              />
            )}
            {au.topIssues.length === 0 ? (
              au.status === "completed" && (
                <p className="flex items-center gap-1.5 text-sm text-success">
                  <CheckCircle2 className="size-4" /> No issues found — your
                  site looks healthy.
                </p>
              )
            ) : (
              <ul className="space-y-1.5">
                {au.topIssues.map((i) => (
                  <li
                    key={i.issueType}
                    className="flex items-center gap-2 text-sm"
                  >
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        SEV_DOT[i.severity] ?? SEV_DOT.info,
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular">
                      {formatNumber(i.pages)} pages
                    </span>
                  </li>
                ))}
                {au.totalIssueTypes > au.topIssues.length && (
                  <li className="text-xs text-muted-foreground">
                    + {au.totalIssueTypes - au.topIssues.length} more issues
                  </li>
                )}
              </ul>
            )}
          </div>
        ) : (
          <EmptyCard
            text="Crawl your site for broken links, missing tags and indexability problems."
            cta="Run an audit"
            href={`${base}/seo/audit`}
          />
        )}
      </CardShell>
    ),
  });

  /* AI crawlability */
  const cr = cards.crawlability;
  defs.push({
    key: "crawl",
    hasData: !!cr,
    node: (
      <CardShell
        title="AI crawlability"
        icon={Bot}
        href={cr ? `${base}/crawlability` : undefined}
        stamp={
          cr
            ? cr.status === "completed"
              ? `Crawlability check · ${fmtDate(cr.checkedAt)}`
              : cr.status === "failed"
                ? "Crawlability check · last check failed"
                : "Crawlability check · running"
            : undefined
        }
      >
        {cr ? (
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[11px] text-muted-foreground">
                  Crawlability score
                </div>
                <div
                  className={cn(
                    "text-2xl font-semibold tracking-tight tabular",
                    scoreTone(cr.score),
                  )}
                >
                  {cr.score ?? "—"}
                  {cr.score != null && (
                    <span className="text-sm font-normal text-muted-foreground">
                      /100
                    </span>
                  )}
                </div>
              </div>
              {cr.history.length > 1 && (
                <Sparkline
                  values={cr.history}
                  color="var(--chart-7)"
                  height={32}
                  className="max-w-32"
                />
              )}
            </div>
            {cr.categories.every((c) => c.pct >= 100) ? (
              <p className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 className="size-4" /> Every category at full
                score.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {cr.categories
                  .filter((c) => c.pct < 100)
                  .slice(0, 3)
                  .map((c) => (
                    <li key={c.key} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">{c.label}</span>
                        <span className="shrink-0 text-muted-foreground tabular">
                          {formatNumber(c.points)}/{c.max}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            c.pct >= 80
                              ? "bg-success"
                              : c.pct >= 50
                                ? "bg-warning"
                                : "bg-destructive",
                          )}
                          style={{ width: `${Math.max(2, c.pct)}%` }}
                        />
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        ) : (
          <EmptyCard
            text="Check whether GPTBot, ClaudeBot, PerplexityBot & co. can reach and read your site (robots.txt, llms.txt, rendering)."
            cta="Run a check"
            href={`${base}/crawlability`}
          />
        )}
      </CardShell>
    ),
  });

  /* Rank tracking */
  const rk = cards.rank;
  defs.push({
    key: "rank",
    hasData: !!rk && rk.trackedKeywords > 0,
    node: (
      <CardShell
        title="Rank tracking"
        icon={LineChart}
        href={rk ? `${base}/seo/rank-tracking` : undefined}
        stamp={
          rk
            ? `${rk.configs} tracker${rk.configs > 1 ? "s" : ""} · ${rk.running ? "check running…" : rk.lastCheckedAt ? `last checked ${fmtDate(rk.lastCheckedAt)}` : "not checked yet"}`
            : undefined
        }
      >
        {rk ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Keywords" value={formatNumber(rk.trackedKeywords)} />
              <Stat label="In top 10" value={formatNumber(rk.top10)} />
              <Stat
                label="Improved (7d)"
                value={
                  <span
                    className={cn(
                      "inline-flex items-center",
                      rk.improved > 0 && "text-success",
                    )}
                  >
                    <ArrowUpRight className="size-4" />
                    {rk.improved}
                  </span>
                }
              />
              <Stat
                label="Declined (7d)"
                value={
                  <span
                    className={cn(
                      "inline-flex items-center",
                      rk.declined > 0 && "text-destructive",
                    )}
                  >
                    <ArrowDownRight className="size-4" />
                    {rk.declined}
                  </span>
                }
              />
            </div>
            {rk.trend.length > 1 ? (
              <Sparkline values={rk.trend} color="var(--chart-1)" height={36} />
            ) : (
              <p className="text-xs text-muted-foreground">
                The top-10 trend appears after a few checks.
              </p>
            )}
          </div>
        ) : (
          <EmptyCard
            text="Track your Google positions for the keywords that matter — desktop and mobile."
            cta="Set up rank tracking"
            href={`${base}/seo/rank-tracking`}
          />
        )}
      </CardShell>
    ),
  });

  /* Backlink pulse */
  const bl = cards.backlinks;
  const blHref = `${base}/seo/backlinks?target=${encodeURIComponent(domain)}&scope=domain`;
  defs.push({
    key: "backlinks",
    hasData: !!bl,
    node: (
      <CardShell
        title="Backlink pulse"
        icon={Link2}
        href={bl ? blHref : undefined}
        stamp={
          bl
            ? `Backlinks · snapshot ${fmtDate(bl.capturedAt)}${bl.stale ? " · open Backlinks to refresh" : ""}`
            : undefined
        }
      >
        {bl ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Ref. domains"
                value={formatCompact(bl.referringDomains)}
              />
              <Stat label="Backlinks" value={formatCompact(bl.backlinks)} />
              <Stat
                label="New links"
                value={
                  <span
                    className={cn((bl.newBacklinks ?? 0) > 0 && "text-success")}
                  >
                    ▲ {formatCompact(bl.newBacklinks ?? 0)}
                  </span>
                }
              />
              <Stat
                label="Lost links"
                value={
                  <span
                    className={cn(
                      (bl.lostBacklinks ?? 0) > 0 && "text-destructive",
                    )}
                  >
                    ▼ {formatCompact(bl.lostBacklinks ?? 0)}
                  </span>
                }
              />
            </div>
            {bl.trend.length > 1 && (
              <Sparkline values={bl.trend} color="var(--chart-4)" height={36} />
            )}
          </div>
        ) : isDemo ? (
          <EmptyCard
            text="Backlink snapshots come from live DataForSEO lookups, which demo projects (fictional domains) never make. Open a real project to see its backlink pulse."
            cta="Open Backlinks"
            href={`${base}/seo/backlinks`}
          />
        ) : (
          <EmptyCard
            text={`Look up ${domain} once in Backlinks to take the first snapshot of who links to you. The dashboard only shows stored snapshots and never spends credits on its own.`}
            cta="Open Backlinks"
            href={blHref}
          />
        )}
      </CardShell>
    ),
  });

  /* Open tasks */
  defs.push({
    key: "tasks",
    hasData: cards.openTasks > 0,
    node: (
      <CardShell
        title="Open tasks"
        icon={ListChecks}
        href={`${base}/tasks`}
        action="Open tasks"
      >
        <div className="flex h-full flex-col justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold tracking-tight tabular">
              {formatNumber(cards.openTasks)}
            </div>
            <p className="text-sm text-muted-foreground">
              {cards.openTasks > 0
                ? "Prioritized, evidence-backed optimizations from your visibility, citations, crawl and Search Console data."
                : "No open tasks — findings from your AI visibility, audits and Search Console turn into tasks here."}
            </p>
          </div>
        </div>
      </CardShell>
    ),
  });

  // Cards with data first (open-seo), keeping the declared order otherwise.
  const ordered = [
    ...defs.filter((d) => d.hasData),
    ...defs.filter((d) => !d.hasData),
  ];
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">
            SEO & site health
          </h2>
          <p className="text-xs text-muted-foreground">
            Search Console, analytics, audits, rankings and backlinks — from
            stored data only.
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map((d) => (
          <div key={d.key} className="min-w-0 [&>section]:h-full">
            {d.node}
          </div>
        ))}
      </div>
    </section>
  );
}
