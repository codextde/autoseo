import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/server/db/client";
import { events } from "@/server/db/schema";

/** Appends to the audit log. Never throws — logging must not break the flow it records. */
export async function logEvent(
  type: string,
  opts: { userId?: string | null; instanceId?: string | null; data?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await db.insert(events).values({
      type,
      userId: opts.userId ?? null,
      instanceId: opts.instanceId ?? null,
      data: opts.data ?? {},
    });
  } catch (err) {
    console.error(`[events] failed to record ${type}`, err);
  }
}

export async function latestEvents(limit = 200) {
  return db.select().from(events).orderBy(desc(events.createdAt)).limit(limit);
}
