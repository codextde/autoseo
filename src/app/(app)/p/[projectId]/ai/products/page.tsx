import { PageContainer, PageHeader, TabNav } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getFilterOptions } from "@/server/ai/insights/brands";
import { filterQuery, param, parseInsightFilter } from "@/server/ai/insights/filters";
import { getProductsOverview } from "@/server/ai/insights/products";
import { InsightFilters } from "@/features/ai-insights/components/insight-filters";
import { ProductsView } from "@/features/ai-insights/components/products/products-view";

export const metadata = { title: "Products" };

export default async function ProductsPage({ params, searchParams }: PageProps<"/p/[projectId]/ai/products">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const sp = await searchParams;
  const f = parseInsightFilter(projectId, sp);
  const tab = param(sp, "tab") === "stores" ? "stores" : "products";
  const [data, options] = await Promise.all([getProductsOverview(ctx.project, f), getFilterOptions(ctx.project)]);
  const base = `/p/${projectId}/ai/products`;
  return (
    <PageContainer>
      <PageHeader title="Products" description="Which products AI engines surface and recommend — yours and your competitors' — and where they are sold." />
      <TabNav
        active={tab}
        tabs={[
          { key: "products", label: "Products", href: `${base}${filterQuery(f)}` },
          { key: "stores", label: "Stores", href: `${base}${filterQuery(f, { tab: "stores" })}` },
        ]}
      />
      <InsightFilters options={options} />
      <ProductsView projectId={projectId} data={data} query={filterQuery(f)} tab={tab} />
    </PageContainer>
  );
}
