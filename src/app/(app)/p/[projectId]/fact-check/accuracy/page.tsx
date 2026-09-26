import { PageContainer, PageHeader } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getAccuracy } from "@/features/optimize/fact-check/queries";
import { FactCheckTabs } from "@/features/optimize/fact-check/components/fc-tabs";
import { AccuracyView } from "@/features/optimize/fact-check/components/accuracy-view";

export const metadata = { title: "Fact Check · Accuracy" };

export default async function AccuracyPage({ params, searchParams }: PageProps<"/p/[projectId]/fact-check/accuracy">) {
  const { projectId } = await params;
  await requireProject(projectId);
  const sp = await searchParams;
  const period = typeof sp.period === "string" && ["30d", "90d", "365d"].includes(sp.period) ? sp.period : "90d";
  const data = await getAccuracy(projectId, period);
  return (
    <PageContainer>
      <PageHeader title="Accuracy" description="Label accuracy of AI answers by model, market and asset." />
      <FactCheckTabs projectId={projectId} active="accuracy" />
      <AccuracyView projectId={projectId} data={data} />
    </PageContainer>
  );
}
