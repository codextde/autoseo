import { notFound } from "next/navigation";
import { PageContainer } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getFilterOptions } from "@/server/ai/insights/brands";
import { filterQuery, parseInsightFilter } from "@/server/ai/insights/filters";
import { getSourceDetail } from "@/server/ai/insights/sources";
import { InsightFilters } from "@/features/ai-insights/components/insight-filters";
import { AnswerSheet } from "@/features/ai-insights/components/answer-sheet";
import { SourceDetailView } from "@/features/ai-insights/components/sources/source-detail";

export const metadata = { title: "Source analysis" };

/** `sourceId` is either a source id (`src_…`, one URL) or a domain (all pages of that domain). */
export default async function SourceDetailPage({ params, searchParams }: PageProps<"/p/[projectId]/ai/sources/[sourceId]">) {
  const { projectId, sourceId } = await params;
  const ctx = await requireProject(projectId);
  const key = decodeURIComponent(sourceId).trim().toLowerCase();
  if (!key || key.length > 253) notFound();
  const f = parseInsightFilter(projectId, await searchParams);
  const [data, options] = await Promise.all([getSourceDetail(ctx.project, f, key), getFilterOptions(ctx.project)]);
  if (!data) notFound();
  return (
    <PageContainer>
      <SourceDetailView projectId={projectId} data={data} query={filterQuery(f)} filters={<InsightFilters key="insight-filters" options={options} />} />
      <AnswerSheet projectId={projectId} />
    </PageContainer>
  );
}
