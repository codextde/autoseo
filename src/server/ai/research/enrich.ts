import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { projects, promptResearchItems } from "@/server/db/schema";
import { availableLlmProviders, runLlm } from "@/server/ai/llm";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { fetchKeywordVolumes, normalizeKeyword, volumeScores } from "./keywords";
import type { ResearchItemDetails } from "@/features/ai-research/types";

const QUESTION_WORDS = new Set(
  "viel viele lohnt sich gibt what which who whom whose where when why how is are do does can could should would will best top good vs versus compare comparison between for the a an of to in on with my me i we our your and or near most welche welcher welches was wer wo wann warum wie ist sind gibt es kann können sollte soll beste besten bester gute guten gut im in am an auf für mit von zu der die das den dem des ein eine einen und oder mein meine ich wir unser vergleich zwischen lohnt sich quel quelle quels est sont comment pourquoi meilleur meilleure pour avec le la les un une des et ou".split(
    " ",
  ),
);

/** Heuristic topic keyword for a prompt (used when no LLM-provided keyword exists). */
export function deriveKeyword(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !QUESTION_WORDS.has(w));
  return words.slice(0, 4).join(" ");
}

const estimateSchema = z.object({ ratings: z.array(z.object({ id: z.number().int(), relativeVolume: z.number() })) });

/**
 * Fills volume data for research items of a list: DataForSEO search volumes for each item's topic
 * keyword when configured, otherwise an LLM-estimated relative demand (labelled "estimated").
 * Re-computes the 0..1 bar score across the whole list afterwards.
 */
export async function enrichListVolumes(
  projectId: string,
  listId: string,
  opts: { userId?: string | null; onlyMissing?: boolean; progress?: (m: string) => Promise<void> } = {},
): Promise<{ source: "dataforseo" | "estimated" | "none"; updated: number }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found.");
  const items = await db
    .select()
    .from(promptResearchItems)
    .where(and(eq(promptResearchItems.projectId, projectId), eq(promptResearchItems.listId, listId)));
  const targets = items.filter((i) => i.volumeSource !== "import" && (!opts.onlyMissing || i.volumeSource == null));
  let source: "dataforseo" | "estimated" | "none" = "none";
  let updated = 0;

  if (targets.length && (await isDataForSeoConfigured())) {
    source = "dataforseo";
    await opts.progress?.(`Fetching search volumes for ${targets.length} topic keywords`);
    for (const i of targets) if (!i.keyword) i.keyword = deriveKeyword(i.text);
    const metrics = await fetchKeywordVolumes(
      targets.map((i) => i.keyword!).filter(Boolean),
      project.country,
      project.language,
      { projectId, workspaceId: project.workspaceId, userId: opts.userId ?? null, feature: "prompt_research_volume" },
    );
    for (const i of targets) {
      const m = i.keyword ? metrics.get(normalizeKeyword(i.keyword)) : undefined;
      const details: ResearchItemDetails = {
        ...((i.details ?? {}) as ResearchItemDetails),
        keywordMetrics: { searchVolume: m?.volume ?? null, cpc: m?.cpc ?? null, difficulty: m?.difficulty ?? null, intent: m?.intent ?? null },
        trend: m?.monthly.slice(-12) ?? [],
      };
      await db
        .update(promptResearchItems)
        .set({ keyword: i.keyword, volume: m?.volume ?? 0, volumeSource: "dataforseo", details })
        .where(eq(promptResearchItems.id, i.id));
      updated++;
    }
  } else if (targets.length) {
    const needEstimate = targets.filter((i) => typeof (i.details as Record<string, unknown>)?.relativeVolume !== "number");
    if (needEstimate.length && (await availableLlmProviders()).length) {
      await opts.progress?.(`Estimating relative demand for ${needEstimate.length} prompts`);
      for (let b = 0; b < needEstimate.length; b += 60) {
        const batch = needEstimate.slice(b, b + 60);
        const res = await runLlm({
          purpose: "prompt_research_volume_estimate",
          timeoutMs: 15 * 60_000,
          projectId,
          workspaceId: project.workspaceId,
          userId: opts.userId ?? null,
          prompt: `Rate how often people in ${project.country} ask questions like these to AI assistants / search engines, on a 1–10 scale (10 = extremely common, 1 = very niche). Be conservative and consistent.\n\n${batch
            .map((i, idx) => `${idx}: ${i.text}`)
            .join("\n")}`,
          schema: estimateSchema,
          maxTokens: 4000,
        });
        for (const r of res.data.ratings) {
          const item = batch[r.id];
          if (item) item.details = { ...(item.details ?? {}), relativeVolume: Math.max(1, Math.min(10, r.relativeVolume)) };
        }
      }
    }
    for (const i of targets) {
      const rel = (i.details as Record<string, unknown>)?.relativeVolume;
      if (typeof rel !== "number") continue;
      source = "estimated";
      await db
        .update(promptResearchItems)
        .set({
          volumeSource: "estimated",
          volume: null,
          keyword: i.keyword ?? deriveKeyword(i.text),
          details: { ...((i.details ?? {}) as Record<string, unknown>), estimatedLabel: "Estimated relative demand (AI) — connect DataForSEO for search volumes" },
        })
        .where(eq(promptResearchItems.id, i.id));
      updated++;
    }
  }
  await rescoreList(projectId, listId);
  return { source, updated };
}

/** Recomputes the 10-segment bar score for all items of a list. */
export async function rescoreList(projectId: string, listId: string) {
  const items = await db
    .select({ id: promptResearchItems.id, volume: promptResearchItems.volume, volumeSource: promptResearchItems.volumeSource, details: promptResearchItems.details })
    .from(promptResearchItems)
    .where(and(eq(promptResearchItems.projectId, projectId), eq(promptResearchItems.listId, listId)));
  const measured = items.filter((i) => i.volumeSource === "dataforseo" || (i.volumeSource === "import" && i.volume != null));
  const scores = volumeScores(measured.map((i) => i.volume));
  const updates = new Map<string, number | null>();
  measured.forEach((i, idx) => updates.set(i.id, scores[idx] ?? null));
  for (const i of items) {
    if (updates.has(i.id)) continue;
    const rel = (i.details as Record<string, unknown>)?.relativeVolume;
    updates.set(i.id, typeof rel === "number" && i.volumeSource === "estimated" ? rel / 10 : null);
  }
  // Group identical scores to keep the number of UPDATE statements small.
  const byScore = new Map<string, string[]>();
  for (const [id, score] of updates) {
    const k = score == null ? "null" : score.toFixed(4);
    if (!byScore.has(k)) byScore.set(k, []);
    byScore.get(k)!.push(id);
  }
  for (const [k, ids] of byScore) {
    for (let i = 0; i < ids.length; i += 500) {
      await db
        .update(promptResearchItems)
        .set({ volumeScore: k === "null" ? null : Number(k) })
        .where(inArray(promptResearchItems.id, ids.slice(i, i + 500)));
    }
  }
}
