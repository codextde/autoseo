import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { TrackerOverview } from "@/features/ai-tracking/components/tracker-overview";
import { PromptTable } from "@/features/ai-tracking/components/prompt-table";
import { EngineConfigBanner, LastRunBadge, RunNowButton } from "@/features/ai-tracking/components/run-controls";
import { loadTrackerData, type SearchParams } from "@/features/ai-tracking/queries";

export const metadata: Metadata = { title: "Tracker" };

export default async function TrackerPage({ params, searchParams }: PageProps<"/p/[projectId]/ai/tracker">) {
  const { projectId } = await params;
  const sp = (await searchParams) as SearchParams;
  const ctx = await requireProject(projectId, "project.view");
  const project = ctx.project;
  const data = await loadTrackerData({ id: project.id, workspaceId: project.workspaceId, engines: project.engines ?? [], country: project.country }, sp);

  const base = `/p/${projectId}`;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) search.set(k, v);
  const exportParams = new URLSearchParams();
  for (const k of ["status", "tloc", "teng", "tperiod", "ttags", "q"]) {
    const v = search.get(k);
    if (v) exportParams.set(k, v);
  }

  return (
    <PageContainer>
      <PageHeader
        title="Tracker"
        description="How often AI assistants mention and cite your brand for the prompts you track."
        actions={
          <>
            <LastRunBadge run={data.latestRun} />
            <RunNowButton projectId={projectId} />
          </>
        }
      />
      <EngineConfigBanner engines={data.availability} enabled={project.engines ?? []} isAdmin={ctx.isInstanceAdmin} />
      <TrackerOverview
        view={data.view}
        basePath={`${base}/ai/tracker`}
        searchString={search.toString()}
        period={data.period.preset}
        from={data.period.preset === "custom" ? data.period.from : undefined}
        to={data.period.preset === "custom" ? data.period.to : undefined}
        kpi={data.kpi}
        engines={data.engines}
        tags={data.tagSel}
        compare={data.compare}
        brandName={project.name}
        engineOptions={project.engines ?? []}
        tagOptions={data.tags}
        competitorOptions={data.comps}
        kpis={data.kpis}
        series={data.series}
        prevSeries={data.prevSeries}
        compareSeries={data.compareSeries}
        promptsPerDay={data.promptsPerDay}
        markers={data.markers}
        flow={data.flow}
        countries={data.countries}
        modelsHref={`${base}/ai/models`}
      />
      <PromptTable
        projectId={projectId}
        rows={data.rows}
        tags={data.tags}
        engines={data.availability}
        enabledEngines={project.engines ?? []}
        countries={data.promptCountries}
        status={data.status}
        usage={data.usage}
        frequency={project.trackingFrequency}
        defaultCountry={project.country}
        links={{ models: `${base}/ai/models`, research: `${base}/ai/prompt-research`, fanouts: `${base}/ai/tracker/fanouts` }}
        exportHref={`${base}/ai/tracker/export${exportParams.size ? `?${exportParams}` : ""}`}
      />
    </PageContainer>
  );
}
