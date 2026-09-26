import { notFound } from "next/navigation";
import { Bot, History, OctagonAlert } from "lucide-react";
import { format } from "date-fns";
import { PageContainer, PageHeader, Panel, TabNav } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import type { ProjectContext } from "@/server/auth/context";
import { aiLlmsAvailable, getCrawlabilityCheck, getLatestCrawlabilityCheck, listCrawlabilityChecks } from "@/server/crawlability/service";
import { getSchedule } from "@/server/audit-crawler/schedules";
import { ScheduleCard } from "@/features/audit/components/schedule-card";
import { CheckLauncher } from "./check-launcher";
import { CheckProgress } from "./check-progress";
import { FindingsList } from "./findings-list";
import { BotMatrix } from "./bot-matrix";
import { LlmsPanel } from "./llms-panel";
import { CheckHistory } from "./check-history";
import { CrawlabilityHero, PagesSection, RobotsSection } from "./sections";

const TABS = ["overview", "bots", "pages", "llms", "robots", "history"] as const;

export async function CrawlabilityScreen({ ctx, checkId, tab: rawTab }: { ctx: ProjectContext; checkId: string | null; tab: string | undefined }) {
  const projectId = ctx.project.id;
  const canRun = ctx.permissions.has("seo.run") || ctx.isInstanceAdmin;
  const [check, history, schedule, aiAvailable] = await Promise.all([
    checkId ? getCrawlabilityCheck(projectId, checkId) : getLatestCrawlabilityCheck(projectId),
    listCrawlabilityChecks(projectId, 50),
    getSchedule(projectId, "crawlability"),
    aiLlmsAvailable(),
  ]);
  if (checkId && !check) notFound();
  const running = history.some((h) => h.status === "queued" || h.status === "running");
  const tab = (TABS as readonly string[]).includes(rawTab ?? "") ? rawTab! : "overview";
  const basePath = check && checkId ? `/p/${projectId}/crawlability/${check.id}` : `/p/${projectId}/crawlability`;

  const header = (
    <PageHeader
      eyebrow="Optimizations"
      title="Crawlability"
      description="Can AI crawlers reach and read your site? We check robots.txt for every AI bot, llms.txt, bot user agents vs. browsers, raw-HTML rendering, meta robots, sitemaps and structured data."
      actions={<CheckLauncher projectId={projectId} domain={ctx.project.domain} canRun={canRun} running={running} label={check ? "Re-run check" : "Run check"} />}
    />
  );

  const scheduleCard = (
    <ScheduleCard
      projectId={projectId}
      kind="crawlability"
      canEdit={canRun}
      schedule={
        schedule
          ? { enabled: schedule.enabled, frequency: schedule.frequency, nextRunAt: schedule.nextRunAt.toISOString(), lastRunAt: schedule.lastRunAt?.toISOString() ?? null, config: schedule.config }
          : null
      }
    />
  );
  const historyRows = history.map((h) => ({ id: h.id, status: h.status, trigger: h.trigger, score: h.score, createdAt: h.createdAt.toISOString(), error: h.error }));

  if (!check) {
    return (
      <PageContainer>
        {header}
        <Panel>
          <EmptyState
            icon={Bot}
            title="No crawlability check yet"
            description={`Run the first check to see which AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended …) can access ${ctx.project.domain} — with copy-paste fixes.`}
            action={<CheckLauncher projectId={projectId} domain={ctx.project.domain} canRun={canRun} running={running} size="default" />}
          />
        </Panel>
        <div className="grid gap-4 lg:grid-cols-2">{scheduleCard}</div>
      </PageContainer>
    );
  }

  if (check.status === "queued" || check.status === "running") {
    return (
      <PageContainer>
        {header}
        <CheckProgress projectId={projectId} checkId={check.id} initial={check.progress ?? null} />
      </PageContainer>
    );
  }

  const result = check.parsed;
  if (check.status === "failed" || !result) {
    return (
      <PageContainer>
        {header}
        <Panel>
          <EmptyState icon={OctagonAlert} title="The check failed" description={check.error ?? "Unknown error"} />
        </Panel>
        <Panel title="History" icon={<History className="size-4 text-muted-foreground" />} contentClassName="p-3 sm:p-4">
          <CheckHistory projectId={projectId} rows={historyRows} activeId={check.id} />
        </Panel>
      </PageContainer>
    );
  }

  const issues = result.findings.filter((f) => f.severity !== "pass");
  const href = (t: string) => (t === "overview" ? basePath : `${basePath}?tab=${t}`);
  const blockedBots = result.bots.filter((b) => b.overall === "blocked").length;

  let content: React.ReactNode;
  if (tab === "bots") content = <BotMatrix bots={result.bots} />;
  else if (tab === "pages") content = <PagesSection pages={result.pages} />;
  else if (tab === "llms")
    content = (
      <LlmsPanel
        key={`${check.llmsTxtStatus}-${check.llmsTxtDraftSource ?? ""}-${check.llmsTxtDraft?.length ?? 0}`}
        projectId={projectId}
        checkId={check.id}
        txt={result.llms.txt}
        full={result.llms.full}
        draft={check.llmsTxtDraft}
        draftSource={check.llmsTxtDraftSource ?? null}
        aiStatus={check.llmsTxtStatus}
        aiError={check.llmsTxtError}
        aiAvailable={aiAvailable}
        canRun={canRun}
      />
    );
  else if (tab === "robots") content = <RobotsSection result={result} />;
  else if (tab === "history")
    content = (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Check history" icon={<History className="size-4 text-muted-foreground" />} contentClassName="p-3 sm:p-4">
          <CheckHistory projectId={projectId} rows={historyRows} activeId={check.id} />
        </Panel>
        {scheduleCard}
      </div>
    );
  else
    content = (
      <div className="space-y-4">
        <CrawlabilityHero score={check.score} result={result} />
        <div>
          <h2 className="mb-2 text-sm font-semibold">
            Findings <span className="font-normal text-muted-foreground">· {issues.length} to review</span>
          </h2>
          <FindingsList findings={result.findings} />
        </div>
      </div>
    );

  return (
    <PageContainer>
      {header}
      <p className="-mt-2 text-xs text-muted-foreground tabular">
        {new URL(result.origin).hostname} · checked {format(check.completedAt ?? check.createdAt, "MMM d, yyyy · HH:mm")}
        {check.trigger !== "manual" ? ` · ${check.trigger}` : ""}
        {checkId && history[0] && history[0].id !== check.id ? " · older check" : ""}
      </p>
      <TabNav
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: href("overview") },
          { key: "bots", label: `AI bots${blockedBots ? ` (${blockedBots} blocked)` : ""}`, href: href("bots") },
          { key: "pages", label: `Pages (${result.pages.length})`, href: href("pages") },
          { key: "llms", label: "llms.txt", href: href("llms") },
          { key: "robots", label: "robots.txt & sitemaps", href: href("robots") },
          { key: "history", label: `History (${history.length})`, href: href("history") },
        ]}
      />
      {content}
    </PageContainer>
  );
}
