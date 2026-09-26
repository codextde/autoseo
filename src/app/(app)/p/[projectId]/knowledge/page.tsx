import { PageContainer } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { loadKnowledge } from "@/features/ai-research/queries";
import { KnowledgeView } from "@/features/ai-research/components/knowledge/knowledge-view";
import type { KnowledgeKind } from "@/features/ai-research/types";

export const metadata = { title: "Brand Knowledge" };

const TABS: KnowledgeKind[] = ["interest", "sitemap", "personas", "products", "profile"];

export default async function KnowledgePage({ params, searchParams }: PageProps<"/p/[projectId]/knowledge">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const sp = await searchParams;
  const tab = TABS.includes(sp.tab as KnowledgeKind) ? (sp.tab as KnowledgeKind) : "interest";
  const data = await loadKnowledge(projectId);
  return (
    <PageContainer wide>
      <KnowledgeView
        projectId={projectId}
        tab={tab}
        domain={ctx.project.domain}
        all={data.all}
        profile={data.profile}
        stream={data.stream}
        products={data.products}
        notes={data.notes}
        providers={{ dataforseo: data.providers.dataforseo, llm: data.providers.llm }}
        pushEndpoint={data.pushEndpoint}
        canManage={ctx.permissions.has("prompts.manage")}
        canEditProfile={ctx.permissions.has("projects.manage")}
        canManageSettings={ctx.permissions.has("settings.manage")}
      />
    </PageContainer>
  );
}
