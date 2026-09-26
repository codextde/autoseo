import { PageContainer, PageHeader } from "@/components/app/page";
import { listSearchHistory } from "@/server/seo";
import { clientPageInfo, loadSeoPage } from "@/features/seo/server/page-context";
import { DomainView } from "@/features/seo/components/domain/domain-view";

export const metadata = { title: "Domain Overview" };

export default async function DomainOverviewPage({ params }: PageProps<"/p/[projectId]/seo/domain">) {
  const { projectId } = await params;
  const info = await loadSeoPage(projectId);
  const history = await listSearchHistory(info.ctx, "domain");
  return (
    <PageContainer>
      <PageHeader eyebrow="SEO" title="Domain Overview" description="Analyze any domain's SEO profile: traffic, keywords, and backlinks." />
      <DomainView info={clientPageInfo(info)} initialHistory={history} />
    </PageContainer>
  );
}
