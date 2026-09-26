import { PageContainer, PageHeader } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getFindings, parseFindingsFilters } from "@/features/optimize/fact-check/queries";
import { FactCheckTabs } from "@/features/optimize/fact-check/components/fc-tabs";
import { FindingsView } from "@/features/optimize/fact-check/components/findings-view";

export const metadata = { title: "Fact Check · Findings" };

export default async function FindingsPage({ params, searchParams }: PageProps<"/p/[projectId]/fact-check/findings">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const filters = parseFindingsFilters(await searchParams);
  const data = await getFindings(projectId, filters);
  return (
    <PageContainer>
      <PageHeader
        title="Findings"
        description="Statements in AI answers that deviate from your reference documents — triage, resolve or ignore them."
      />
      <FactCheckTabs projectId={projectId} active="findings" />
      <FindingsView projectId={projectId} data={data} canEdit={ctx.permissions.has("prompts.manage")} />
    </PageContainer>
  );
}
