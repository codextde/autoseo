import { PageContainer } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getLookup } from "@/server/ai/lookup/history";
import { loadLookups } from "@/features/ai-research/queries";
import { BrandLookupView } from "@/features/ai-research/components/lookup/brand-lookup-view";
import { getCountry } from "@/lib/countries";
import type { BrandLookupParams, BrandLookupResult } from "@/features/ai-research/types";

export const metadata = { title: "Brand Lookup" };

export default async function BrandLookupPage({ params, searchParams }: PageProps<"/p/[projectId]/ai/brand-lookup">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const sp = await searchParams;
  const id = typeof sp.id === "string" ? sp.id : null;
  const [data, row] = await Promise.all([loadLookups(projectId, "brand_lookup"), id ? getLookup(projectId, id) : Promise.resolve(null)]);
  const current =
    row && row.kind === "brand_lookup"
      ? {
          id: row.id,
          status: row.status,
          error: row.error,
          costUsd: row.costUsd,
          createdAt: row.createdAt.toISOString(),
          params: row.params as unknown as BrandLookupParams,
          result: row.status === "done" ? (row.result as unknown as BrandLookupResult) : null,
        }
      : null;
  const country = getCountry(ctx.project.country);
  return (
    <PageContainer wide>
      <BrandLookupView
        key={current?.id ?? "new"}
        projectId={projectId}
        history={data.history}
        dataforseo={data.providers.dataforseo}
        canRun={ctx.permissions.has("seo.run")}
        defaults={{ query: ctx.project.domain, country: country && !country.googleAdsOnly ? country.iso : "US" }}
        cost={data.cost}
        current={current}
      />
    </PageContainer>
  );
}
