"use server";

import { z } from "zod";
import { actionProject, ActionError, runAction } from "@/server/auth/guards";
import { TASK_CATEGORIES, TASK_STATUSES, type TaskCategory } from "@/server/db/schema";
import { enqueueTaskGeneration } from "@/server/optimize/tasks/jobs";
import {
  addTaskComment,
  assignTasks,
  createManualTask,
  deleteManualTasks,
  getTaskRunState,
  setTaskStatus,
  toggleTaskStep,
  updateTask,
} from "@/server/optimize/tasks/service";
import { getOptimizeSettings, saveOptimizeSettings } from "@/server/optimize/settings";
import { emitTaskEvents } from "@/server/optimize/integrations";

const pidSchema = z.string().min(1).max(64);
const idsSchema = z.array(z.string().min(1).max(64)).min(1).max(500);

export async function reanalyzeTasksAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(pidSchema.parse(projectId), "prompts.manage");
    const job = await enqueueTaskGeneration(ctx.project.id, "manual", ctx.user.id);
    return { queued: true, jobId: job?.id ?? null };
  });
}

export async function taskRunStateAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(pidSchema.parse(projectId));
    return getTaskRunState(ctx.project.id);
  });
}

export async function setTaskStatusAction(projectId: string, taskIds: string[], status: string) {
  return runAction(async () => {
    const ctx = await actionProject(pidSchema.parse(projectId), "prompts.manage");
    const s = z.enum(TASK_STATUSES).parse(status);
    const changed = await setTaskStatus(ctx.project.id, idsSchema.parse(taskIds), s, ctx.user.id);
    if (changed.length) await emitTaskEvents(ctx.project.id, s === "done" || s === "dismissed" ? "task.resolved" : "task.updated", changed).catch(() => {});
    return { changed: changed.length };
  });
}

export async function assignTasksAction(projectId: string, taskIds: string[], assigneeId: string | null) {
  return runAction(async () => {
    const ctx = await actionProject(pidSchema.parse(projectId), "prompts.manage");
    const ids = await assignTasks(ctx.project.id, idsSchema.parse(taskIds), z.string().max(64).nullable().parse(assigneeId), ctx.user.id);
    if (ids.length) await emitTaskEvents(ctx.project.id, "task.updated", ids).catch(() => {});
    return { changed: ids.length };
  });
}

export async function toggleTaskStepAction(projectId: string, taskId: string, stepId: string, done: boolean) {
  return runAction(async () => {
    const ctx = await actionProject(pidSchema.parse(projectId), "prompts.manage");
    return toggleTaskStep(ctx.project.id, z.string().max(64).parse(taskId), z.string().max(64).parse(stepId), z.boolean().parse(done), ctx.user.id);
  });
}

export async function commentOnTaskAction(projectId: string, taskId: string, body: string) {
  return runAction(async () => {
    const ctx = await actionProject(pidSchema.parse(projectId), "prompts.manage");
    const text = z.string().trim().min(1, "Write a comment first").max(5000).parse(body);
    await addTaskComment(ctx.project.id, z.string().max(64).parse(taskId), text, ctx.user.id);
    return true;
  });
}

const editSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  summary: z.string().trim().max(600).optional(),
  description: z.string().max(20000).optional(),
  impact: z.number().int().min(1).max(10).optional(),
  effort: z.number().int().min(1).max(10).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  steps: z.array(z.string().trim().min(1).max(600)).max(30).optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(600)).max(20).optional(),
  targetUrls: z.array(z.string().trim().max(2000)).max(30).optional(),
});

export async function updateTaskAction(projectId: string, taskId: string, edit: z.input<typeof editSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(pidSchema.parse(projectId), "prompts.manage");
    const id = z.string().max(64).parse(taskId);
    await updateTask(ctx.project.id, id, editSchema.parse(edit), ctx.user.id);
    await emitTaskEvents(ctx.project.id, "task.updated", [id]).catch(() => {});
    return true;
  });
}

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(20000).default(""),
  category: z.enum(TASK_CATEGORIES),
  impact: z.number().int().min(1).max(10),
  effort: z.number().int().min(1).max(10),
  steps: z.array(z.string().trim().min(1).max(600)).max(30).default([]),
  assigneeId: z.string().max(64).nullable().default(null),
  targetUrls: z.array(z.string().trim().url().max(2000)).max(30).default([]),
});

export async function createTaskAction(projectId: string, input: z.input<typeof createSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(pidSchema.parse(projectId), "prompts.manage");
    const data = createSchema.parse(input);
    const row = await createManualTask(ctx.project.id, data, ctx.user.id);
    await emitTaskEvents(ctx.project.id, "task.created", [row.id]).catch(() => {});
    return { id: row.id };
  });
}

export async function deleteTasksAction(projectId: string, taskIds: string[]) {
  return runAction(async () => {
    const ctx = await actionProject(pidSchema.parse(projectId), "prompts.manage");
    await deleteManualTasks(ctx.project.id, idsSchema.parse(taskIds));
    return true;
  });
}

const routingSchema = z.partialRecord(
  z.enum(TASK_CATEGORIES),
  z.object({
    assigneeId: z.string().max(64).nullable().optional(),
    provider: z.string().max(40).nullable().optional(),
    autoPush: z.boolean().optional(),
  }),
);

export async function saveTaskSettingsAction(projectId: string, input: { routing: z.input<typeof routingSchema>; autoResolve: boolean }) {
  return runAction(async () => {
    const ctx = await actionProject(pidSchema.parse(projectId), "prompts.manage");
    const routing = routingSchema.parse(input.routing) as Partial<Record<TaskCategory, { assigneeId?: string | null; provider?: string | null; autoPush?: boolean }>>;
    const current = await getOptimizeSettings(ctx.project.id);
    const touchesPm = (Object.keys(routing) as TaskCategory[]).some((k) => {
      const next = routing[k];
      const prev = current.routing?.[k];
      return (next?.provider ?? null) !== (prev?.provider ?? null) || !!next?.autoPush !== !!prev?.autoPush;
    });
    if (touchesPm && !ctx.permissions.has("settings.manage"))
      throw new ActionError("Only members with the Integrations permission can route tasks to PM tools.", "forbidden");
    await saveOptimizeSettings(ctx.project.id, { routing, autoResolve: z.boolean().parse(input.autoResolve) });
    return true;
  });
}
