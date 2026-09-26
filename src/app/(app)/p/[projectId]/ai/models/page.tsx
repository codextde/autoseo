import type { Metadata } from "next";
import { and, eq, sql } from "drizzle-orm";
import { PageContainer, PageHeader } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { db } from "@/server/db/client";
import { prompts } from "@/server/db/schema";
import { getLatestRun, getTrackingCost } from "@/server/ai/metrics";
import { engineAvailabilityView } from "@/features/ai-tracking/queries";
import { ModelsView } from "@/features/ai-tracking/components/models-view";

export const metadata: Metadata = { title: "Model Settings" };

export default async function ModelSettingsPage({ params }: PageProps<"/p/[projectId]/ai/models">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId, "project.view");
  const project = ctx.project;
  const [engines, latestRun, cost30d, active] = await Promise.all([
    engineAvailabilityView(project.workspaceId),
    getLatestRun(projectId),
    getTrackingCost(projectId, 30),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(prompts)
      .where(and(eq(prompts.projectId, projectId), eq(prompts.status, "active")))
      .then((r) => r[0]?.n ?? 0),
  ]);
  return (
    <PageContainer>
      <PageHeader title="Model Settings" description="Choose which AI models track your prompts, how often and from which market." />
      <ModelsView
        projectId={projectId}
        engines={engines}
        enabled={project.engines ?? []}
        frequency={project.trackingFrequency}
        country={project.country}
        language={project.language}
        latestRun={latestRun}
        cost30d={cost30d}
        isAdmin={ctx.isInstanceAdmin}
        activePrompts={Number(active)}
      />
    </PageContainer>
  );
}
