import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { optimizeTasks } from "@/server/db/schema";

/** Number of open optimization tasks (Open + In Progress) for the sidebar "Open Tasks" badge. */
export async function countOpenTasks(projectId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(optimizeTasks)
    .where(and(eq(optimizeTasks.projectId, projectId), inArray(optimizeTasks.status, ["open", "in_progress"])));
  return row?.n ?? 0;
}
