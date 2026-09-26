import { requireProject } from "@/server/auth/guards";
import { CrawlabilityScreen } from "@/features/crawlability/components/screen";

export default async function CrawlabilityPage({ params, searchParams }: PageProps<"/p/[projectId]/crawlability">) {
  const { projectId } = await params;
  const sp = await searchParams;
  const ctx = await requireProject(projectId, "project.view");
  return <CrawlabilityScreen ctx={ctx} checkId={null} tab={typeof sp.tab === "string" ? sp.tab : undefined} />;
}
