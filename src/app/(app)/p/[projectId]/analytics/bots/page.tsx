import type { Metadata } from "next";
import { requireProject } from "@/server/auth/guards";
import { env } from "@/server/env";
import { PageContainer, PageHeader, TabNav } from "@/components/app/page";
import { resolveAnalyticsPeriod } from "@/server/analytics/period";
import {
  getBotMode,
  getBotOverview,
  getConnectorStatuses,
  getCrawledPages,
  getPerformance,
  getSeenBots,
} from "@/server/analytics/bots/queries";
import { getIpRangeStatus } from "@/server/analytics/bots/ip-ranges";
import { BotToolbar } from "@/features/analytics/bots/components/toolbar";
import { BotOverviewView } from "@/features/analytics/bots/components/overview";
import { CrawledPagesTable, PerformanceTable } from "@/features/analytics/bots/components/tables";
import { BotSyncTab } from "@/features/analytics/bots/components/sync-tab";

export const metadata: Metadata = { title: "Bot Traffic" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) ?? undefined;
};
const list = (sp: SP, k: string) => (one(sp, k) ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30);

const TABS = ["overview", "pages", "performance", "sync"] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZE = 50;

export default async function BotTrafficPage({ params, searchParams }: PageProps<"/p/[projectId]/analytics/bots">) {
  const { projectId } = await params;
  const sp = (await searchParams) as SP;
  const ctx = await requireProject(projectId);
  const canManage = ctx.permissions.has("settings.manage") || ctx.isInstanceAdmin;
  const tabParam = one(sp, "tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "overview";
  const period = resolveAnalyticsPeriod({ period: one(sp, "period"), from: one(sp, "from"), to: one(sp, "to") }, { lagDays: 0 });
  const base = `/p/${projectId}/analytics/bots`;

  // Tabs keep the period; filters are tab-specific.
  const keep = new URLSearchParams();
  for (const k of ["period", "from", "to"]) {
    const v = one(sp, k);
    if (v) keep.set(k, v);
  }
  const href = (t: Tab) => {
    const q = new URLSearchParams(keep);
    if (t !== "overview") q.set("tab", t);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  const mode = await getBotMode(ctx.project.id);
  const opts = {
    q: one(sp, "q"),
    bots: list(sp, "bots"),
    status: list(sp, "status"),
    sort: one(sp, "sort") as "visits" | "last" | "path" | "errors" | undefined,
    dir: (one(sp, "dir") === "asc" ? "asc" : "desc") as "asc" | "desc",
    page: Math.max(0, Number(one(sp, "page")) || 0),
    pageSize: PAGE_SIZE,
  };

  let content: React.ReactNode;
  if (tab === "overview") {
    const data = await getBotOverview(ctx.project.id, period, list(sp, "bots"));
    content = (
      <BotOverviewView
        data={data}
        periodLabel={period.label}
        pagesHrefBase={href("pages")}
        canUpload={canManage}
        syncHref={href("sync")}
      />
    );
  } else if (tab === "pages") {
    const [pages, seen] = await Promise.all([getCrawledPages(ctx.project.id, period, opts), getSeenBots(ctx.project.id)]);
    content = <CrawledPagesTable rows={pages.rows} total={pages.total} pageSize={PAGE_SIZE} seenBots={seen} domain={ctx.project.domain} />;
  } else if (tab === "performance") {
    const [perf, seen] = await Promise.all([getPerformance(ctx.project.id, period, opts), getSeenBots(ctx.project.id)]);
    content = (
      <PerformanceTable rows={perf.rows} total={perf.total} pageSize={PAGE_SIZE} seenBots={seen} summary={perf.summary} domain={ctx.project.domain} />
    );
  } else {
    const [connectors, ipRanges] = await Promise.all([getConnectorStatuses(ctx.project.id), getIpRangeStatus()]);
    content = (
      <BotSyncTab
        projectId={ctx.project.id}
        appUrl={env.appUrl}
        domain={ctx.project.domain}
        connectors={connectors}
        ipRanges={ipRanges}
        canManage={canManage}
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Analytics"
        title={
          <span className="flex flex-wrap items-baseline gap-x-2">
            Bot Traffic Analytics
            <span className="text-base font-normal text-muted-foreground">— {mode === "live" ? "Live mode" : "Manual mode"}</span>
          </span>
        }
        description="Which AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended…) visit your site, what they read and how your pages respond."
        actions={
          tab !== "sync" ? (
            <BotToolbar projectId={ctx.project.id} preset={period.preset} from={period.from} to={period.to} canUpload={canManage} />
          ) : undefined
        }
      />
      <TabNav
        tabs={[
          { key: "overview", label: "Overview", href: href("overview") },
          { key: "pages", label: "Crawled Pages", href: href("pages") },
          { key: "performance", label: "Performance", href: href("performance") },
          { key: "sync", label: "Sync", href: href("sync") },
        ]}
        active={tab}
      />
      {content}
    </PageContainer>
  );
}
