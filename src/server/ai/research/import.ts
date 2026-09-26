import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { promptResearchItems } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { availableLlmProviders } from "@/server/ai/llm";
import { countItems, lengthOf, MAX_ITEMS_PER_LIST } from "./lists";
import { deriveKeyword, rescoreList } from "./enrich";

export const ENRICH_JOB = "ai_research.enrich_volumes";

export const importRowSchema = z.object({
  text: z.string().trim().min(3).max(1000),
  topic: z.string().trim().max(120).nullish(),
  funnelStage: z.string().trim().max(40).nullish(),
  persona: z.string().trim().max(160).nullish(),
  intent: z.string().trim().max(60).nullish(),
  branded: z.union([z.boolean(), z.string()]).nullish(),
  volume: z.union([z.number(), z.string()]).nullish(),
  keyword: z.string().trim().max(80).nullish(),
});

export type ImportRow = z.infer<typeof importRowSchema>;

export function normalizeFunnel(v: string | null | undefined): "tofu" | "mofu" | "bofu" | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (/tofu|top|aware|informational|problem/.test(s)) return "tofu";
  if (/mofu|mid|consider|compar|evaluat/.test(s)) return "mofu";
  if (/bofu|bottom|decision|purchase|transact|conver/.test(s)) return "bofu";
  return null;
}

function parseBool(v: boolean | string | null | undefined): boolean {
  if (typeof v === "boolean") return v;
  return /^(1|true|yes|ja|y|x|branded)$/i.test((v ?? "").trim());
}

/** "1.300" / "1,300" / "1 300" → 1300, "2,5k" → 2500, "12.5" → 13 */
export function parseVolume(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  let s = String(v).trim().toLowerCase().replace(/\s/g, "");
  let mult = 1;
  if (/k$/.test(s)) {
    mult = 1000;
    s = s.slice(0, -1);
  } else if (/m$/.test(s)) {
    mult = 1_000_000;
    s = s.slice(0, -1);
  }
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");
  else s = s.replace(",", ".");
  const digits = s.replace(/[^\d.]/g, "");
  if (!/\d/.test(digits)) return null;
  const n = Number(digits) * mult;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** Imports prompt rows into a list (dedupes by text) and queues volume enrichment when possible. */
export async function importItems(projectId: string, listId: string, rows: ImportRow[], userId: string | null): Promise<{ imported: number; duplicates: number; enriching: boolean }> {
  const existing = await db.select({ text: promptResearchItems.text }).from(promptResearchItems).where(eq(promptResearchItems.listId, listId));
  const seen = new Set(existing.map((e) => e.text.trim().replace(/\s+/g, " ").toLowerCase()));
  const room = MAX_ITEMS_PER_LIST - (await countItems(listId));
  if (room <= 0) throw new Error(`This list already holds ${MAX_ITEMS_PER_LIST} prompts.`);
  const values: (typeof promptResearchItems.$inferInsert)[] = [];
  let duplicates = 0;
  for (const raw of rows) {
    const r = importRowSchema.parse(raw);
    const text = r.text.replace(/\s+/g, " ");
    const key = text.toLowerCase();
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    const volume = parseVolume(r.volume);
    values.push({
      listId,
      projectId,
      text,
      topic: r.topic || null,
      funnelStage: normalizeFunnel(r.funnelStage),
      persona: r.persona || null,
      intent: r.intent || null,
      branded: parseBool(r.branded),
      length: lengthOf(text),
      volume,
      volumeSource: volume != null ? "import" : null,
      keyword: r.keyword?.toLowerCase() || deriveKeyword(text) || null,
      source: "import",
      details: {},
    });
    if (values.length >= room) break;
  }
  for (let i = 0; i < values.length; i += 500) await db.insert(promptResearchItems).values(values.slice(i, i + 500));
  let enriching = false;
  const needVolume = values.some((v) => v.volume == null);
  if (needVolume && ((await isDataForSeoConfigured()) || (await availableLlmProviders()).length)) {
    const job = await enqueueJob(ENRICH_JOB, { projectId, listId, userId }, { projectId, createdBy: userId, dedupeKey: `prompt-research-enrich:${listId}`, maxAttempts: 1 });
    enriching = Boolean(job);
  } else {
    await rescoreList(projectId, listId);
  }
  return { imported: values.length, duplicates, enriching };
}
