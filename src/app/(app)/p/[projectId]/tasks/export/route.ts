import { getProjectContext } from "@/server/auth/context";
import { csvResponse, toCsv } from "@/server/optimize/csv";
import { listProjectMembers, listTasks } from "@/server/optimize/tasks/service";
import { TASK_CATEGORY_META, TASK_STATUS_META } from "@/features/optimize/constants";
import { env } from "@/server/env";

export async function GET(req: Request, ctx: RouteContext<"/p/[projectId]/tasks/export">) {
  const { projectId } = await ctx.params;
  const project = await getProjectContext(projectId);
  if (!project) return new Response("Not found", { status: 404 });
  const status = new URL(req.url).searchParams.get("status") ?? "all";
  const [tasks, members] = await Promise.all([listTasks(projectId), listProjectMembers(projectId)]);
  const memberMap = new Map(members.map((m) => [m.id, m.name ?? m.email]));
  const rows = tasks
    .filter((t) =>
      status === "active" ? t.status === "open" || t.status === "in_progress" : status === "all" ? true : t.status === status,
    )
    .map((t) => [
      t.title,
      TASK_CATEGORY_META[t.category].label,
      TASK_STATUS_META[t.status].label,
      Math.round(t.priority),
      t.impact,
      t.effort,
      t.assigneeId ? (memberMap.get(t.assigneeId) ?? "") : "",
      t.summary,
      t.datasets.join("; "),
      `${t.stepsDone}/${t.stepsTotal}`,
      t.targetPrompts.join("; "),
      t.external.map((e) => e.url ?? e.provider).join("; "),
      t.firstDetectedAt.slice(0, 10),
      t.resolvedAt?.slice(0, 10) ?? "",
      t.resolution ?? "",
      `${env.appUrl}/p/${projectId}/tasks/${t.id}`,
    ]);
  const csv = toCsv(
    ["Title", "Category", "Status", "Priority", "Impact", "Effort", "Assignee", "Summary", "Datasets", "Steps done", "Target prompts", "External links", "Detected", "Resolved", "Resolution", "URL"],
    rows,
  );
  return csvResponse(`tasks-${project.project.domain}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
