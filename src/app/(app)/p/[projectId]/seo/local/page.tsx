import { PageContainer, PageHeader } from "@/components/app/page";
import { listLocalRuns } from "@/server/seo";
import { clientPageInfo, loadSeoPage } from "@/features/seo/server/page-context";
import { LocalSeoView } from "@/features/seo/components/local/local-seo-view";

export const metadata = { title: "Local SEO" };

export default async function LocalSeoPage({ params }: PageProps<"/p/[projectId]/seo/local">) {
  const { projectId } = await params;
  const info = await loadSeoPage(projectId);
  const runs = await listLocalRuns(info.ctx, { limit: 50 });
  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="SEO"
        title="Local SEO"
        description="Google Business Profile & Maps visibility: find listings, check local rankings, map your rank grid and audit reviews, Q&A and posts."
      />
      <LocalSeoView info={clientPageInfo(info)} initialRuns={runs} />
    </PageContainer>
  );
}
