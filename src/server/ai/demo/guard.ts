import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projects } from "@/server/db/schema";

/**
 * Demo projects ("Demo · …", generated sample data, `settings.demo = true`) must never sync, crawl,
 * track or call paid providers/LLMs. The job queue uses this to drop every project-scoped job for them.
 */
export function isDemoSettings(settings: unknown): boolean {
  return Boolean(settings && typeof settings === "object" && (settings as { demo?: unknown }).demo === true);
}

const TTL_MS = 60_000;
const cache = new Map<string, { demo: boolean; at: number }>();

export async function isDemoProjectId(projectId: string): Promise<boolean> {
  const hit = cache.get(projectId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.demo;
  const [row] = await db.select({ settings: projects.settings }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const demo = isDemoSettings(row?.settings);
  if (cache.size > 5000) cache.clear();
  cache.set(projectId, { demo, at: Date.now() });
  return demo;
}
