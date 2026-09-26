import { PageContainer, PageHeader } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getFilterOptions } from "@/server/ai/insights/brands";
import { parseInsightFilter } from "@/server/ai/insights/filters";
import { getAdsOverview } from "@/server/ai/insights/ads";
import { InsightFilters } from "@/features/ai-insights/components/insight-filters";
import { AnswerSheet } from "@/features/ai-insights/components/answer-sheet";
import { AdsView } from "@/features/ai-insights/components/ads/ads-view";

export const metadata = { title: "Ads" };

export default async function AdsPage({ params, searchParams }: PageProps<"/p/[projectId]/ai/ads">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const f = parseInsightFilter(projectId, await searchParams);
  const [data, options] = await Promise.all([getAdsOverview(ctx.project, f), getFilterOptions(ctx.project)]);
  return (
    <PageContainer>
      <PageHeader title="Ads" description="Paid placements AI engines show for your prompts — who advertises, with which creatives, and how often." />
      <InsightFilters options={options} />
      <AdsView projectId={projectId} data={data} />
      <AnswerSheet projectId={projectId} />
    </PageContainer>
  );
}
