import "server-only";
import { and, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { projects, scQueries, scQueryIntents } from "@/server/db/schema";
import type { JobContext } from "@/server/jobs/types";
import { AiNotConfiguredError, runLlm } from "@/server/ai/llm";
import { addDays, isoDate } from "../period";
import { QUERY_INTENTS } from "./classify";

const BATCH = 60;

const resultSchema = z.object({
  items: z.array(
    z.object({
      query: z.string(),
      intent: z.enum(["recommend", "information", "comparison", "action"]),
      isPrompt: z.boolean(),
    }),
  ),
});

/**
 * Optional LLM refinement of query intents: classifies the top queries (by impressions, last 90
 * days) that don't have an LLM/manual label yet and stores them in `analytics_sc_query_intents`.
 */
export async function refineQueryIntents(payload: { projectId: string; limit?: number }, ctx?: JobContext): Promise<unknown> {
  const { projectId } = payload;
  const limit = Math.max(10, Math.min(1000, payload.limit ?? 300));
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return { skipped: "project_not_found" };

  const since = addDays(isoDate(new Date()), -90);
  const labelled = db
    .select({ query: scQueryIntents.query })
    .from(scQueryIntents)
    .where(and(eq(scQueryIntents.projectId, projectId), inArray(scQueryIntents.source, ["llm", "manual"])));
  const top = await db
    .select({ query: scQueries.query, impressions: sql<number>`sum(${scQueries.impressions})`.mapWith(Number) })
    .from(scQueries)
    .where(and(eq(scQueries.projectId, projectId), gte(scQueries.date, since), notInArray(scQueries.query, labelled)))
    .groupBy(scQueries.query)
    .orderBy(desc(sql`sum(${scQueries.impressions})`))
    .limit(limit);
  if (!top.length) return { classified: 0 };

  let classified = 0;
  const total = Math.ceil(top.length / BATCH);
  for (let i = 0; i < top.length; i += BATCH) {
    if (await ctx?.isCancelled()) break;
    const batch = top.slice(i, i + BATCH).map((t) => t.query);
    let items: z.infer<typeof resultSchema>["items"];
    try {
      const res = await runLlm({
        purpose: "gsc_intent_classification",
        projectId,
        workspaceId: project.workspaceId,
        route: "auto",
        effort: "low",
        system:
          "You classify search queries from Google Search Console. For each query return its intent and whether it reads like a conversational AI prompt.",
        prompt: [
          `Website: ${project.domain}${project.description ? ` — ${project.description}` : ""}.`,
          "Intent definitions:",
          "- recommend: the searcher wants a recommendation or the best option (best, top, which should I…, reviews).",
          "- information: the searcher wants to learn or understand something (how, what, why, guides, definitions).",
          "- comparison: the searcher compares options or looks for alternatives (vs, compare, difference, alternative).",
          "- action: the searcher wants to do something now (buy, price, download, sign up, book, login, near me).",
          "isPrompt = true when the query is a natural-language question or request someone could type into ChatGPT/Perplexity (usually conversational or long); false for short keyword-style queries or navigational brand queries.",
          `Allowed intents: ${QUERY_INTENTS.join(", ")}. Return every query exactly as given.`,
          "Queries:",
          ...batch.map((q, idx) => `${idx + 1}. ${q}`),
        ].join("\n"),
        schema: resultSchema,
        maxTokens: 6000,
      });
      items = res.data.items;
    } catch (err) {
      if (err instanceof AiNotConfiguredError) return { skipped: "ai_not_configured", classified };
      throw err;
    }
    const allowed = new Set(batch);
    const rows = items
      .filter((it) => allowed.has(it.query))
      .map((it) => ({ projectId, query: it.query, intent: it.intent, isPrompt: it.isPrompt, source: "llm" as const }));
    if (rows.length) {
      await db
        .insert(scQueryIntents)
        .values(rows)
        .onConflictDoUpdate({
          target: [scQueryIntents.projectId, scQueryIntents.query],
          set: { intent: sql`excluded.intent`, isPrompt: sql`excluded.is_prompt`, source: sql`excluded.source`, updatedAt: new Date() },
          setWhere: sql`${scQueryIntents.source} <> 'manual'`,
        });
      classified += rows.length;
    }
    await ctx?.progress({ done: i / BATCH + 1, total, classified });
  }
  return { classified };
}
