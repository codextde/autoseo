import type { Metadata } from "next";
import { requireProject } from "@/server/auth/guards";
import { getAgentPageData } from "@/server/chat/page-data";
import { AgentHome } from "@/features/chat/components/agent-home";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage({ params }: PageProps<"/p/[projectId]/agent">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId, "project.view");
  const data = await getAgentPageData(ctx);
  return (
    <AgentHome
      projectId={projectId}
      userName={data.userName}
      modelOptions={data.modelOptions}
      canChat={data.canChat}
      examples={data.examples}
      routeHint={data.routeHint}
    />
  );
}
