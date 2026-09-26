import { requireProject } from "@/server/auth/guards";
import { CrawlabilityScreen } from "@/features/crawlability/components/screen";

export default async function CrawlabilityCheckPage({ params, searchParams }: PageProps<"/p/[projectId]/crawlability/[checkId]">) {
  const { projectId, checkId } = await params;
  const sp = await searchParams;
  const ctx = await requireProject(projectId, "project.view");
  return <CrawlabilityScreen ctx={ctx} checkId={checkId} tab={typeof sp.tab === "string" ? sp.tab : undefined} />;
}
