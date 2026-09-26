import "server-only";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  jobs,
  optimizeRuns,
  optimizeTaskActivity,
  optimizeTasks,
  projectMembers,
  projects,
  roles,
  users,
  workspaceMembers,
  type TaskCategory,
  type TaskStatus,
  type TaskStep,
} from "@/server/db/schema";
import { newId } from "@/server/db/schema/_helpers";
import { addTaskActivity } from "./activity";
import { priorityScore } from "./scoring";
import { TASKS_GENERATE_JOB } from "./jobs";

export type Member = { id: string; name: string | null; email: string; avatarUrl: string | null };

export type TaskListItem = {
  id: string;
  title: string;
  summary: string;
  category: TaskCategory;
  status: TaskStatus;
  resolution: "manual" | "auto" | null;
  impact: number;
  effort: number;
  priority: number;
  assigneeId: string | null;
  signalActive: boolean;
  source: "generator" | "manual";
  datasets: string[];
  stepsDone: number;
  stepsTotal: number;
  external: { provider: string; url: string | null }[];
  targetPrompts: string[];
  dueDate: string | null;
  writtenBy: "ai" | "template" | "user";
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  updatedAt: string;
};

function toListItem(t: typeof optimizeTasks.$inferSelect): TaskListItem {
  return {
    id: t.id,
    title: t.title,
    summary: t.summary,
    category: t.category,
    status: t.status,
    resolution: t.resolution,
    impact: t.impact,
    effort: t.effort,
    priority: t.priority,
    assigneeId: t.assigneeId,
    signalActive: t.signalActive,
    source: t.source,
    datasets: Array.isArray(t.signalData?.datasets) ? (t.signalData.datasets as string[]) : [],
    stepsDone: t.steps.filter((s) => s.done).length,
    stepsTotal: t.steps.length,
    external: t.external.map((e) => ({ provider: e.provider, url: e.url ?? null })),
    targetPrompts: t.targetPrompts,
    dueDate: t.dueDate,
    writtenBy: t.writtenBy,
    firstDetectedAt: t.firstDetectedAt.toISOString(),
    lastDetectedAt: t.lastDetectedAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function listTasks(projectId: string): Promise<TaskListItem[]> {
  const rows = await db
    .select()
    .from(optimizeTasks)
    .where(eq(optimizeTasks.projectId, projectId))
    .orderBy(desc(optimizeTasks.priority), desc(optimizeTasks.impact), desc(optimizeTasks.lastDetectedAt))
    .limit(1000);
  return rows.map(toListItem);
}

/** Workspace members who can access the project (assignable users). */
export async function listProjectMembers(projectId: string): Promise<Member[]> {
  const [project] = await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return [];
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl, allProjects: roles.allProjects, perms: roles.permissions, pm: projectMembers.userId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .leftJoin(roles, eq(roles.key, workspaceMembers.roleKey))
    .leftJoin(projectMembers, and(eq(projectMembers.userId, users.id), eq(projectMembers.projectId, projectId)))
    .where(and(eq(workspaceMembers.workspaceId, project.workspaceId), eq(users.status, "active")))
    .orderBy(asc(users.name), asc(users.email));
  return rows
    .filter((r) => r.allProjects || (r.perms ?? []).includes("projects.all") || r.pm)
    .map((r) => ({ id: r.id, name: r.name, email: r.email, avatarUrl: r.avatarUrl }));
}

export async function getTaskRunState(projectId: string) {
  const [lastRun] = await db
    .select()
    .from(optimizeRuns)
    .where(and(eq(optimizeRuns.projectId, projectId), eq(optimizeRuns.kind, "tasks")))
    .orderBy(desc(optimizeRuns.startedAt))
    .limit(1);
  const [pending] = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.type, TASKS_GENERATE_JOB), eq(jobs.projectId, projectId), inArray(jobs.status, ["queued", "running"])))
    .limit(1);
  return {
    running: !!pending || lastRun?.status === "running",
    lastRun: lastRun
      ? {
          status: lastRun.status,
          trigger: lastRun.trigger,
          startedAt: lastRun.startedAt.toISOString(),
          finishedAt: lastRun.finishedAt?.toISOString() ?? null,
          error: lastRun.error,
          stats: lastRun.stats as { created?: number; updated?: number; resolved?: number; reopened?: number; aiQueued?: number },
        }
      : null,
  };
}

