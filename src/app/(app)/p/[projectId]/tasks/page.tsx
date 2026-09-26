import type { Metadata } from "next";
import { requireProject } from "@/server/auth/guards";
import { listProjectMembers, listTasks, getTaskRunState } from "@/server/optimize/tasks/service";
import { listConnectedIntegrations } from "@/server/optimize/integrations";
import { getOptimizeSettings } from "@/server/optimize/settings";
import { TasksView } from "@/features/optimize/tasks/components/tasks-view";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ params }: PageProps<"/p/[projectId]/tasks">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const [tasks, members, connected, runState, settings] = await Promise.all([
    listTasks(projectId),
    listProjectMembers(projectId),
    listConnectedIntegrations(projectId, "pm"),
    getTaskRunState(projectId),
    getOptimizeSettings(projectId),
  ]);
  const can = (p: "prompts.manage" | "settings.manage") => ctx.isInstanceAdmin || ctx.permissions.has(p);
  return (
    <TasksView
      projectId={projectId}
      tasks={tasks}
      members={members}
      connected={connected}
      canEdit={can("prompts.manage")}
      canManage={can("settings.manage")}
      currentUserId={ctx.user.id}
      runState={runState}
      settings={{ routing: settings.routing, autoResolve: settings.autoResolve }}
    />
  );
}
