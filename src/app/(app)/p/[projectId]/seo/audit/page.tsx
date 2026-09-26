import Link from "next/link";
import { GitCompare, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, Panel } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getAuditHistory, getAuditLimits } from "@/server/audit-crawler/service";
import { getSchedule } from "@/server/audit-crawler/schedules";
import { lighthouseProviderStatus } from "@/server/audit-crawler/lighthouse/providers";
import { LaunchForm } from "@/features/audit/components/launch-form";
import { HistoryTable, type HistoryRow } from "@/features/audit/components/history-table";
import { ScheduleCard } from "@/features/audit/components/schedule-card";
import { LatestAuditHero } from "@/features/audit/components/latest-hero";

export default async function SiteAuditPage({ params }: PageProps<"/p/[projectId]/seo/audit">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId, "project.view");
  const canRun = ctx.permissions.has("seo.run") || ctx.isInstanceAdmin;
  const [history, limits, schedule, providers] = await Promise.all([
    getAuditHistory(projectId, 100),
    getAuditLimits(),
    getSchedule(projectId, "site_audit"),
    lighthouseProviderStatus(),
  ]);
  const defaultUrl = ctx.project.websiteUrl || `https://${ctx.project.domain}`;
  const completed = history.filter((h) => h.status === "completed");
  const latest = completed[0] ?? null;
  const running = history.find((h) => h.status === "running" || h.status === "queued") ?? null;
  const trend = completed
    .slice(0, 12)
    .reverse()
    .map((h) => h.score)
    .filter((s): s is number => s !== null);

  const rows: HistoryRow[] = history.map((h) => ({
    id: h.id,
    startUrl: h.startUrl,
    status: h.status,
    currentPhase: h.currentPhase,
    trigger: h.trigger,
    pagesCrawled: h.pagesCrawled,
    pagesTotal: h.pagesTotal,
    score: h.score,
    issueCounts: h.issueCounts,
    lighthouse: h.config.lighthouseStrategy !== "none",
    startedAt: h.startedAt.toISOString(),
  }));

  return (
    <PageContainer>
      <PageHeader
        eyebrow="SEO"
        title="Site Audit"
        description="Find the technical issues that keep search engines and AI crawlers from understanding your site — broken links, redirects, duplicates, missing tags, thin content and more."
        actions={
          completed.length >= 2 ? (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`/p/${projectId}/seo/audit/compare?a=${completed[1]!.id}&b=${completed[0]!.id}`}>
                <GitCompare className="size-3.5" /> Compare runs
              </Link>
            </Button>
          ) : null
        }
      />

      {latest && (
        <LatestAuditHero
          projectId={projectId}
          audit={{
            id: latest.id,
            startUrl: latest.startUrl,
            score: latest.score,
            pagesCrawled: latest.pagesCrawled,
            completedAt: latest.completedAt?.toISOString() ?? null,
            startedAt: latest.startedAt.toISOString(),
            issueCounts: latest.issueCounts,
          }}
          trend={trend}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <LaunchForm
          projectId={projectId}
          defaultUrl={defaultUrl}
          limits={limits}
          providers={{ psiKey: providers.psi.keyConfigured, dataforseo: providers.dataforseo.configured }}
          canRun={canRun}
          runningAuditId={running?.id ?? null}
        />
        <ScheduleCard
          projectId={projectId}
          kind="site_audit"
          canEdit={canRun}
          defaultUrl={defaultUrl}
          maxPagesLimit={limits.maxPages}
          schedule={
            schedule
              ? {
                  enabled: schedule.enabled,
                  frequency: schedule.frequency,
                  nextRunAt: schedule.nextRunAt.toISOString(),
                  lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
                  config: schedule.config,
                }
              : null
          }
        />
      </div>

      <Panel title="Previous audits" description={`${history.length} audit${history.length === 1 ? "" : "s"} for this project`} icon={<History className="size-4 text-muted-foreground" />} contentClassName="p-3 sm:p-4">
        <HistoryTable projectId={projectId} rows={rows} canRun={canRun} />
      </Panel>
    </PageContainer>
  );
}
