import { notFound } from "next/navigation";
import { PageContainer } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getFilterOptions } from "@/server/ai/insights/brands";
import { filterQuery, parseInsightFilter } from "@/server/ai/insights/filters";
import { getProductDetail } from "@/server/ai/insights/products";
import { InsightFilters } from "@/features/ai-insights/components/insight-filters";
import { AnswerSheet } from "@/features/ai-insights/components/answer-sheet";
import { ProductDetailView } from "@/features/ai-insights/components/products/product-detail";

export const metadata = { title: "Product" };

export default async function ProductDetailPage({ params, searchParams }: PageProps<"/p/[projectId]/ai/products/[productId]">) {
  const { projectId, productId } = await params;
  const ctx = await requireProject(projectId);
  if (!/^[a-z0-9_-]{1,64}$/i.test(productId)) notFound();
  const f = parseInsightFilter(projectId, await searchParams);
  const [data, options] = await Promise.all([getProductDetail(ctx.project, f, productId), getFilterOptions(ctx.project)]);
  if (!data) notFound();
  return (
    <PageContainer>
      <ProductDetailView projectId={projectId} data={data} query={filterQuery(f)} filters={<InsightFilters key="insight-filters" options={options} />} />
      <AnswerSheet projectId={projectId} />
    </PageContainer>
  );
}