export async function getTask(projectId: string, taskId: string) {
  const [task] = await db
    .select()
    .from(optimizeTasks)
    .where(and(eq(optimizeTasks.projectId, projectId), eq(optimizeTasks.id, taskId)))
    .limit(1);
  if (!task) return null;
  const activity = await db
    .select({
      id: optimizeTaskActivity.id,
      kind: optimizeTaskActivity.kind,
      body: optimizeTaskActivity.body,
      meta: optimizeTaskActivity.meta,
      createdAt: optimizeTaskActivity.createdAt,
      userId: optimizeTaskActivity.userId,
      userName: users.name,
      userEmail: users.email,
      userAvatar: users.avatarUrl,
    })
    .from(optimizeTaskActivity)
    .leftJoin(users, eq(users.id, optimizeTaskActivity.userId))
    .where(eq(optimizeTaskActivity.taskId, taskId))
    .orderBy(desc(optimizeTaskActivity.createdAt))
    .limit(200);
  return {
    task,
    activity: activity.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
  };
}

/* ───────────────────────────── Mutations ───────────────────────────── */

async function loadOwned(projectId: string, taskIds: string[]) {
  if (!taskIds.length) return [];
  return db
    .select()
    .from(optimizeTasks)
    .where(and(eq(optimizeTasks.projectId, projectId), inArray(optimizeTasks.id, taskIds)));
}

const STATUS_LABEL: Record<TaskStatus, string> = { open: "Open", in_progress: "In Progress", done: "Done", dismissed: "Dismissed" };

export async function setTaskStatus(projectId: string, taskIds: string[], status: TaskStatus, userId: string) {
  const rows = await loadOwned(projectId, taskIds);
  const changed: string[] = [];
  for (const t of rows) {
    if (t.status === status) continue;
    const resolved = status === "done" || status === "dismissed";
    await db
      .update(optimizeTasks)
      .set({ status, resolution: status === "done" ? "manual" : null, resolvedAt: resolved ? new Date() : null })
      .where(eq(optimizeTasks.id, t.id));
    await addTaskActivity({ taskId: t.id, projectId, kind: "status", userId, body: `${STATUS_LABEL[t.status]} → ${STATUS_LABEL[status]}`, meta: { from: t.status, to: status } });
    changed.push(t.id);
  }
  return changed;
}

export async function assignTasks(projectId: string, taskIds: string[], assigneeId: string | null, userId: string) {
  if (assigneeId) {
    const members = await listProjectMembers(projectId);
    if (!members.some((m) => m.id === assigneeId)) throw new Error("This person has no access to the project.");
  }
  const rows = await loadOwned(projectId, taskIds);
  const [assignee] = assigneeId ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, assigneeId)).limit(1) : [];
  for (const t of rows) {
    if (t.assigneeId === assigneeId) continue;
    await db.update(optimizeTasks).set({ assigneeId }).where(eq(optimizeTasks.id, t.id));
    await addTaskActivity({
      taskId: t.id,
      projectId,
      kind: "assigned",
      userId,
      body: assignee ? `Assigned to ${assignee.name ?? assignee.email}` : "Unassigned",
      meta: { assigneeId },
    });
  }
  return rows.map((r) => r.id);
}

export async function toggleTaskStep(projectId: string, taskId: string, stepId: string, done: boolean, userId: string) {
  const [t] = await loadOwned(projectId, [taskId]);
  if (!t) throw new Error("Task not found");
  const steps: TaskStep[] = t.steps.map((s) => (s.id === stepId ? { ...s, done } : s));
  const step = steps.find((s) => s.id === stepId);
  if (!step) throw new Error("Step not found");
  const patch: Partial<typeof optimizeTasks.$inferInsert> = { steps };
  // First checked step moves an open task into progress.
  if (done && t.status === "open") patch.status = "in_progress";
  await db.update(optimizeTasks).set(patch).where(eq(optimizeTasks.id, t.id));
  await addTaskActivity({ taskId, projectId, kind: "step", userId, body: `${done ? "Completed" : "Reopened"} step: ${step.text}`, meta: { stepId, done } });
  if (patch.status) await addTaskActivity({ taskId, projectId, kind: "status", userId, body: "Open → In Progress", meta: { from: "open", to: "in_progress" } });
  return steps;
}

export async function addTaskComment(projectId: string, taskId: string, body: string, userId: string) {
  const [t] = await loadOwned(projectId, [taskId]);
  if (!t) throw new Error("Task not found");
  await addTaskActivity({ taskId, projectId, kind: "comment", userId, body });
  await db.update(optimizeTasks).set({ updatedAt: new Date() }).where(eq(optimizeTasks.id, t.id));
}

export type TaskEdit = {
  title?: string;
  summary?: string;
  description?: string;
  impact?: number;
  effort?: number;
  dueDate?: string | null;
  steps?: string[];
  acceptanceCriteria?: string[];
  targetUrls?: string[];
};

