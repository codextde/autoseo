import { PageContainer, PageHeader } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getFilterOptions } from "@/server/ai/insights/brands";
import { filterQuery, param, parseInsightFilter } from "@/server/ai/insights/filters";
import { getSourcesOverview } from "@/server/ai/insights/sources";
import { InsightFilters } from "@/features/ai-insights/components/insight-filters";
import { SourcesView } from "@/features/ai-insights/components/sources/sources-view";

export const metadata = { title: "Sources" };

export default async function SourcesPage({ params, searchParams }: PageProps<"/p/[projectId]/ai/sources">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const sp = await searchParams;
  const f = parseInsightFilter(projectId, sp);
  const group = param(sp, "group") === "domain" ? "domain" : "url";
  const [data, options] = await Promise.all([getSourcesOverview(ctx.project, f, group), getFilterOptions(ctx.project)]);
  return (
    <PageContainer>
      <PageHeader title="Sources" description="The pages AI engines cite when answering your prompts — and where you need to be listed." />
      <InsightFilters options={options} />
      <SourcesView projectId={projectId} data={data} query={filterQuery(f)} />
    </PageContainer>
  );
}
