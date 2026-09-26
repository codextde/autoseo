import { PageContainer } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { loadPromptResearch } from "@/features/ai-research/queries";
import { PromptResearchView } from "@/features/ai-research/components/prompt-research/prompt-research-view";

export const metadata = { title: "Prompt Research" };

export default async function PromptResearchPage({ params, searchParams }: PageProps<"/p/[projectId]/ai/prompt-research">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const sp = await searchParams;
  const listParam = typeof sp.list === "string" ? sp.list : undefined;
  const data = await loadPromptResearch(projectId, listParam);
  return (
    <PageContainer wide>
      <PromptResearchView
        key={data.active.id}
        projectId={projectId}
        lists={data.lists}
        active={data.active}
        items={data.items}
        quota={data.quota}
        providers={{ dataforseo: data.providers.dataforseo, llm: data.providers.llm }}
        brandContext={data.brandContext}
        brandName={data.brandName}
        suggestions={data.suggestions}
        project={data.project}
        canManage={ctx.permissions.has("prompts.manage")}
      />
    </PageContainer>
  );
}
