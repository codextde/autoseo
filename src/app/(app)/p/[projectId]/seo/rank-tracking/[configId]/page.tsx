import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import { PageContainer, PageHeader, Panel } from "@/components/app/page";
import { getLatestRankRun, getRankConfig, getRankTrackingResults, SeoError } from "@/server/seo";
import { defaultComparePeriod, type ComparePeriod } from "@/server/seo/lib/rank-tracking";
import { clientPageInfo, loadSeoPage } from "@/features/seo/server/page-context";
import { DataForSeoBanner } from "@/features/seo/components/shared/empty-states";
import { RankDetailView } from "@/features/seo/components/rank/rank-detail-view";

export const metadata = { title: "Rank Tracking" };

const PERIODS: ComparePeriod[] = ["1d", "7d", "30d", "90d"];

export default async function RankTrackingDetailPage({ params, searchParams }: PageProps<"/p/[projectId]/seo/rank-tracking/[configId]">) {
  const { projectId, configId } = await params;
  const sp = await searchParams;
  const info = await loadSeoPage(projectId);

  let config;
  try {
    config = await getRankConfig(info.ctx, configId);
  } catch (err) {
    if (err instanceof SeoError && err.code === "NOT_FOUND") config = null;
    else throw err;
  }

  if (!config) {
    return (
      <PageContainer>
        <PageHeader eyebrow="SEO" title="Rank Tracking" description="Track keyword positions across domains" />
        <Panel>
          <EmptyState
            icon={SearchX}
            title="Domain configuration not found"
            description="This tracker doesn't exist in this project."
            action={
              <Button asChild variant="outline">
                <Link href={`/p/${projectId}/seo/rank-tracking`}>
                  <ArrowLeft /> Back to domains
                </Link>
              </Button>
            }
          />
        </Panel>
      </PageContainer>
    );
  }

  const raw = Array.isArray(sp.compare) ? sp.compare[0] : sp.compare;
  const compare = raw && (PERIODS as string[]).includes(raw) ? (raw as ComparePeriod) : defaultComparePeriod(config.scheduleInterval);
  const [results, latestRun] = await Promise.all([getRankTrackingResults(info.ctx, config.id, compare), getLatestRankRun(info.ctx, config.id)]);

  return (
    <PageContainer>
      <PageHeader eyebrow="SEO" title="Rank Tracking" description="Track keyword positions across domains" />
      {!info.configured && <DataForSeoBanner isAdmin={info.isAdmin} />}
      {!config.isActive && (
        <div className="rounded-xl border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          This domain is archived — scheduled checks are stopped. Add it again from the domain list to reactivate it with its history.
        </div>
      )}
      <RankDetailView
        info={clientPageInfo(info)}
        config={config}
        initialRows={results.rows}
        initialRun={results.run}
        initialLatestRun={latestRun}
      />
    </PageContainer>
  );
}
