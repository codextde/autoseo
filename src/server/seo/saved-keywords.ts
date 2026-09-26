import "server-only";
import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { jobs, seoKeywordMetrics, seoSavedKeywords, seoSavedKeywordTagAssignments, seoSavedKeywordTags } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { assertCanRun, SeoError, type SeoContext } from "./context";
import { fetchKeywordMetricsForList, upsertKeywordMetrics } from "./keywords";
import { KEYWORD_INTENTS, normalizeIntent, normalizeKeyword, type KeywordIntent, type MonthlySearch } from "./lib/keywords";
import { resolveMarket } from "./lib/locations";
import { isTagColorKey, MAX_TAG_LENGTH, MAX_TAGS_PER_OPERATION, normalizeTags, TAG_COLOR_KEYS, type TagColorKey } from "./lib/tags";

export const SAVED_PAGE_SIZES = [50, 100, 250] as const;
export const SAVED_SORT_FIELDS = ["createdAt", "keyword", "searchVolume", "cpc", "competition", "keywordDifficulty", "fetchedAt"] as const;
export type SavedSortField = (typeof SAVED_SORT_FIELDS)[number];

export type SavedKeywordTag = { id: string; name: string; normalizedName: string; color: string | null };
export type SavedKeywordTagSummary = SavedKeywordTag & { keywordCount: number };
export type SavedKeywordRow = {
  id: string;
  keyword: string;
  locationCode: number;
  languageCode: string;
  createdAt: Date;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  keywordDifficulty: number | null;
  intent: KeywordIntent | null;
  monthlySearches: MonthlySearch[];
  fetchedAt: Date | null;
  tags: SavedKeywordTag[];
};

const metricSchema = z.object({
  keyword: z.string().min(1).max(200),
  searchVolume: z.number().nullable().optional(),
  cpc: z.number().nullable().optional(),
  competition: z.number().nullable().optional(),
  keywordDifficulty: z.number().nullable().optional(),
  intent: z.string().nullable().optional(),
  monthlySearches: z.array(z.object({ year: z.number(), month: z.number(), searchVolume: z.number() })).optional(),
});

export const saveKeywordsInput = z
  .object({
    keywords: z.array(z.string().min(1).max(200)).min(1).max(500),
    locationCode: z.number().int().positive().optional(),
    languageCode: z.string().min(2).max(8).optional(),
    tags: z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_OPERATION).optional(),
    tagMode: z.enum(["append", "replace"]).default("append"),
    metrics: z.array(metricSchema).max(500).optional(),
  })
  .refine((v) => v.tagMode !== "replace" || (v.tags?.length ?? 0) > 0, { message: "Replacement tags are required when tagMode is replace." });

/** Normalize + dedupe keywords, upsert provided metrics, insert (ON CONFLICT DO NOTHING), apply tags. No DataForSEO call. */
export async function saveKeywords(ctx: SeoContext, raw: z.input<typeof saveKeywordsInput>) {
  const input = saveKeywordsInput.parse(raw);
  const market = resolveMarket(input, ctx.market);
  const keywords = [...new Set(input.keywords.map(normalizeKeyword).filter(Boolean))];
  const metrics = (input.metrics ?? []).filter((m) => keywords.includes(normalizeKeyword(m.keyword)));
  if (metrics.length) {
    await upsertKeywordMetrics(
      ctx.projectId,
      market.locationCode,
      market.languageCode,
      metrics.map((m) => ({
        keyword: m.keyword,
        searchVolume: m.searchVolume ?? null,
        cpc: m.cpc ?? null,
        competition: m.competition ?? null,
        keywordDifficulty: m.keywordDifficulty ?? null,
        intent: m.intent ?? null,
        monthlySearches: m.monthlySearches ?? [],
      })),
    );
  }
  for (let i = 0; i < keywords.length; i += 200) {
    await db
      .insert(seoSavedKeywords)
      .values(keywords.slice(i, i + 200).map((keyword) => ({ projectId: ctx.projectId, keyword, ...market })))
      .onConflictDoNothing();
  }
  const saved = await db
    .select({ id: seoSavedKeywords.id })
    .from(seoSavedKeywords)
    .where(
      and(
        eq(seoSavedKeywords.projectId, ctx.projectId),
        eq(seoSavedKeywords.locationCode, market.locationCode),
        eq(seoSavedKeywords.languageCode, market.languageCode),
        inArray(seoSavedKeywords.keyword, keywords),
      ),
    );
  const ids = saved.map((s) => s.id);
  if (input.tagMode === "replace") await replaceTags(ctx.projectId, ids, input.tags ?? []);
  else if (input.tags?.length) await addTags(ctx.projectId, ids, input.tags);
  return { success: true as const, savedKeywordIds: ids, savedCount: ids.length };
}

