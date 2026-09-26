import "server-only";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { promptTagLinks, promptTags, prompts, projects } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { getCountry } from "@/lib/countries";
import { ENGINE_MAP } from "@/lib/engines";
import { TrackingError } from "./runs";

const TAG_COLORS = ["#16a34a", "#2563eb", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#65a30d", "#ca8a04", "#4f46e5", "#dc2626"];

export type NewPromptInput = {
  text: string;
  country?: string | null;
  language?: string | null;
  tags?: string[];
  topic?: string | null;
  funnelStage?: "tofu" | "mofu" | "bofu" | null;
  branded?: boolean;
  persona?: string | null;
  volume?: number | null;
};

/** Normalizes prompt text for duplicate detection. */
function promptKey(text: string, country: string) {
  return `${country.toUpperCase()}|${text.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

export async function ensureTags(projectId: string, names: string[]): Promise<Map<string, string>> {
  const clean = [...new Set(names.map((n) => n.trim().slice(0, 60)).filter(Boolean))];
  const out = new Map<string, string>();
  if (!clean.length) return out;
  const existing = await db.select().from(promptTags).where(eq(promptTags.projectId, projectId));
  const byLower = new Map(existing.map((t) => [t.name.toLowerCase(), t]));
  let colorIdx = existing.length;
  for (const name of clean) {
    const hit = byLower.get(name.toLowerCase());
    if (hit) {
      out.set(name, hit.id);
      continue;
    }
    const [row] = await db
      .insert(promptTags)
      .values({ projectId, name, color: TAG_COLORS[colorIdx++ % TAG_COLORS.length] })
      .onConflictDoUpdate({ target: [promptTags.projectId, promptTags.name], set: { name } })
      .returning();
    out.set(name, row!.id);
    byLower.set(name.toLowerCase(), row!);
  }
  return out;
}

export async function activePromptCount(projectId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(prompts)
    .where(and(eq(prompts.projectId, projectId), eq(prompts.status, "active")));
  return Number(row?.n ?? 0);
}

/**
 * Adds tracked prompts (dedupes against existing prompts of the same market), creates tags and
 * enforces Admin → Limits (max prompts per project). Returns the created prompt ids.
 */
export async function addTrackedPrompts(input: {
  projectId: string;
  prompts: NewPromptInput[];
  engines?: string[] | null;
  source?: "manual" | "research" | "gsc" | "import" | "generated" | "api";
  userId?: string | null;
}): Promise<{ created: string[]; duplicates: number; skippedOverLimit: number }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) throw new TrackingError("Project not found.");
  const limits = await getSetting("limits");
  const existing = await db
    .select({ text: prompts.text, country: prompts.country })
    .from(prompts)
    .where(eq(prompts.projectId, project.id));
  const seen = new Set(existing.map((p) => promptKey(p.text, p.country)));
  let room = Math.max(0, limits.maxPromptsPerProject - (await activePromptCount(project.id)));
  const engines = input.engines?.length ? input.engines.filter((e) => ENGINE_MAP.has(e as never)) : null;

  const allTags = [...new Set(input.prompts.flatMap((p) => p.tags ?? []))];
  const tagIds = await ensureTags(project.id, allTags);

  const created: string[] = [];
  let duplicates = 0;
  let skippedOverLimit = 0;
  for (const p of input.prompts) {
    const text = p.text.trim().replace(/\s+/g, " ").slice(0, 2000);
    if (text.length < 3) continue;
    const country = (getCountry(p.country ?? "")?.iso ?? project.country).toUpperCase();
    const language = p.language || (country === project.country ? project.language : (getCountry(country)?.language ?? project.language));
    const key = promptKey(text, country);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    if (room <= 0) {
      skippedOverLimit++;
      continue;
    }
    seen.add(key);
    room--;
    const [row] = await db
      .insert(prompts)
      .values({
        projectId: project.id,
        text,
        country,
        language,
        topic: p.topic ?? null,
        funnelStage: p.funnelStage ?? null,
        branded: p.branded ?? false,
        persona: p.persona ?? null,
        volume: p.volume ?? null,
        source: input.source ?? "manual",
        engines,
        createdBy: input.userId ?? null,
      })
      .returning({ id: prompts.id });
    created.push(row!.id);
    const links = (p.tags ?? []).map((t) => tagIds.get(t.trim().slice(0, 60))).filter((id): id is string => !!id);
    if (links.length) await db.insert(promptTagLinks).values(links.map((tagId) => ({ promptId: row!.id, tagId }))).onConflictDoNothing();
  }
  return { created, duplicates, skippedOverLimit };
}

async function ownedPromptIds(projectId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.projectId, projectId), inArray(prompts.id, ids)));
  return rows.map((r) => r.id);
}

export async function setPromptStatus(projectId: string, ids: string[], status: "active" | "archived"): Promise<number> {
  const owned = await ownedPromptIds(projectId, ids);
  if (!owned.length) return 0;
  if (status === "active") {
    const limits = await getSetting("limits");
    const active = await activePromptCount(projectId);
    if (active + owned.length > limits.maxPromptsPerProject)
      throw new TrackingError(`Prompt limit reached (${limits.maxPromptsPerProject} active prompts per project).`);
  }
  await db
    .update(prompts)
    .set({ status, archivedAt: status === "archived" ? new Date() : null })
    .where(and(eq(prompts.projectId, projectId), inArray(prompts.id, owned)));
  return owned.length;
}

export async function deletePrompts(projectId: string, ids: string[]): Promise<number> {
  const owned = await ownedPromptIds(projectId, ids);
  if (!owned.length) return 0;
  await db.delete(prompts).where(and(eq(prompts.projectId, projectId), inArray(prompts.id, owned)));
  return owned.length;
}

/** add: link tags; clear: remove all tags from the prompts; set: replace. */
export async function applyPromptTags(projectId: string, ids: string[], tagNames: string[], mode: "add" | "clear" | "set"): Promise<number> {
  const owned = await ownedPromptIds(projectId, ids);
  if (!owned.length) return 0;
  if (mode === "clear" || mode === "set") await db.delete(promptTagLinks).where(inArray(promptTagLinks.promptId, owned));
  if (mode !== "clear" && tagNames.length) {
    const tagIds = [...(await ensureTags(projectId, tagNames)).values()];
    await db
      .insert(promptTagLinks)
      .values(owned.flatMap((promptId) => tagIds.map((tagId) => ({ promptId, tagId }))))
      .onConflictDoNothing();
  }
  return owned.length;
}

export async function updatePromptEngines(projectId: string, ids: string[], engines: string[] | null): Promise<number> {
  const owned = await ownedPromptIds(projectId, ids);
  if (!owned.length) return 0;
  const clean = engines?.filter((e) => ENGINE_MAP.has(e as never)) ?? null;
  await db
    .update(prompts)
    .set({ engines: clean?.length ? clean : null })
    .where(and(eq(prompts.projectId, projectId), inArray(prompts.id, owned)));
  return owned.length;
}

export async function listPromptTags(projectId: string) {
  return db
    .select({
      id: promptTags.id,
      name: promptTags.name,
      color: promptTags.color,
      count: sql<number>`(select count(*)::int from ${promptTagLinks} where ${promptTagLinks.tagId} = ${promptTags.id})`,
    })
    .from(promptTags)
    .where(eq(promptTags.projectId, projectId))
    .orderBy(promptTags.name);
}

export { parseCsv, parsePromptCsv, type CsvPromptRow } from "@/features/ai-tracking/csv";
