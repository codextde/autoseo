import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projects, promptResearchItems, prompts } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { activePromptCount, addTrackedPrompts } from "@/server/ai/tracking/prompts";
import { startTrackingRun } from "@/server/ai/tracking/runs";

function key(text: string, country: string) {
  return `${country.toUpperCase()}|${text.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

export async function trackerQuota(projectId: string): Promise<{ used: number; limit: number; frequency: string }> {
  const [[project], limits, used] = await Promise.all([
    db.select({ trackingFrequency: projects.trackingFrequency }).from(projects).where(eq(projects.id, projectId)).limit(1),
    getSetting("limits"),
    activePromptCount(projectId),
  ]);
  return { used, limit: limits.maxPromptsPerProject, frequency: project?.trackingFrequency ?? "daily" };
}

/**
 * Adds research items to the tracker (as `prompts` rows tagged with their topic) and links them
 * back to the research items. Existing identical prompts are linked instead of duplicated.
 */
export async function addItemsToTracker(
  projectId: string,
  itemIds: string[],
  userId: string | null,
): Promise<{ added: number; linked: number; skippedOverLimit: number }> {
  if (!itemIds.length) return { added: 0, linked: 0, skippedOverLimit: 0 };
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found.");
  const items = await db
    .select()
    .from(promptResearchItems)
    .where(and(eq(promptResearchItems.projectId, projectId), inArray(promptResearchItems.id, itemIds), isNull(promptResearchItems.trackedPromptId)));
  if (!items.length) return { added: 0, linked: 0, skippedOverLimit: 0 };

  const res = await addTrackedPrompts({
    projectId,
    source: "research",
    userId,
    prompts: items.map((i) => ({
      text: i.text,
      country: project.country,
      language: project.language,
      topic: i.topic,
      funnelStage: i.funnelStage,
      branded: i.branded,
      persona: i.persona,
      volume: i.volume,
      tags: i.topic ? [i.topic] : [],
    })),
  });

  // Map every item to its (new or pre-existing) tracked prompt.
  const existing = await db.select({ id: prompts.id, text: prompts.text, country: prompts.country }).from(prompts).where(eq(prompts.projectId, projectId));
  const byKey = new Map(existing.map((p) => [key(p.text, p.country), p.id]));
  const createdSet = new Set(res.created);
  let linked = 0;
  const now = new Date();
  for (const i of items) {
    const promptId = byKey.get(key(i.text, project.country));
    if (!promptId) continue;
    if (!createdSet.has(promptId)) linked++;
    await db.update(promptResearchItems).set({ trackedPromptId: promptId, addedAt: now }).where(eq(promptResearchItems.id, i.id));
  }
  await syncTrackedState(projectId);
  if (res.created.length) {
    try {
      await startTrackingRun({ projectId, trigger: "prompt_added", promptIds: res.created, userId });
    } catch (err) {
      console.warn("[prompt-research] first tracking run not started:", err instanceof Error ? err.message : err);
    }
  }
  return { added: res.created.length, linked, skippedOverLimit: res.skippedOverLimit };
}

/**
 * Keeps research items in sync with the tracker: clears links to prompts that were deleted and
 * links items whose text is already tracked (same prompt in several lists, prompts added elsewhere).
 */
export async function syncTrackedState(projectId: string) {
  await db.execute(sql`
    UPDATE prompt_research_items i SET tracked_prompt_id = NULL, added_at = NULL
    WHERE i.project_id = ${projectId} AND i.tracked_prompt_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM prompts p WHERE p.id = i.tracked_prompt_id)`);
  await db.execute(sql`
    UPDATE prompt_research_items i SET tracked_prompt_id = p.id, added_at = COALESCE(i.added_at, p.created_at)
    FROM prompts p, projects pr
    WHERE i.project_id = ${projectId} AND i.tracked_prompt_id IS NULL
      AND pr.id = ${projectId} AND p.project_id = ${projectId} AND p.country = pr.country
      AND lower(regexp_replace(btrim(i.text), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(btrim(p.text), '[[:space:]]+', ' ', 'g'))`);
}

/** Adds a free-text prompt (Prompt Explorer "Track this prompt"). */
export async function trackPromptText(projectId: string, text: string, userId: string | null, tags: string[] = []) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found.");
  const res = await addTrackedPrompts({
    projectId,
    source: "manual",
    userId,
    prompts: [{ text, country: project.country, language: project.language, tags }],
  });
  if (res.created.length) {
    try {
      await startTrackingRun({ projectId, trigger: "prompt_added", promptIds: res.created, userId });
    } catch (err) {
      console.warn("[prompt-explorer] first tracking run not started:", err instanceof Error ? err.message : err);
    }
  }
  return res;
}
