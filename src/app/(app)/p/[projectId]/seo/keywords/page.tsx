import { PageContainer, PageHeader } from "@/components/app/page";
import { listSearchHistory } from "@/server/seo";
import { clientPageInfo, loadSeoPage } from "@/features/seo/server/page-context";
import { KeywordResearchView } from "@/features/seo/components/keywords/keyword-research-view";

export const metadata = { title: "Keyword Research" };

export default async function KeywordResearchPage({ params }: PageProps<"/p/[projectId]/seo/keywords">) {
  const { projectId } = await params;
  const info = await loadSeoPage(projectId);
  const history = await listSearchHistory(info.ctx, "keywords");
  return (
    <PageContainer wide>
      <PageHeader eyebrow="SEO" title="Keyword Research" description="Discover keyword ideas, search demand, and ranking opportunities." />
      <KeywordResearchView info={clientPageInfo(info)} initialHistory={history} />
    </PageContainer>
  );
}
