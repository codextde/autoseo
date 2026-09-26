import "server-only";
import { z } from "zod";
import { TASK_CATEGORIES, TASK_STATUSES } from "@/server/db/schema";
import { getTask, listTasks, taskCounts } from "@/server/optimize/tasks/service";
import { ApiError } from "./errors";

/** Optimization tasks (optimize module) exposed read-only via REST v1 and MCP. */
export const tasksQuery = z.object({
  status: z
    .enum([...TASK_STATUSES, "active", "all"] as [string, ...string[]])
    .default("active")
    .describe("open | in_progress | done | dismissed | active (open + in_progress) | all"),
  category: z.enum(TASK_CATEGORIES).optional(),
  minImpact: z.coerce.number().int().min(1).max(10).optional().describe("Only tasks with impact ≥ this (1–10)."),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listTasksForApi(projectId: string, q: z.infer<typeof tasksQuery>) {
  const [all, counts] = await Promise.all([listTasks(projectId), taskCounts(projectId)]);
  let items = all;
  if (q.status === "active") items = items.filter((t) => t.status === "open" || t.status === "in_progress");
  else if (q.status !== "all") items = items.filter((t) => t.status === q.status);
  if (q.category) items = items.filter((t) => t.category === q.category);
  if (q.minImpact) items = items.filter((t) => t.impact >= q.minImpact!);
  if (q.search?.trim()) {
    const s = q.search.trim().toLowerCase();
    items = items.filter((t) => t.title.toLowerCase().includes(s) || t.summary.toLowerCase().includes(s));
  }
  const total = items.length;
  return {
    counts,
    items: items.slice((q.page - 1) * q.limit, q.page * q.limit),
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}

export async function getTaskForApi(projectId: string, taskId: string) {
  const res = await getTask(projectId, taskId);
  if (!res) throw new ApiError("not_found", "Task not found.");
  const t = res.task;
  return {
    id: t.id,
    title: t.title,
    summary: t.summary,
    description: t.description,
    category: t.category,
    status: t.status,
    resolution: t.resolution,
    impact: t.impact,
    effort: t.effort,
    priority: t.priority,
    signal: t.signal,
    signalActive: t.signalActive,
    source: t.source,
    steps: t.steps,
    acceptanceCriteria: t.acceptanceCriteria,
    contentPlan: t.contentPlan,
    targetUrls: t.targetUrls,
    targetPrompts: t.targetPrompts,
    evidence: t.evidence,
    assigneeId: t.assigneeId,
    dueDate: t.dueDate,
    external: t.external,
    writtenBy: t.writtenBy,
    firstDetectedAt: t.firstDetectedAt.toISOString(),
    lastDetectedAt: t.lastDetectedAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    activity: res.activity.map((a) => ({
      id: a.id,
      kind: a.kind,
      body: a.body,
      createdAt: a.createdAt,
      user: a.userId ? { id: a.userId, name: a.userName, email: a.userEmail } : null,
    })),
  };
}
