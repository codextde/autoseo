import "server-only";
import { db } from "@/server/db/client";
import { optimizeTaskActivity } from "@/server/db/schema";

type ActivityKind = (typeof optimizeTaskActivity.$inferInsert)["kind"];

/** Appends an entry to a task's activity feed (never throws). */
export async function addTaskActivity(input: {
  taskId: string;
  projectId: string;
  kind: ActivityKind;
  body?: string | null;
  meta?: Record<string, unknown>;
  userId?: string | null;
}) {
  try {
    await db.insert(optimizeTaskActivity).values({
      taskId: input.taskId,
      projectId: input.projectId,
      kind: input.kind,
      body: input.body ?? null,
      meta: input.meta ?? {},
      userId: input.userId ?? null,
    });
  } catch (err) {
    console.error("[optimize] failed to write task activity", err);
  }
}
