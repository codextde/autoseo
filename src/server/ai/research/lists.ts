import "server-only";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { promptResearchItems, promptResearchLists } from "@/server/db/schema";
import type { ResearchItem, ResearchList } from "@/features/ai-research/types";

export const DEFAULT_LIST_NAME = "Default List";
export const MAX_LISTS = 50;
export const MAX_ITEMS_PER_LIST = 2000;

type ListRow = typeof promptResearchLists.$inferSelect;
type ItemRow = typeof promptResearchItems.$inferSelect;

function toList(r: ListRow, itemCount: number): ResearchList {
  return {
    id: r.id,
    name: r.name,
    isDefault: r.isDefault,
    source: r.source,
    status: r.status,
    jobId: r.jobId,
    error: r.error,
    itemCount,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toItem(r: ItemRow): ResearchItem {
  return {
    id: r.id,
    listId: r.listId,
    text: r.text,
    topic: r.topic,
    funnelStage: r.funnelStage,
    persona: r.persona,
    intent: r.intent,
    branded: r.branded,
    competitorMentioned: r.competitorMentioned,
    length: r.length,
    volumeScore: r.volumeScore,
    volume: r.volume,
    volumeSource: r.volumeSource,
    keyword: r.keyword,
    trackedPromptId: r.trackedPromptId,
    addedAt: r.addedAt?.toISOString() ?? null,
    source: r.source,
    details: (r.details ?? {}) as ResearchItem["details"],
    createdAt: r.createdAt.toISOString(),
  };
}

export async function getLists(projectId: string): Promise<ResearchList[]> {
  const rows = await db
    .select()
    .from(promptResearchLists)
    .where(eq(promptResearchLists.projectId, projectId))
    .orderBy(desc(promptResearchLists.isDefault), asc(promptResearchLists.createdAt));
  if (!rows.length) return [];
  const counts = await db
    .select({ listId: promptResearchItems.listId, n: count() })
    .from(promptResearchItems)
    .where(inArray(promptResearchItems.listId, rows.map((r) => r.id)))
    .groupBy(promptResearchItems.listId);
  const map = new Map(counts.map((c) => [c.listId, c.n]));
  return rows.map((r) => toList(r, map.get(r.id) ?? 0));
}

export async function getListRow(projectId: string, listId: string) {
  const [row] = await db
    .select()
    .from(promptResearchLists)
    .where(and(eq(promptResearchLists.id, listId), eq(promptResearchLists.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

/** Returns the default list, creating "Default List" when the project has none. */
export async function ensureDefaultList(projectId: string): Promise<ListRow> {
  const [existing] = await db
    .select()
    .from(promptResearchLists)
    .where(and(eq(promptResearchLists.projectId, projectId), eq(promptResearchLists.isDefault, true)))
    .limit(1);
  if (existing) return existing;
  const [any] = await db.select().from(promptResearchLists).where(eq(promptResearchLists.projectId, projectId)).orderBy(asc(promptResearchLists.createdAt)).limit(1);
  if (any) {
    await db.update(promptResearchLists).set({ isDefault: true }).where(eq(promptResearchLists.id, any.id));
    return { ...any, isDefault: true };
  }
  const [row] = await db.insert(promptResearchLists).values({ projectId, name: DEFAULT_LIST_NAME, isDefault: true, source: "generated" }).returning();
  return row!;
}

export async function createList(projectId: string, name: string, source: "generated" | "import" | "manual", userId: string | null): Promise<ListRow> {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(promptResearchLists).where(eq(promptResearchLists.projectId, projectId));
  if (n >= MAX_LISTS) throw new Error(`A project can have at most ${MAX_LISTS} prompt lists.`);
  const [row] = await db
    .insert(promptResearchLists)
    .values({ projectId, name: name.trim().slice(0, 120) || "Untitled list", isDefault: n === 0, source, createdBy: userId })
    .returning();
  return row!;
}

export async function renameList(projectId: string, listId: string, name: string) {
  const [row] = await db
    .update(promptResearchLists)
    .set({ name: name.trim().slice(0, 120) })
    .where(and(eq(promptResearchLists.id, listId), eq(promptResearchLists.projectId, projectId)))
    .returning();
  if (!row) throw new Error("List not found.");
  return row;
}

export async function setDefaultList(projectId: string, listId: string) {
  const row = await getListRow(projectId, listId);
  if (!row) throw new Error("List not found.");
  await db.update(promptResearchLists).set({ isDefault: false }).where(eq(promptResearchLists.projectId, projectId));
  await db.update(promptResearchLists).set({ isDefault: true }).where(eq(promptResearchLists.id, listId));
}

/** Deletes a list (and its items). The oldest remaining list becomes the default. */
export async function deleteList(projectId: string, listId: string) {
  const row = await getListRow(projectId, listId);
  if (!row) throw new Error("List not found.");
  if (row.status === "generating") throw new Error("This list is still being generated. Wait until it finishes.");
  await db.delete(promptResearchLists).where(eq(promptResearchLists.id, listId));
  if (row.isDefault) {
    const [next] = await db.select().from(promptResearchLists).where(eq(promptResearchLists.projectId, projectId)).orderBy(asc(promptResearchLists.createdAt)).limit(1);
    if (next) await db.update(promptResearchLists).set({ isDefault: true }).where(eq(promptResearchLists.id, next.id));
  }
}

export async function getItems(projectId: string, listId: string): Promise<ResearchItem[]> {
  const rows = await db
    .select()
    .from(promptResearchItems)
    .where(and(eq(promptResearchItems.listId, listId), eq(promptResearchItems.projectId, projectId)))
    .orderBy(asc(promptResearchItems.topic), desc(promptResearchItems.volumeScore), asc(promptResearchItems.createdAt));
  return rows.map(toItem);
}

export async function deleteItems(projectId: string, itemIds: string[]) {
  if (!itemIds.length) return;
  await db.delete(promptResearchItems).where(and(eq(promptResearchItems.projectId, projectId), inArray(promptResearchItems.id, itemIds)));
}

export async function countItems(listId: string) {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(promptResearchItems).where(eq(promptResearchItems.listId, listId));
  return n;
}

/** Classifies prompt length by word count. */
export function lengthOf(text: string): "short" | "medium" | "long" {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words <= 8 ? "short" : words <= 18 ? "medium" : "long";
}
