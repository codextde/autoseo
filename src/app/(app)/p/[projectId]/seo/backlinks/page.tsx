import { PageContainer, PageHeader } from "@/components/app/page";
import { listSearchHistory } from "@/server/seo";
import { clientPageInfo, loadSeoPage } from "@/features/seo/server/page-context";
import { BacklinksView } from "@/features/seo/components/backlinks/backlinks-view";

export const metadata = { title: "Backlinks" };

export default async function BacklinksPage({ params }: PageProps<"/p/[projectId]/seo/backlinks">) {
  const { projectId } = await params;
  const info = await loadSeoPage(projectId);
  const history = await listSearchHistory(info.ctx, "backlinks");
  return (
    <PageContainer>
      <PageHeader eyebrow="SEO" title="Backlinks" description="Understand who links to a site, what changed recently, and which pages attract links." />
      <BacklinksView info={clientPageInfo(info)} initialHistory={history} />
    </PageContainer>
  );
}
