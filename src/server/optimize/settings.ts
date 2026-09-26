import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { optimizeSettings } from "@/server/db/schema";

export type OptimizeSettings = typeof optimizeSettings.$inferSelect;

export async function getOptimizeSettings(projectId: string): Promise<OptimizeSettings> {
  const [row] = await db.select().from(optimizeSettings).where(eq(optimizeSettings.projectId, projectId)).limit(1);
  return row ?? { projectId, routing: {}, autoResolve: true, webhookEvents: true, updatedAt: new Date(0) };
}

export async function saveOptimizeSettings(projectId: string, patch: Partial<Omit<OptimizeSettings, "projectId" | "updatedAt">>) {
  const current = await getOptimizeSettings(projectId);
  const values = { ...current, ...patch, projectId, updatedAt: new Date() };
  await db
    .insert(optimizeSettings)
    .values(values)
    .onConflictDoUpdate({ target: optimizeSettings.projectId, set: { routing: values.routing, autoResolve: values.autoResolve, webhookEvents: values.webhookEvents, updatedAt: new Date() } });
  return values;
}
