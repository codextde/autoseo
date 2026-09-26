import type { Metadata } from "next";
import { requireProject } from "@/server/auth/guards";
import { availableLlmProviders } from "@/server/ai/llm";
import { contentDashboard, listContent, listPersonas, personaJobsRunning } from "@/server/optimize/content/service";
import { listConnectedIntegrations } from "@/server/optimize/integrations";
import { ContentView } from "@/features/optimize/content/components/content-view";

export const metadata: Metadata = { title: "Content" };

export default async function ContentPage({ params }: PageProps<"/p/[projectId]/content">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const [items, dashboard, personas, personaJobs, connected, llm] = await Promise.all([
    listContent(projectId),
    contentDashboard(projectId),
    listPersonas(projectId),
    personaJobsRunning(projectId),
    listConnectedIntegrations(projectId, "cms"),
    availableLlmProviders().catch(() => []),
  ]);
  const can = (p: "prompts.manage" | "settings.manage") => ctx.isInstanceAdmin || ctx.permissions.has(p);
  return (
    <ContentView
      projectId={projectId}
      domain={ctx.project.domain}
      language={ctx.project.language}
      items={items}
      dashboard={dashboard}
      personas={personas}
      personaJobs={personaJobs}
      connected={connected}
      canEdit={can("prompts.manage")}
      canManage={can("settings.manage")}
      aiAvailable={llm.length > 0}
    />
  );
}
