import { notFound } from "next/navigation";
import { PageContainer } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getFilterOptions } from "@/server/ai/insights/brands";
import { getCompetitorDetail } from "@/server/ai/insights/competitors";
import { filterQuery, parseInsightFilter } from "@/server/ai/insights/filters";
import { InsightFilters } from "@/features/ai-insights/components/insight-filters";
import { AnswerSheet } from "@/features/ai-insights/components/answer-sheet";
import { CompetitorDetailView } from "@/features/ai-insights/components/competitors/competitor-detail";

export const metadata = { title: "Competitor analysis" };

export default async function CompetitorDetailPage({ params, searchParams }: PageProps<"/p/[projectId]/ai/competitors/[competitorId]">) {
  const { projectId, competitorId } = await params;
  const ctx = await requireProject(projectId);
  if (!/^[a-z0-9_-]{1,64}$/i.test(competitorId)) notFound();
  const f = parseInsightFilter(projectId, await searchParams);
  const [data, options] = await Promise.all([getCompetitorDetail(ctx.project, f, competitorId), getFilterOptions(ctx.project)]);
  if (!data) notFound();
  return (
    <PageContainer>
      <CompetitorDetailView
        projectId={projectId}
        data={data}
        canManage={ctx.permissions.has("prompts.manage")}
        query={filterQuery(f)}
        filters={<InsightFilters key="insight-filters" options={options} />}
      />
      <AnswerSheet projectId={projectId} />
    </PageContainer>
  );
}
