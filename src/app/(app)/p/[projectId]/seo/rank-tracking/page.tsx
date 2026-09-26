import { PageContainer, PageHeader } from "@/components/app/page";
import { listRankConfigSummaries } from "@/server/seo";
import { clientPageInfo, loadSeoPage } from "@/features/seo/server/page-context";
import { DataForSeoBanner } from "@/features/seo/components/shared/empty-states";
import { RankDomainList } from "@/features/seo/components/rank/rank-domain-list";

export const metadata = { title: "Rank Tracking" };

export default async function RankTrackingPage({ params }: PageProps<"/p/[projectId]/seo/rank-tracking">) {
  const { projectId } = await params;
  const info = await loadSeoPage(projectId);
  const configs = await listRankConfigSummaries(info.ctx);
  return (
    <PageContainer>
      <PageHeader eyebrow="SEO" title="Rank Tracking" description="Track keyword positions across domains" />
      {!info.configured && <DataForSeoBanner isAdmin={info.isAdmin} />}
      <RankDomainList info={clientPageInfo(info)} configs={configs} />
    </PageContainer>
  );
}
