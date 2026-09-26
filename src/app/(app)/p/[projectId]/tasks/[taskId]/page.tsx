import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { contentPieces } from "@/server/db/schema";
import { requireProject } from "@/server/auth/guards";
import { getTask, listProjectMembers } from "@/server/optimize/tasks/service";
import { listConnectedIntegrations } from "@/server/optimize/integrations";
import { TaskDetail } from "@/features/optimize/tasks/components/task-detail";

export const metadata: Metadata = { title: "Task" };

export default async function TaskPage({ params }: PageProps<"/p/[projectId]/tasks/[taskId]">) {
  const { projectId, taskId } = await params;
  const ctx = await requireProject(projectId);
  const data = await getTask(projectId, taskId);
  if (!data) notFound();
  const [members, connected, contentLinks] = await Promise.all([
    listProjectMembers(projectId),
    listConnectedIntegrations(projectId, "pm"),
    db
      .select({ id: contentPieces.id, title: contentPieces.title, status: contentPieces.status })
      .from(contentPieces)
      .where(and(eq(contentPieces.projectId, projectId), eq(contentPieces.taskId, taskId)))
      .orderBy(desc(contentPieces.updatedAt))
      .limit(10),
  ]);
  const t = data.task;
  const can = (p: "prompts.manage" | "settings.manage") => ctx.isInstanceAdmin || ctx.permissions.has(p);
  return (
    <TaskDetail
      projectId={projectId}
      task={{
        ...t,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        firstDetectedAt: t.firstDetectedAt.toISOString(),
        lastDetectedAt: t.lastDetectedAt.toISOString(),
        resolvedAt: t.resolvedAt?.toISOString() ?? null,
      }}
      activity={data.activity}
      members={members}
      connected={connected}
      canEdit={can("prompts.manage")}
      canManage={can("settings.manage")}
      contentLinks={contentLinks}
    />
  );
}