/* ───────────────────────────── Listing ───────────────────────────── */

export const listSavedKeywordsInput = z.object({
  search: z.string().max(200).optional(),
  includeTerms: z.array(z.string().max(100)).max(20).optional(),
  excludeTerms: z.array(z.string().max(100)).max(20).optional(),
  minVolume: z.number().int().nonnegative().optional(),
  maxVolume: z.number().int().nonnegative().optional(),
  minCpc: z.number().nonnegative().optional(),
  maxCpc: z.number().nonnegative().optional(),
  minDifficulty: z.number().int().min(0).max(100).optional(),
  maxDifficulty: z.number().int().min(0).max(100).optional(),
  tagIds: z.array(z.string()).max(50).optional(),
  tagNames: z.array(z.string()).max(50).optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.union([z.literal(50), z.literal(100), z.literal(250)]).default(50),
  sort: z.enum(SAVED_SORT_FIELDS).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListSavedKeywordsInput = z.input<typeof listSavedKeywordsInput>;

function likeEscape(v: string) {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

async function resolveTagFilter(projectId: string, tagIds?: string[], tagNames?: string[]): Promise<string[] | null> {
  const ids = new Set(tagIds ?? []);
  if (tagNames?.length) {
    const normalized = normalizeTags(tagNames).map((t) => t.normalizedName);
    const rows = await db
      .select({ id: seoSavedKeywordTags.id })
      .from(seoSavedKeywordTags)
      .where(and(eq(seoSavedKeywordTags.projectId, projectId), inArray(seoSavedKeywordTags.normalizedName, normalized)));
    if (rows.length === 0 && ids.size === 0) return []; // names given but none match → empty result
    rows.forEach((r) => ids.add(r.id));
  }
  return ids.size ? [...ids] : null;
}

function buildWhere(projectId: string, f: z.infer<typeof listSavedKeywordsInput>, tagFilter: string[] | null): SQL {
  const conds: SQL[] = [eq(seoSavedKeywords.projectId, projectId)];
  const kw = sql`lower(${seoSavedKeywords.keyword})`;
  if (f.search?.trim()) conds.push(sql`${kw} like ${`%${likeEscape(f.search.trim().toLocaleLowerCase())}%`} escape '\\'`);
  for (const t of f.includeTerms ?? []) {
    const v = t.trim();
    if (v) conds.push(sql`${kw} like ${`%${likeEscape(v.toLocaleLowerCase())}%`} escape '\\'`);
  }
  for (const t of f.excludeTerms ?? []) {
    const v = t.trim();
    if (v) conds.push(sql`${kw} not like ${`%${likeEscape(v.toLocaleLowerCase())}%`} escape '\\'`);
  }
  if (f.minVolume != null) conds.push(sql`${seoKeywordMetrics.searchVolume} >= ${f.minVolume}`);
  if (f.maxVolume != null) conds.push(sql`${seoKeywordMetrics.searchVolume} <= ${f.maxVolume}`);
  if (f.minCpc != null) conds.push(sql`${seoKeywordMetrics.cpc} >= ${f.minCpc}`);
  if (f.maxCpc != null) conds.push(sql`${seoKeywordMetrics.cpc} <= ${f.maxCpc}`);
  if (f.minDifficulty != null) conds.push(sql`${seoKeywordMetrics.keywordDifficulty} >= ${f.minDifficulty}`);
  if (f.maxDifficulty != null) conds.push(sql`${seoKeywordMetrics.keywordDifficulty} <= ${f.maxDifficulty}`);
  if (tagFilter?.length) {
    conds.push(
      sql`exists (select 1 from ${seoSavedKeywordTagAssignments} a where a.saved_keyword_id = ${seoSavedKeywords.id} and a.tag_id in (${sql.join(
        tagFilter.map((id) => sql`${id}`),
        sql`, `,
      )}))`,
    );
  }
  return and(...conds)!;
}

const metricJoin = and(
  eq(seoKeywordMetrics.projectId, seoSavedKeywords.projectId),
  eq(seoKeywordMetrics.keyword, seoSavedKeywords.keyword),
  eq(seoKeywordMetrics.locationCode, seoSavedKeywords.locationCode),
  eq(seoKeywordMetrics.languageCode, seoSavedKeywords.languageCode),
);

function orderBy(sort: SavedSortField, order: "asc" | "desc"): SQL[] {
  const dir = order === "asc" ? sql`asc` : sql`desc`;
  const col = {
    createdAt: sql`${seoSavedKeywords.createdAt}`,
    keyword: sql`${seoSavedKeywords.keyword}`,
    searchVolume: sql`${seoKeywordMetrics.searchVolume}`,
    cpc: sql`${seoKeywordMetrics.cpc}`,
    competition: sql`${seoKeywordMetrics.competition}`,
    keywordDifficulty: sql`${seoKeywordMetrics.keywordDifficulty}`,
    fetchedAt: sql`${seoKeywordMetrics.fetchedAt}`,
  }[sort];
  return [sql`${col} ${dir} nulls last`, order === "asc" ? asc(seoSavedKeywords.id) : desc(seoSavedKeywords.id)];
}

async function selectRows(where: SQL, sort: SavedSortField, order: "asc" | "desc", limit?: number, offset?: number) {
  const q = db
    .select({
      id: seoSavedKeywords.id,
      keyword: seoSavedKeywords.keyword,
      locationCode: seoSavedKeywords.locationCode,
      languageCode: seoSavedKeywords.languageCode,
      createdAt: seoSavedKeywords.createdAt,
      searchVolume: seoKeywordMetrics.searchVolume,
      cpc: seoKeywordMetrics.cpc,
      competition: seoKeywordMetrics.competition,
      keywordDifficulty: seoKeywordMetrics.keywordDifficulty,
      intent: seoKeywordMetrics.intent,
      monthlySearches: seoKeywordMetrics.monthlySearches,
      fetchedAt: seoKeywordMetrics.fetchedAt,
    })
    .from(seoSavedKeywords)
    .leftJoin(seoKeywordMetrics, metricJoin)
    .where(where)
    .orderBy(...orderBy(sort, order));
  const rows = limit != null ? await q.limit(limit).offset(offset ?? 0) : await q;
  const tagsByKeyword = await tagsForKeywords(rows.map((r) => r.id));
  return rows.map<SavedKeywordRow>((r) => ({
    ...r,
    intent: r.intent && (KEYWORD_INTENTS as string[]).includes(r.intent) ? (r.intent as KeywordIntent) : r.intent ? normalizeIntent(r.intent) : null,
    monthlySearches: r.monthlySearches ?? [],
    tags: tagsByKeyword.get(r.id) ?? [],
  }));
}

async function tagsForKeywords(ids: string[]): Promise<Map<string, SavedKeywordTag[]>> {
  const map = new Map<string, SavedKeywordTag[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    if (!chunk.length) continue;
    const rows = await db
      .select({
        savedKeywordId: seoSavedKeywordTagAssignments.savedKeywordId,
        id: seoSavedKeywordTags.id,
        name: seoSavedKeywordTags.name,
        normalizedName: seoSavedKeywordTags.normalizedName,
        color: seoSavedKeywordTags.color,
      })
      .from(seoSavedKeywordTagAssignments)
      .innerJoin(seoSavedKeywordTags, eq(seoSavedKeywordTags.id, seoSavedKeywordTagAssignments.tagId))
      .where(inArray(seoSavedKeywordTagAssignments.savedKeywordId, chunk))
      .orderBy(asc(seoSavedKeywordTags.name));
    for (const r of rows) {
      const list = map.get(r.savedKeywordId) ?? [];
      list.push({ id: r.id, name: r.name, normalizedName: r.normalizedName, color: r.color });
      map.set(r.savedKeywordId, list);
    }
  }
  return map;
}

export async function listTagSummaries(projectId: string): Promise<SavedKeywordTagSummary[]> {
  const rows = await db
    .select({
      id: seoSavedKeywordTags.id,
      name: seoSavedKeywordTags.name,
      normalizedName: seoSavedKeywordTags.normalizedName,
      color: seoSavedKeywordTags.color,
      keywordCount: sql<number>`count(${seoSavedKeywordTagAssignments.savedKeywordId})::int`,
    })
    .from(seoSavedKeywordTags)
    .leftJoin(seoSavedKeywordTagAssignments, eq(seoSavedKeywordTagAssignments.tagId, seoSavedKeywordTags.id))
    .where(eq(seoSavedKeywordTags.projectId, projectId))
    .groupBy(seoSavedKeywordTags.id)
    .orderBy(asc(seoSavedKeywordTags.name));
  return rows.map((r) => ({ ...r, keywordCount: Number(r.keywordCount) }));
}

/** Server-side filters/sort/pagination. Returns rows (with tags), total and all project tags with counts. */
export async function listSavedKeywords(ctx: SeoContext, raw: ListSavedKeywordsInput) {
  const f = listSavedKeywordsInput.parse(raw);
  const tagFilter = await resolveTagFilter(ctx.projectId, f.tagIds, f.tagNames);
  const tags = await listTagSummaries(ctx.projectId);
  if (tagFilter && tagFilter.length === 0) return { rows: [] as SavedKeywordRow[], totalCount: 0, tags };
  const where = buildWhere(ctx.projectId, f, tagFilter);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(seoSavedKeywords).leftJoin(seoKeywordMetrics, metricJoin).where(where);
  const rows = await selectRows(where, f.sort, f.order, f.pageSize, (f.page - 1) * f.pageSize);
  return { rows, totalCount: Number(n), tags };
}

/** All rows matching the current filters/tags/sort (not just the page). */
export async function exportSavedKeywords(ctx: SeoContext, raw: Omit<ListSavedKeywordsInput, "page" | "pageSize">) {
  const f = listSavedKeywordsInput.parse({ ...raw, page: 1, pageSize: 50 });
  const tagFilter = await resolveTagFilter(ctx.projectId, f.tagIds, f.tagNames);
  if (tagFilter && tagFilter.length === 0) return { rows: [] as SavedKeywordRow[] };
  return { rows: await selectRows(buildWhere(ctx.projectId, f, tagFilter), f.sort, f.order) };
}

/* ───────────────────────────── Tags ───────────────────────────── */

async function ensureTags(projectId: string, names: string[]) {
  const normalized = normalizeTags(names).slice(0, MAX_TAGS_PER_OPERATION);
  if (!normalized.length) return [];
  await db
    .insert(seoSavedKeywordTags)
    .values(normalized.map((t) => ({ projectId, name: t.name, normalizedName: t.normalizedName })))
    .onConflictDoNothing();
  return db
    .select()
    .from(seoSavedKeywordTags)
    .where(
      and(
        eq(seoSavedKeywordTags.projectId, projectId),
        inArray(
          seoSavedKeywordTags.normalizedName,
          normalized.map((t) => t.normalizedName),
        ),
      ),
    );
}

async function scopedKeywordIds(projectId: string, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await db
      .select({ id: seoSavedKeywords.id })
      .from(seoSavedKeywords)
      .where(and(eq(seoSavedKeywords.projectId, projectId), inArray(seoSavedKeywords.id, chunk)));
    out.push(...rows.map((r) => r.id));
  }
  return out;
}

async function addTags(projectId: string, savedKeywordIds: string[], tagNames: string[]) {
  const tags = await ensureTags(projectId, tagNames);
  const ids = await scopedKeywordIds(projectId, savedKeywordIds);
  const pairs = ids.flatMap((savedKeywordId) => tags.map((t) => ({ savedKeywordId, tagId: t.id })));
  for (let i = 0; i < pairs.length; i += 500) {
    await db.insert(seoSavedKeywordTagAssignments).values(pairs.slice(i, i + 500)).onConflictDoNothing();
  }
  return { savedKeywordCount: ids.length, tags };
}

async function replaceTags(projectId: string, savedKeywordIds: string[], tagNames: string[]) {
  const { tags } = await addTags(projectId, savedKeywordIds, tagNames);
  const keep = tags.map((t) => t.id);
  const ids = await scopedKeywordIds(projectId, savedKeywordIds);
  if (ids.length && keep.length) {
    await db
      .delete(seoSavedKeywordTagAssignments)
      .where(and(inArray(seoSavedKeywordTagAssignments.savedKeywordId, ids), sql`${seoSavedKeywordTagAssignments.tagId} not in (${sql.join(keep.map((k) => sql`${k}`), sql`, `)})`));
  }
}

export const updateSavedKeywordTagsInput = z
  .object({
    savedKeywordIds: z.array(z.string()).min(1).max(2000),
    addTags: z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_OPERATION).optional(),
    removeTagIds: z.array(z.string()).max(50).optional(),
  })
  .refine((v) => (v.addTags?.length ?? 0) + (v.removeTagIds?.length ?? 0) > 0, { message: "Add or remove at least one tag." });

export async function updateSavedKeywordTags(ctx: SeoContext, raw: z.input<typeof updateSavedKeywordTagsInput>) {
  const input = updateSavedKeywordTagsInput.parse(raw);
  const added = input.addTags?.length ? await addTags(ctx.projectId, input.savedKeywordIds, input.addTags) : { savedKeywordCount: 0, tags: [] };
  let removedAssignments = 0;
  let removedTagIds: string[] = [];
  let removeCount = 0;
  if (input.removeTagIds?.length) {
    const ids = await scopedKeywordIds(ctx.projectId, input.savedKeywordIds);
    const tagRows = await db
      .select({ id: seoSavedKeywordTags.id })
      .from(seoSavedKeywordTags)
      .where(and(eq(seoSavedKeywordTags.projectId, ctx.projectId), inArray(seoSavedKeywordTags.id, input.removeTagIds)));
    removedTagIds = tagRows.map((t) => t.id);
    if (ids.length && removedTagIds.length) {
      const deleted = await db
        .delete(seoSavedKeywordTagAssignments)
        .where(and(inArray(seoSavedKeywordTagAssignments.savedKeywordId, ids), inArray(seoSavedKeywordTagAssignments.tagId, removedTagIds)))
        .returning({ id: seoSavedKeywordTagAssignments.savedKeywordId });
      removedAssignments = deleted.length;
    }
    removeCount = ids.length;
  }
  return {
    success: true as const,
    taggedCount: Math.max(added.savedKeywordCount, removeCount),
    addedTags: added.tags.map((t) => ({ id: t.id, name: t.name, normalizedName: t.normalizedName, color: t.color })),
    removedTagIds,
    removedAssignments,
  };
}

export const updateSavedKeywordTagInput = z
  .object({
    tagId: z.string().min(1),
    name: z.string().min(1).max(MAX_TAG_LENGTH).optional(),
    color: z.enum(TAG_COLOR_KEYS).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.color !== undefined, { message: "Nothing to update." });

export async function updateSavedKeywordTag(ctx: SeoContext, raw: z.input<typeof updateSavedKeywordTagInput>) {
  const input = updateSavedKeywordTagInput.parse(raw);
  const set: { name?: string; normalizedName?: string; color?: TagColorKey | null } = {};
  if (input.name !== undefined) {
    const n = normalizeTags([input.name])[0];
    if (!n) throw new SeoError("VALIDATION_ERROR", "Tag name can't be empty.");
    set.name = n.name;
    set.normalizedName = n.normalizedName;
  }
  if (input.color !== undefined) set.color = input.color && isTagColorKey(input.color) ? input.color : null;
  try {
    const [tag] = await db
      .update(seoSavedKeywordTags)
      .set(set)
      .where(and(eq(seoSavedKeywordTags.id, input.tagId), eq(seoSavedKeywordTags.projectId, ctx.projectId)))
      .returning();
    if (!tag) throw new SeoError("NOT_FOUND", "Tag not found.");
    return { success: true as const, tag: { id: tag.id, name: tag.name, normalizedName: tag.normalizedName, color: tag.color } };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505")
      throw new SeoError("CONFLICT", "A tag with this name already exists.");
    throw err;
  }
}

/** Refused while assigned (open-seo TAG_IN_USE). */
export async function deleteSavedKeywordTag(ctx: SeoContext, input: { tagId: string }) {
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(seoSavedKeywordTagAssignments)
    .innerJoin(seoSavedKeywordTags, eq(seoSavedKeywordTags.id, seoSavedKeywordTagAssignments.tagId))
    .where(and(eq(seoSavedKeywordTags.id, input.tagId), eq(seoSavedKeywordTags.projectId, ctx.projectId)));
  if (Number(n) > 0) {
    throw new SeoError(
      "CONFLICT",
      `Tag is attached to ${n} keyword${Number(n) === 1 ? "" : "s"}. Remove the tag from those keywords first.`,
    );
  }
  const deleted = await db
    .delete(seoSavedKeywordTags)
    .where(and(eq(seoSavedKeywordTags.id, input.tagId), eq(seoSavedKeywordTags.projectId, ctx.projectId)))
    .returning({ id: seoSavedKeywordTags.id });
  return { success: deleted.length > 0 };
}

export async function removeSavedKeywords(ctx: SeoContext, input: { savedKeywordIds: string[] }) {
  const ids = z.array(z.string()).min(1).max(2000).parse(input.savedKeywordIds);
  let deletedCount = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .delete(seoSavedKeywords)
      .where(and(eq(seoSavedKeywords.projectId, ctx.projectId), inArray(seoSavedKeywords.id, ids.slice(i, i + 500))))
      .returning({ id: seoSavedKeywords.id });
    deletedCount += rows.length;
  }
  return { success: true as const, deletedCount };
}

/* ───────────────────────────── Metrics refresh (billed; runs as a job) ───────────────────────────── */

/** Groups all saved keywords by (location, language) and refreshes metrics (≤700 per call). */
export async function refreshSavedKeywordMetrics(ctx: SeoContext): Promise<{ updated: number }> {
  assertCanRun(ctx);
  const rows = await db
    .select({ keyword: seoSavedKeywords.keyword, locationCode: seoSavedKeywords.locationCode, languageCode: seoSavedKeywords.languageCode })
    .from(seoSavedKeywords)
    .where(eq(seoSavedKeywords.projectId, ctx.projectId));
  if (!rows.length) return { updated: 0 };
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.locationCode}:${r.languageCode}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  let updated = 0;
  for (const group of groups.values()) {
    const { locationCode, languageCode } = group[0]!;
    const metrics = await fetchKeywordMetricsForList(ctx, {
      keywords: group.map((g) => g.keyword),
      locationCode,
      languageCode,
      feature: "keyword_research",
    });
    const byKeyword = new Map(metrics.map((m) => [m.keyword.toLowerCase(), m]));
    const matched = group.map((g) => byKeyword.get(g.keyword.toLowerCase())).filter((m): m is NonNullable<typeof m> => m != null);
    await upsertKeywordMetrics(
      ctx.projectId,
      locationCode,
      languageCode,
      matched.map((m) => ({ ...m, keyword: m.keyword.toLowerCase() })),
    );
    updated += byKeyword.size;
  }
  return { updated };
}

export const SAVED_METRICS_JOB = "seo.saved-metrics";

/** Enqueue the billed refresh; returns the job id (UI polls it). */
export async function enqueueSavedKeywordMetricsRefresh(ctx: SeoContext) {
  assertCanRun(ctx);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(seoSavedKeywords).where(eq(seoSavedKeywords.projectId, ctx.projectId));
  if (Number(n) === 0) throw new SeoError("VALIDATION_ERROR", "No saved keywords to update.");
  const dedupeKey = `${SAVED_METRICS_JOB}:${ctx.projectId}`;
  const job = await enqueueJob(
    SAVED_METRICS_JOB,
    { projectId: ctx.projectId, userId: ctx.userId },
    { dedupeKey, projectId: ctx.projectId, workspaceId: ctx.workspaceId, createdBy: ctx.userId, maxAttempts: 1 },
  );
  if (job) return { jobId: job.id, keywordCount: Number(n), alreadyRunning: false };
  const [active] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.dedupeKey, dedupeKey)).limit(1);
  return { jobId: active?.id ?? null, keywordCount: Number(n), alreadyRunning: true };
}
