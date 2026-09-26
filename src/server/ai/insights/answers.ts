import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiAnswers, aiCitations, aiMentions, aiSources, aiStatements, prompts } from "@/server/db/schema";
import type { AnswerDetail } from "@/features/ai-insights/types";

/** Full answer with its brand mentions, citations and statements (project-scoped). */
export async function getAnswerDetail(projectId: string, answerId: string): Promise<AnswerDetail | null> {
  const [row] = await db
    .select({ answer: aiAnswers, promptText: prompts.text })
    .from(aiAnswers)
    .innerJoin(prompts, eq(prompts.id, aiAnswers.promptId))
    .where(and(eq(aiAnswers.projectId, projectId), eq(aiAnswers.id, answerId)))
    .limit(1);
  if (!row) return null;
  const a = row.answer;
  const [mentions, citations, statements] = await Promise.all([
    db
      .select()
      .from(aiMentions)
      .where(and(eq(aiMentions.projectId, projectId), eq(aiMentions.answerId, answerId)))
      .orderBy(asc(aiMentions.position)),
    db
      .select({ c: aiCitations, s: aiSources })
      .from(aiCitations)
      .innerJoin(aiSources, eq(aiSources.id, aiCitations.sourceId))
      .where(and(eq(aiCitations.projectId, projectId), eq(aiCitations.answerId, answerId)))
      .orderBy(asc(aiCitations.position)),
    db
      .select()
      .from(aiStatements)
      .where(and(eq(aiStatements.projectId, projectId), eq(aiStatements.answerId, answerId))),
  ]);
  return {
    id: a.id,
    promptId: a.promptId,
    promptText: row.promptText,
    engine: a.engine,
    model: a.model,
    country: a.country,
    date: a.answerDate,
    text: a.text,
    brandMentioned: a.brandMentioned,
    brandCited: a.brandCited,
    brandPosition: a.brandPosition,
    sentiment: a.sentiment,
    mentions: mentions.map((m) => ({
      name: m.brandName,
      isOwn: m.isOwn,
      competitorId: m.competitorId,
      position: m.position,
      sentiment: m.sentiment,
      cited: m.cited,
      recommended: m.recommended,
    })),
    citations: citations.map(({ c, s }) => ({
      url: s.url,
      domain: s.domain,
      title: s.title,
      position: c.position,
      ownership: s.ownership,
      sourceId: s.id,
    })),
    statements: statements.map((s) => ({ brandName: s.brandName, polarity: s.polarity, attribute: s.attribute, quote: s.quote })),
  };
}