export async function updateTask(projectId: string, taskId: string, edit: TaskEdit, userId: string) {
  const [t] = await loadOwned(projectId, [taskId]);
  if (!t) throw new Error("Task not found");
  const patch: Partial<typeof optimizeTasks.$inferInsert> = {};
  const textEdited = edit.title !== undefined || edit.summary !== undefined || edit.description !== undefined || edit.steps !== undefined || edit.acceptanceCriteria !== undefined;
  if (edit.title !== undefined) patch.title = edit.title;
  if (edit.summary !== undefined) patch.summary = edit.summary;
  if (edit.description !== undefined) patch.description = edit.description;
  if (edit.acceptanceCriteria !== undefined) patch.acceptanceCriteria = edit.acceptanceCriteria;
  if (edit.targetUrls !== undefined) patch.targetUrls = edit.targetUrls;
  if (edit.dueDate !== undefined) patch.dueDate = edit.dueDate;
  if (edit.steps !== undefined) {
    patch.steps = edit.steps.map((text) => {
      const prev = t.steps.find((s) => s.text === text);
      return { id: prev?.id ?? newId("stp").slice(4), text, done: prev?.done ?? false };
    });
  }
  if (edit.impact !== undefined || edit.effort !== undefined) {
    const impact = edit.impact ?? t.impact;
    const effort = edit.effort ?? t.effort;
    Object.assign(patch, { impact, effort, priority: priorityScore(impact, effort) });
  }
  if (textEdited) patch.writtenBy = "user";
  await db.update(optimizeTasks).set(patch).where(eq(optimizeTasks.id, t.id));
  const what = Object.keys(edit).filter((k) => (edit as Record<string, unknown>)[k] !== undefined);
  await addTaskActivity({
    taskId,
    projectId,
    kind: edit.impact !== undefined || edit.effort !== undefined ? "priority" : "edited",
    userId,
    body: `Edited ${what.join(", ")}`,
    meta: { fields: what },
  });
}

export async function createManualTask(
  projectId: string,
  input: { title: string; description: string; category: TaskCategory; impact: number; effort: number; steps: string[]; assigneeId: string | null; targetUrls: string[] },
  userId: string,
) {
  const [row] = await db
    .insert(optimizeTasks)
    .values({
      projectId,
      fingerprint: `manual:${newId("m")}`,
      signal: "manual",
      category: input.category,
      title: input.title,
      summary: input.description.split("\n")[0]!.slice(0, 280),
      description: input.description,
      steps: input.steps.map((text) => ({ id: newId("stp").slice(4), text, done: false })),
      impact: input.impact,
      effort: input.effort,
      priority: priorityScore(input.impact, input.effort),
      status: "open",
      autoResolvable: false,
      assigneeId: input.assigneeId,
      targetUrls: input.targetUrls,
      writtenBy: "user",
      source: "manual",
      createdBy: userId,
      signalData: { datasets: ["Manual"] },
    })
    .returning();
  await addTaskActivity({ taskId: row!.id, projectId, kind: "created", userId, body: "Created manually." });
  return row!;
}

export async function deleteManualTasks(projectId: string, taskIds: string[]) {
  await db
    .delete(optimizeTasks)
    .where(and(eq(optimizeTasks.projectId, projectId), inArray(optimizeTasks.id, taskIds), eq(optimizeTasks.source, "manual")));
}

export async function taskCounts(projectId: string) {
  const [row] = await db
    .select({
      open: sql<number>`count(*) filter (where ${optimizeTasks.status} = 'open')`.mapWith(Number),
      inProgress: sql<number>`count(*) filter (where ${optimizeTasks.status} = 'in_progress')`.mapWith(Number),
      done30: sql<number>`count(*) filter (where ${optimizeTasks.status} = 'done' and ${optimizeTasks.resolvedAt} > now() - interval '30 days')`.mapWith(Number),
      auto30: sql<number>`count(*) filter (where ${optimizeTasks.status} = 'done' and ${optimizeTasks.resolution} = 'auto' and ${optimizeTasks.resolvedAt} > now() - interval '30 days')`.mapWith(Number),
      highImpact: sql<number>`count(*) filter (where ${optimizeTasks.status} in ('open', 'in_progress') and ${optimizeTasks.impact} >= 7)`.mapWith(Number),
    })
    .from(optimizeTasks)
    .where(eq(optimizeTasks.projectId, projectId));
  return row ?? { open: 0, inProgress: 0, done30: 0, auto30: 0, highImpact: 0 };
}

/** For linking tasks from other pages (e.g. content editor "Created from task"). */
export async function getTaskTitles(projectId: string, ids: string[]) {
  if (!ids.length) return [];
  return db
    .select({ id: optimizeTasks.id, title: optimizeTasks.title })
    .from(optimizeTasks)
    .where(and(eq(optimizeTasks.projectId, projectId), or(...ids.map((id) => eq(optimizeTasks.id, id)))));
}
