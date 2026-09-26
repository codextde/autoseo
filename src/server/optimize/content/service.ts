import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  contentPersonas,
  contentPieces,
  contentScoreSnapshots,
  jobs,
  type ContentCitation,
  type ContentEntity,
  type ContentFaq,
  type ContentStatus,
} from "@/server/db/schema";
import { markdownToText, slugify } from "@/server/optimize/markdown";
import { scoreContent } from "./aeo-score";

export type ContentRow = typeof contentPieces.$inferSelect;

export type ContentListItem = {
  id: string;
  title: string;
  kind: "article" | "rewrite";
  status: ContentStatus;
  targetPrompt: string | null;
  targetKeyword: string | null;
  aeoScore: number | null;
  baselineScore: number | null;
  wordCount: number;
  publishedUrl: string | null;
  publishProvider: string | null;
  sourceUrl: string | null;
  generationStage: string | null;
  error: string | null;
  updatedAt: string;
  createdAt: string;
};

export function toContentListItem(r: ContentRow): ContentListItem {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    status: r.status,
    targetPrompt: r.targetPrompt,
    targetKeyword: r.targetKeyword,
    aeoScore: r.aeoScore,
    baselineScore: r.baselineScore,
    wordCount: r.wordCount,
    publishedUrl: r.publishedUrl,
    publishProvider: r.publishProvider,
    sourceUrl: r.sourceUrl,
    generationStage: r.generationStage,
    error: r.error,
    updatedAt: r.updatedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listContent(projectId: string): Promise<ContentListItem[]> {
  const rows = await db.select().from(contentPieces).where(eq(contentPieces.projectId, projectId)).orderBy(desc(contentPieces.updatedAt)).limit(1000);
  return rows.map(toContentListItem);
}

export async function contentDashboard(projectId: string) {
  const [agg] = await db
    .select({
      avg: sql<number | null>`avg(${contentPieces.aeoScore}) filter (where ${contentPieces.status} not in ('generating', 'failed'))`.mapWith((v) => (v == null ? null : Number(v))),
      optimized: sql<number>`count(*) filter (where ${contentPieces.aeoScore} >= 70 and ${contentPieces.status} not in ('generating', 'failed'))`.mapWith(Number),
      primary: sql<number>`count(*) filter (where ${contentPieces.aeoScore} >= 87 and ${contentPieces.status} not in ('generating', 'failed'))`.mapWith(Number),
      published: sql<number>`count(*) filter (where ${contentPieces.status} = 'published')`.mapWith(Number),
      review: sql<number>`count(*) filter (where ${contentPieces.status} = 'in_review')`.mapWith(Number),
      drafts: sql<number>`count(*) filter (where ${contentPieces.status} = 'draft')`.mapWith(Number),
      generating: sql<number>`count(*) filter (where ${contentPieces.status} = 'generating')`.mapWith(Number),
      total: sql<number>`count(*)`.mapWith(Number),
    })
    .from(contentPieces)
    .where(eq(contentPieces.projectId, projectId));

  const improving = await db
    .select({
      id: contentPieces.id,
      title: contentPieces.title,
      score: contentPieces.aeoScore,
      baseline: contentPieces.baselineScore,
      url: contentPieces.publishedUrl,
      sourceUrl: contentPieces.sourceUrl,
    })
    .from(contentPieces)
    .where(and(eq(contentPieces.projectId, projectId), isNotNull(contentPieces.aeoScore), isNotNull(contentPieces.baselineScore)))
    .orderBy(desc(sql`${contentPieces.aeoScore} - ${contentPieces.baselineScore}`))
    .limit(5);

  // Weekly average score trend (from snapshots)
  const trend = (await db.execute(sql`
    select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week, round(avg(score))::int as score, count(distinct content_id)::int as pages
    from content_score_snapshots where project_id = ${projectId} and created_at > now() - interval '120 days'
    group by 1 order by 1`)) as unknown as Array<{ week: string; score: number; pages: number }>;

  return {
    avgScore: agg?.avg == null ? null : Math.round(agg.avg),
    optimized: agg?.optimized ?? 0,
    primary: agg?.primary ?? 0,
    published: agg?.published ?? 0,
    review: agg?.review ?? 0,
    drafts: agg?.drafts ?? 0,
    generating: agg?.generating ?? 0,
    total: agg?.total ?? 0,
    improving: improving
      .filter((r) => (r.score ?? 0) > (r.baseline ?? 0))
      .map((r) => ({ id: r.id, title: r.title, score: r.score!, baseline: r.baseline!, delta: r.score! - r.baseline!, url: r.url ?? r.sourceUrl })),
    trend: trend.map((t) => ({ date: t.week, score: Number(t.score), pages: Number(t.pages) })),
  };
}

export async function getContent(projectId: string, id: string): Promise<ContentRow | null> {
  const [row] = await db
    .select()
    .from(contentPieces)
    .where(and(eq(contentPieces.projectId, projectId), eq(contentPieces.id, id)))
    .limit(1);
  return row ?? null;
}

export function computeScore(row: Pick<ContentRow, "title" | "body" | "metaTitle" | "metaDescription" | "slug" | "schemaJsonLd" | "faqs" | "targetKeyword" | "targetPrompt" | "entities" | "citations">) {
  return scoreContent({
    title: row.title,
    body: row.body,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    slug: row.slug,
    schemaJsonLd: row.schemaJsonLd,
    faqs: row.faqs,
    targetKeyword: row.targetKeyword,
    targetPrompt: row.targetPrompt,
    entities: row.entities,
    citations: row.citations,
  });
}

/** Recomputes score + word count, snapshots the score when it changed. */
export async function rescoreAndSnapshot(row: ContentRow): Promise<{ score: number; pillars: Record<string, number> }> {
  const result = computeScore(row);
  const wordCount = markdownToText(row.body).split(/\s+/).filter(Boolean).length;
  await db
    .update(contentPieces)
    .set({ aeoScore: result.score, pillarScores: result.pillars, wordCount, baselineScore: row.baselineScore ?? result.score })
    .where(eq(contentPieces.id, row.id));
  const [last] = await db
    .select({ score: contentScoreSnapshots.score, createdAt: contentScoreSnapshots.createdAt })
    .from(contentScoreSnapshots)
    .where(eq(contentScoreSnapshots.contentId, row.id))
    .orderBy(desc(contentScoreSnapshots.createdAt))
    .limit(1);
  if (!last || last.score !== result.score) {
    await db.insert(contentScoreSnapshots).values({ contentId: row.id, projectId: row.projectId, score: result.score, pillars: result.pillars });
  }
  return { score: result.score, pillars: result.pillars };
}

export type ContentPatch = {
  title?: string;
  body?: string;
  status?: ContentStatus;
  targetPrompt?: string | null;
  targetKeyword?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  slug?: string | null;
  schemaJsonLd?: string | null;
  faqs?: ContentFaq[];
  entities?: ContentEntity[];
  citations?: ContentCitation[];
  personaId?: string | null;
};

export async function saveContent(projectId: string, id: string, patch: ContentPatch, userId: string) {
  const row = await getContent(projectId, id);
  if (!row) throw new Error("Content not found");
  if (row.status === "generating" && patch.status === undefined) throw new Error("This draft is still being generated.");
  const next = { ...row, ...patch, updatedBy: userId };
  if (patch.slug !== undefined) next.slug = patch.slug ? slugify(patch.slug) : null;
  await db
    .update(contentPieces)
    .set({ ...patch, slug: next.slug, updatedBy: userId })
    .where(eq(contentPieces.id, id));
  const scored = await rescoreAndSnapshot(next);
  return { ...scored, slug: next.slug, updatedAt: new Date().toISOString() };
}

export async function createContent(
  projectId: string,
  input: {
    title: string;
    kind?: "article" | "rewrite";
    status?: ContentStatus;
    targetPrompt?: string | null;
    targetKeyword?: string | null;
    topic?: string | null;
    language?: string;
    personaId?: string | null;
    taskId?: string | null;
    sourceUrl?: string | null;
    brief?: ContentRow["brief"];
    body?: string;
    generationStage?: string | null;
  },
  userId: string | null,
) {
  const [row] = await db
    .insert(contentPieces)
    .values({
      projectId,
      title: input.title,
      kind: input.kind ?? "article",
      status: input.status ?? "draft",
      targetPrompt: input.targetPrompt ?? null,
      targetKeyword: input.targetKeyword ?? null,
      topic: input.topic ?? null,
      language: input.language ?? "en",
      personaId: input.personaId ?? null,
      taskId: input.taskId ?? null,
      sourceUrl: input.sourceUrl ?? null,
      brief: input.brief ?? null,
      body: input.body ?? "",
      slug: slugify(input.targetKeyword || input.title),
      generationStage: input.generationStage ?? null,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning();
  return row!;
}

export async function deleteContent(projectId: string, ids: string[]) {
  await db.delete(contentPieces).where(and(eq(contentPieces.projectId, projectId), inArray(contentPieces.id, ids)));
}

export async function contentJobState(projectId: string, contentId: string) {
  const [row] = await db
    .select({ status: contentPieces.status, stage: contentPieces.generationStage, error: contentPieces.error, updatedAt: contentPieces.updatedAt })
    .from(contentPieces)
    .where(and(eq(contentPieces.projectId, projectId), eq(contentPieces.id, contentId)))
    .limit(1);
  return row ? { ...row, updatedAt: row.updatedAt.toISOString() } : null;
}

export async function scoreHistory(contentId: string) {
  const rows = await db
    .select({ score: contentScoreSnapshots.score, createdAt: contentScoreSnapshots.createdAt })
    .from(contentScoreSnapshots)
    .where(eq(contentScoreSnapshots.contentId, contentId))
    .orderBy(asc(contentScoreSnapshots.createdAt))
    .limit(200);
  return rows.map((r) => ({ date: r.createdAt.toISOString(), score: r.score }));
}

/* ─────────────── Personas ─────────────── */

export async function listPersonas(projectId: string) {
  return db.select().from(contentPersonas).where(eq(contentPersonas.projectId, projectId)).orderBy(asc(contentPersonas.topic), asc(contentPersonas.name));
}

export async function personaJobsRunning(projectId: string) {
  const rows = await db
    .select({ payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.type, "optimize.content.personas"), inArray(jobs.status, ["queued", "running"])));
  return rows.map((r) => String((r.payload as { topic?: string }).topic ?? ""));
}
