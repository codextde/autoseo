import "server-only";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { aiAnswers, competitors, prompts, promptTags } from "@/server/db/schema";
import { ENGINES, getEngine } from "@/lib/engines";
import { getAnswerDetail, getDailySeries, getFanouts, getPromptRows, getTrackerKpis, listPromptAnswers, type TrackerFilter } from "@/server/ai/metrics";
import { getCompetitorDetail, getCompetitorsData } from "@/server/ai/insights/competitors";
import { getSentimentContext, getSentimentOverview } from "@/server/ai/insights/sentiment";
import type { InsightFilter } from "@/server/ai/insights/filters";
import { listPromptTags } from "@/server/ai/tracking/prompts";
import { METRIC_KEYS, type MetricKey } from "@/features/ai-insights/lib/metrics";
import type { PeriodRange } from "@/features/ai-tracking/period";
import type { PromptRow, TrackerKpis } from "@/features/ai-tracking/types";
import type { ApiProject } from "./auth";
import { ApiError } from "./errors";

/**
 * Data layer shared by the REST API (v1) and the MCP tools. Reuses the tracker metrics
 * (`server/ai/metrics`) and AI insights (`server/ai/insights`) so numbers match the app exactly.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => day(new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY) + 1;

/* ───────────────────────────── Filters ───────────────────────────── */

export const ENGINE_IDS = ENGINES.map((e) => e.id);

/** Common filter inputs (finseo MCP naming). Used by MCP tool schemas and REST query parsing. */
export const aiFilterShape = {
  timeframeDays: z
    .number()
    .int()
    .min(1)
    .max(730)
    .optional()
    .describe("Look-back window in days ending today (default 30). Ignored when startDate is set."),
  startDate: z.string().regex(ISO_DAY, "Use YYYY-MM-DD").optional().describe("Custom period start (YYYY-MM-DD, UTC)."),
  endDate: z.string().regex(ISO_DAY, "Use YYYY-MM-DD").optional().describe("Custom period end (YYYY-MM-DD, UTC; default today)."),
  model: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(`AI model / engine id(s) to include. One of: ${ENGINE_IDS.join(", ")}. Default: all.`),
  tags: z.array(z.string()).max(50).optional().describe("Only prompts with any of these tags (tag names or ids)."),
};

export type AiFilterInput = {
  timeframeDays?: number;
  startDate?: string;
  endDate?: string;
  model?: string | string[];
  tags?: string[];
};

export type AiScope = {
  project: ApiProject;
  period: PeriodRange;
  insight: InsightFilter;
  tracker: TrackerFilter;
  engines: string[];
  tagIds: string[];
};

export function resolveEngines(model: string | string[] | undefined): string[] {
  const raw = (Array.isArray(model) ? model : model ? model.split(",") : []).map((m) => m.trim().toLowerCase()).filter(Boolean);
  const out = new Set<string>();
  for (const m of raw) {
    if (m === "all") return [];
    const hit =
      getEngine(m) ??
      ENGINES.find((e) => e.name.toLowerCase() === m || e.shortName.toLowerCase() === m || e.id.replace(/_/g, " ") === m.replace(/[-_]/g, " "));
    if (!hit) throw new ApiError("validation_error", `Unknown model "${m}". Use one of: ${ENGINE_IDS.join(", ")}.`);
    out.add(hit.id);
  }
  return [...out];
}

export async function resolveTagIds(projectId: string, tags: string[] | undefined): Promise<string[]> {
  if (!tags?.length) return [];
  const all = await db.select({ id: promptTags.id, name: promptTags.name }).from(promptTags).where(eq(promptTags.projectId, projectId));
  const ids = new Set<string>();
  for (const t of tags) {
    const v = t.trim().toLowerCase();
    const hit = all.find((x) => x.id.toLowerCase() === v || x.name.toLowerCase() === v);
    if (!hit) throw new ApiError("validation_error", `Unknown tag "${t}". Use get_tags / GET /tags to list tags.`);
    ids.add(hit.id);
  }
  return [...ids];
}

export function resolvePeriod(input: { timeframeDays?: number; startDate?: string; endDate?: string }, defaultDays = 30): PeriodRange {
  const today = day(new Date());
  let from: string;
  let to: string;
  let preset = "custom";
  if (input.startDate) {
    to = input.endDate && input.endDate <= today ? input.endDate : today;
    from = input.startDate > to ? to : input.startDate;
    if (daysBetween(from, to) > 730) from = addDays(to, -729);
  } else {
    const days = input.timeframeDays ?? defaultDays;
    to = input.endDate && input.endDate <= today ? input.endDate : today;
    from = addDays(to, -(days - 1));
    preset = `${days}d`;
  }
  const days = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  return { from, to, days, preset, prev: { from: addDays(prevTo, -(days - 1)), to: prevTo, days } };
}

export async function buildAiScope(project: ApiProject, input: AiFilterInput, defaultDays = 30): Promise<AiScope> {
  const engines = resolveEngines(input.model);
  const tagIds = await resolveTagIds(project.id, input.tags);
  const period = resolvePeriod(input, defaultDays);
  const insight: InsightFilter = {
    projectId: project.id,
    preset: period.preset,
    from: period.from,
    to: period.to,
    prevFrom: period.prev.from,
    prevTo: period.prev.to,
    days: period.days,
    engines,
    tagIds,
  };
  const tracker: TrackerFilter = { projectId: project.id, engines, tagIds, status: "active" };
  return { project, period, insight, tracker, engines, tagIds };
}

export function periodInfo(s: AiScope) {
  return {
    from: s.period.from,
    to: s.period.to,
    days: s.period.days,
    previous: { from: s.period.prev.from, to: s.period.prev.to },
    models: s.engines.length ? s.engines : "all",
    tagIds: s.tagIds,
  };
}

/* ───────────────────────────── Projects ───────────────────────────── */

export function projectDto(p: ApiProject, baseUrl: string) {
  return {
    id: p.id,
    name: p.name,
    domain: p.domain,
    websiteUrl: p.websiteUrl,
    description: p.description,
    country: p.country,
    language: p.language,
    brand: { aliases: p.brand?.aliases ?? [], domains: p.brand?.domains ?? [], industry: p.brand?.industry ?? null },
    engines: p.engines,
    trackingFrequency: p.trackingFrequency,
    isPitch: p.isPitch,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    url: `${baseUrl}/p/${p.id}`,
  };
}

export async function projectCounts(projectIds: string[]) {
  if (!projectIds.length) return new Map<string, { prompts: number; competitors: number }>();
  const [pr, co] = await Promise.all([
    db
      .select({ projectId: prompts.projectId, n: sql<number>`count(*)::int` })
      .from(prompts)
      .where(and(inArray(prompts.projectId, projectIds), eq(prompts.status, "active")))
      .groupBy(prompts.projectId),
    db
      .select({ projectId: competitors.projectId, n: sql<number>`count(*)::int` })
      .from(competitors)
      .where(and(inArray(competitors.projectId, projectIds), eq(competitors.tracked, true)))
      .groupBy(competitors.projectId),
  ]);
  const m = new Map<string, { prompts: number; competitors: number }>();
  for (const id of projectIds) m.set(id, { prompts: 0, competitors: 0 });
  for (const r of pr) m.get(r.projectId)!.prompts = r.n;
  for (const r of co) m.get(r.projectId)!.competitors = r.n;
  return m;
}

/* ───────────────────────────── Visibility metrics ───────────────────────────── */

const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
const diff = (a: number | null, b: number | null) => (a == null || b == null ? null : Math.round((a - b) * 10) / 10);

/** Rounds every non-integer number in a JSON-like value to 1 decimal (stable API output). */
export function roundDeep<T>(v: T): T {
  if (typeof v === "number") return (Number.isInteger(v) ? v : Math.round(v * 10) / 10) as T;
  if (Array.isArray(v)) return v.map(roundDeep) as T;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, roundDeep(x)])) as T;
  }
  return v;
}

function periodMetrics(k: TrackerKpis) {
  return {
    visibility: k.visibility,
    mentionRate: k.mentionRate,
    citationRate: k.citationRate,
    avgPosition: k.position,
    mentionDepth: k.mentionDepth,
    sentiment: k.sentiment,
    shareOfVoice: k.shareOfVoice,
    answers: k.answers,
    prompts: k.prompts,
    visibleAnswers: k.visible,
    mentions: k.mentioned,
    citedAnswers: k.cited,
  };
}

export const KPI_DEFINITIONS = {
  visibility: "Answers that name OR cite the own brand ÷ all answers (%).",
  mentionRate: "Answers naming the brand ÷ all answers (%).",
  citationRate: "Answers citing an own-domain page ÷ all answers (%).",
  avgPosition: "Mean ordinal position of the brand among all brands named (1 = named first).",
  mentionDepth: "Mean offset of the first mention within the answer (0% = top).",
  sentiment: "Mean own-brand sentiment 0–100.",
  shareOfVoice: "Own-brand mentions ÷ mentions of all tracked brands (%).",
};

export async function getVisibilityMetrics(s: AiScope) {
  const k = await getTrackerKpis(s.tracker, s.period);
  const cur = periodMetrics(k.current);
  const prev = periodMetrics(k.previous);
  const changes = Object.fromEntries(
    (Object.keys(cur) as (keyof typeof cur)[]).map((key) => [key, diff(cur[key] as number | null, prev[key] as number | null)]),
  );
  return { period: periodInfo(s), current: cur, previous: prev, changes, definitions: KPI_DEFINITIONS };
}

export async function getVisibilityTimeseries(s: AiScope) {
  const points = await getDailySeries(s.tracker, s.period);
  return {
    period: periodInfo(s),
    series: points.map((p) => ({
      date: p.date,
      answers: p.answers,
      visibility: p.visibility,
      mentionRate: p.mentionRate,
      citationRate: p.citationRate,
      avgPosition: p.position,
      sentiment: p.sentiment,
      mentionedAndCited: p.both,
      mentionedOnly: p.mentionedOnly,
      citedOnly: p.citedOnly,
      notVisible: p.none,
    })),
  };
}

/* ───────────────────────────── Prompts ───────────────────────────── */

function promptMetrics(r: PromptRow) {
  const citedAnswers = r.perEngine.reduce((a, e) => a + e.cited, 0);
  const pct = (n: number) => (r.answers > 0 ? Math.round((n / r.answers) * 1000) / 10 : null);
  return {
    isVisible: (r.visibility ?? 0) > 0,
    answers: r.answers,
    visibility: r.visibility,
    visibilityChange: r.visibilityDelta,
    totalMentions: r.mentions,
    mentionRate: pct(r.mentions),
    ownDomainCitations: r.citations,
    citationRate: pct(citedAnswers),
    sentiment: r.sentiment,
    avgPosition: r.position,
  };
}

export type PromptListOptions = {
  search?: string;
  status?: "active" | "archived" | "all";
  language?: string;
  country?: string;
  page: number;
  limit: number;
};

export async function listPromptsWithMetrics(s: AiScope, opts: PromptListOptions) {
  const rows = await getPromptRows({ ...s.tracker, status: opts.status ?? "active", countries: opts.country ? [opts.country.toUpperCase()] : undefined }, s.period);
  let list = rows;
  if (opts.search?.trim()) {
    const q = opts.search.trim().toLowerCase();
    list = list.filter((r) => r.text.toLowerCase().includes(q));
  }
  if (opts.language) list = list.filter((r) => r.language.toLowerCase() === opts.language!.toLowerCase());
  const total = list.length;
  const start = (opts.page - 1) * opts.limit;
  const items = list.slice(start, start + opts.limit).map((r) => ({
    id: r.id,
    text: r.text,
    country: r.country,
    language: r.language,
    status: r.status,
    tags: r.tags.map((t) => ({ id: t.id, name: t.name })),
    models: r.engines,
    createdAt: r.createdAt,
    lastRunAt: r.lastRunAt,
    metrics: promptMetrics(r),
    competitorsMentioned: r.brands.slice(0, 5).map((b) => ({ id: b.competitorId, name: b.name, mentions: b.count })),
  }));
  return { period: periodInfo(s), items, pagination: { page: opts.page, limit: opts.limit, total, totalPages: Math.max(1, Math.ceil(total / opts.limit)) } };
}

export async function getPromptDetails(s: AiScope, promptId: string) {
  const rows = await getPromptRows({ ...s.tracker, status: "all", promptIds: [promptId] }, s.period);
  const r = rows[0];
  if (!r) throw new ApiError("not_found", "Prompt not found.");
  const answers = await listPromptAnswers(s.project.id, promptId, Math.max(s.period.days, 30));
  const recent = answers
    .filter((a) => (!s.engines.length || s.engines.includes(a.engine)) && a.date >= s.period.from && a.date <= s.period.to)
    .slice(0, 50);
  return {
    period: periodInfo(s),
    prompt: {
      id: r.id,
      text: r.text,
      country: r.country,
      language: r.language,
      status: r.status,
      tags: r.tags.map((t) => ({ id: t.id, name: t.name })),
      models: r.engines,
      createdAt: r.createdAt,
      lastRunAt: r.lastRunAt,
    },
    metrics: promptMetrics(r),
    byModel: r.perEngine.map((e) => ({
      model: e.engine,
      answers: e.answers,
      visibility: e.visibility,
      mentioned: e.mentioned,
      cited: e.cited,
      ownDomainCitations: e.citations,
      sentiment: e.sentiment,
      avgPosition: e.position,
      latest: e.latestAnswerId ? { answerId: e.latestAnswerId, date: e.latestDate, visible: e.latestVisible, status: e.latestStatus } : null,
      competitors: e.brands.map((b) => ({ id: b.competitorId, name: b.name, mentions: b.count })),
    })),
    competitorsMentioned: r.brands.map((b) => ({ id: b.competitorId, name: b.name, domain: b.domain, mentions: b.count })),
    recentAnswers: recent.map((a) => ({
      answerId: a.id,
      model: a.engine,
      date: a.date,
      status: a.status,
      mentioned: a.brandMentioned,
      cited: a.brandCited,
      position: a.position,
      sentiment: a.sentiment,
    })),
  };
}

export async function getAnswerContent(project: ApiProject, opts: { answerId?: string; promptId?: string; model?: string; date?: string; maxChars?: number }) {
  let answerId = opts.answerId;
  if (!answerId) {
    if (!opts.promptId) throw new ApiError("validation_error", "Provide answerId, or promptId (optionally with model and date).");
    const engines = opts.model ? resolveEngines(opts.model) : [];
    const conds: SQL[] = [eq(aiAnswers.projectId, project.id), eq(aiAnswers.promptId, opts.promptId)];
    if (engines.length) conds.push(inArray(aiAnswers.engine, engines));
    if (opts.date) conds.push(eq(aiAnswers.answerDate, opts.date));
    const [row] = await db
      .select({ id: aiAnswers.id })
      .from(aiAnswers)
      .where(and(...conds))
      .orderBy(desc(aiAnswers.answerDate), asc(aiAnswers.engine))
      .limit(1);
    if (!row) throw new ApiError("not_found", "No answer found for this prompt / model / date.");
    answerId = row.id;
  }
  const d = await getAnswerDetail(project.id, answerId);
  if (!d) throw new ApiError("not_found", "Answer not found.");
  const max = opts.maxChars ?? 20_000;
  return {
    answerId: d.id,
    prompt: d.promptText,
    model: d.engine,
    provider: d.provider,
    modelVersion: d.model,
    date: d.date,
    country: d.country,
    status: d.status,
    error: d.error,
    brandMentioned: d.brandMentioned,
    brandCited: d.brandCited,
    position: d.position,
    sentiment: d.sentiment,
    text: d.text.length > max ? `${d.text.slice(0, max)}\n\n[truncated ${d.text.length - max} characters]` : d.text,
    mentions: d.mentions,
    citations: d.citations,
    fanoutQueries: d.fanouts,
    products: d.products,
    ads: d.ads,
    statements: d.statements,
    recommendations: d.recommendations,
  };
}

/* ───────────────────────────── Competitors ───────────────────────────── */

export const COMPETITOR_SORT_KEYS = METRIC_KEYS;

export async function getCompetitorRanking(s: AiScope, opts: { sortBy?: MetricKey; order?: "asc" | "desc"; includeUntracked?: boolean }) {
  const data = await getCompetitorsData(s.project, s.insight);
  const brandByKey = new Map(data.brands.map((b) => [b.key, b]));
  const sortBy: MetricKey = opts.sortBy ?? "visibility";
  const invert = sortBy === "avgPosition" || sortBy === "mentionDepth";
  const order = opts.order ?? (invert ? "asc" : "desc");
  const rows = data.rows
    .map((r) => ({ row: r, brand: brandByKey.get(r.key)! }))
    .filter((x) => x.brand && (x.brand.isOwn || x.brand.tracked || opts.includeUntracked))
    .sort((a, b) => {
      const va = a.row.metrics[sortBy];
      const vb = b.row.metrics[sortBy];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return order === "asc" ? va - vb : vb - va;
    })
    .map((x, i) => ({
      rank: i + 1,
      competitorId: x.brand.competitorId,
      isOwnBrand: x.brand.isOwn,
      name: x.brand.name,
      domain: x.brand.domain,
      tracked: x.brand.tracked,
      metrics: x.row.metrics,
      changes: x.row.deltas,
      byModel: x.row.engines.map((e) => ({ model: e.engine, visibility: e.visibility, visibleAnswers: e.visible, answers: e.answers })),
    }));
  return { period: periodInfo(s), sortBy, order, totals: data.totals, items: roundDeep(rows) };
}

export async function resolveCompetitorId(projectId: string, idOrName: string): Promise<string> {
  const v = idOrName.trim().toLowerCase();
  const list = await db.select({ id: competitors.id, name: competitors.name, domain: competitors.domain }).from(competitors).where(eq(competitors.projectId, projectId));
  const hit = list.find((c) => c.id.toLowerCase() === v || c.name.toLowerCase() === v || (c.domain ?? "").toLowerCase() === v);
  if (!hit) throw new ApiError("not_found", `Competitor "${idOrName}" not found. Use get_competitor_ranking to list competitors.`);
  return hit.id;
}

/**
 * Gap analysis: answers where a competitor (one, or any tracked) is named but the own brand is
 * not — aggregated per prompt ("lost answers"), plus the sources cited in those answers.
 */
export async function getCompetitorGapAnalysis(s: AiScope, competitor: string | undefined, limit = 50) {
  const compId = competitor ? await resolveCompetitorId(s.project.id, competitor) : null;
  const comp = compId
    ? (await db.select({ id: competitors.id, name: competitors.name, domain: competitors.domain }).from(competitors).where(eq(competitors.id, compId)).limit(1))[0]!
    : null;
  const engineSql = s.engines.length ? sql`and a.engine in ${s.engines}` : sql``;
  const tagSql = s.tagIds.length ? sql`and a.prompt_id in (select l.prompt_id from prompt_tag_links l where l.tag_id in ${s.tagIds})` : sql``;
  const compSql = compId ? sql`and m.competitor_id = ${compId}` : sql`and m.competitor_id is not null`;
  const scoped = sql`
    select a.id, a.prompt_id, a.brand_mentioned from ai_answers a
    where a.project_id = ${s.project.id} and a.status = 'ok'
      and a.answer_date between ${s.period.from}::date and ${s.period.to}::date
      and a.prompt_id in (select p.id from prompts p where p.project_id = ${s.project.id} and p.status = 'active')
      ${engineSql} ${tagSql}`;

  type PromptGap = { id: string; text: string; country: string; answers: number; own: number; gap: number; competitors: { id: string; name: string; mentions: number }[] };
  const promptRows = (await db.execute(sql`
    with scoped as (${scoped}),
    gap as (
      select distinct s.id, s.prompt_id from scoped s join ai_mentions m on m.answer_id = s.id
      where not s.brand_mentioned ${compSql}
    ),
    per_prompt as (
      select s.prompt_id, count(*)::int answers, count(*) filter (where s.brand_mentioned)::int own from scoped s group by 1
    ),
    per_gap as (select g.prompt_id, count(*)::int gap from gap g group by 1),
    comp as (
      select g.prompt_id, c.id cid, c.name, count(distinct g.id)::int n
      from gap g join ai_mentions m on m.answer_id = g.id join competitors c on c.id = m.competitor_id
      ${compId ? sql`where c.id = ${compId}` : sql``}
      group by 1, 2, 3
    )
    select p.id, p.text, p.country, pp.answers, pp.own, pg.gap,
      coalesce((select json_agg(json_build_object('id', c.cid, 'name', c.name, 'mentions', c.n) order by c.n desc) from comp c where c.prompt_id = p.id), '[]') competitors
    from per_gap pg join per_prompt pp on pp.prompt_id = pg.prompt_id join prompts p on p.id = pg.prompt_id
    order by pg.gap desc, pp.own asc
    limit ${limit}`)) as unknown as PromptGap[];

  type SourceGap = { url: string; domain: string; title: string | null; content_type: string; ownership: string; answers: number };
  const sourceRows = (await db.execute(sql`
    with scoped as (${scoped}),
    gap as (
      select distinct s.id from scoped s join ai_mentions m on m.answer_id = s.id
      where not s.brand_mentioned ${compSql}
    )
    select src.url, src.domain, src.title, src.content_type, src.ownership, count(distinct c.answer_id)::int answers
    from gap g join ai_citations c on c.answer_id = g.id join ai_sources src on src.id = c.source_id
    where src.ownership <> 'own'
    group by 1, 2, 3, 4, 5
    order by answers desc
    limit ${limit}`)) as unknown as SourceGap[];

  const [totals] = (await db.execute(sql`
    with scoped as (${scoped})
    select count(*)::int answers,
      count(*) filter (where not s.brand_mentioned and exists (select 1 from ai_mentions m where m.answer_id = s.id ${compSql}))::int gap
    from scoped s`)) as unknown as { answers: number; gap: number }[];

  return {
    period: periodInfo(s),
    competitor: comp,
    summary: {
      answers: Number(totals?.answers ?? 0),
      gapAnswers: Number(totals?.gap ?? 0),
      explanation: `Gap answers name ${comp ? comp.name : "at least one tracked competitor"} but not your brand.`,
    },
    promptGaps: promptRows.map((r) => ({
      promptId: r.id,
      text: r.text,
      country: r.country,
      answers: Number(r.answers),
      gapAnswers: Number(r.gap),
      yourMentionRate: Number(r.answers) ? Math.round((Number(r.own) / Number(r.answers)) * 1000) / 10 : null,
      competitors: r.competitors,
    })),
    sourceGaps: sourceRows.map((r) => ({
      url: r.url,
      domain: r.domain,
      title: r.title,
      contentType: r.content_type,
      ownership: r.ownership,
      gapAnswersCiting: Number(r.answers),
    })),
  };
}

export async function getCompetitorH2H(s: AiScope, competitor: string) {
  const id = await resolveCompetitorId(s.project.id, competitor);
  const d = await getCompetitorDetail(s.project, s.insight, id);
  if (!d) throw new ApiError("not_found", "Competitor not found.");
  return {
    period: periodInfo(s),
    you: { name: d.own.name, domain: d.own.domain },
    competitor: { id, name: d.brand.name, domain: d.brand.domain },
    kpis: roundDeep(d.kpis),
    headToHead: {
      ...d.headToHead,
      explanation: "Answers naming both brands: a win means your brand was named before the competitor.",
    },
    claims: d.claims.slice(0, 50),
    sentiment: roundDeep(d.sentiment),
    promptsSharing: d.prompts
      .filter((p) => p.you > 0 && p.them > 0)
      .slice(0, 50)
      .map((p) => ({ promptId: p.id, text: p.text, answers: p.answers, yourMentions: p.you, competitorMentions: p.them, yourPosition: p.youPos, competitorPosition: p.themPos })),
    totals: d.totals,
  };
}

/* ───────────────────────────── Sentiment ───────────────────────────── */

export async function getSentiment(s: AiScope, compareCompetitor?: string) {
  const compareId = compareCompetitor ? await resolveCompetitorId(s.project.id, compareCompetitor) : "none";
  const ctx = await getSentimentContext(s.project, s.insight, compareId);
  const o = await getSentimentOverview(s.project, s.insight, ctx);
  const nameByKey = new Map(ctx.brands.map((b) => [b.key, b.name]));
  const roundMix = <T extends Record<string, unknown>>(v: T): T =>
    Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "number" ? Math.round(x * 10) / 10 : x])) as T;
  return {
    period: periodInfo(s),
    brand: ctx.own.name,
    you: roundMix(o.kpis.you),
    compare: ctx.compare && o.kpis.compare ? { name: ctx.compare.name, ...roundMix(o.kpis.compare) } : null,
    topPraise: roundDeep(o.praises.slice(0, 15)),
    topCriticism: roundDeep(o.criticisms.slice(0, 15)),
    brands: roundDeep(o.table.map((r) => ({ brand: nameByKey.get(r.key) ?? r.key, ...r }))),
    daily: roundDeep(o.daily),
  };
}

/* ───────────────────────────── Sources ───────────────────────────── */

export async function getTopSources(
  s: AiScope,
  opts: { limit: number; page?: number; contentType?: string; ownership?: "own" | "competitor" | "third_party"; search?: string; domains?: boolean },
) {
  const scopeSql = (from: string, to: string) => sql`
    c.project_id = ${s.project.id}
    and c.answer_date between ${from}::date and ${to}::date
    and c.prompt_id in (select p.id from prompts p where p.project_id = ${s.project.id} and p.status = 'active'${
      s.tagIds.length ? sql` and p.id in (select l.prompt_id from prompt_tag_links l where l.tag_id in ${s.tagIds})` : sql``
    })
    ${s.engines.length ? sql`and c.engine in ${s.engines}` : sql``}`;
  const extra: SQL[] = [];
  if (opts.contentType) extra.push(sql`and src.content_type = ${opts.contentType}`);
  if (opts.ownership) extra.push(sql`and src.ownership = ${opts.ownership}`);
  if (opts.search?.trim()) extra.push(sql`and (src.url ilike ${`%${opts.search.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`})`);
  const extraSql = sql.join(extra, sql` `);
  const group = opts.domains ? sql`src.domain` : sql`src.id`;
  const page = opts.page ?? 1;
  const offset = (page - 1) * opts.limit;

  type Row = { key: string; url: string | null; domain: string; title: string | null; content_type: string | null; ownership: string | null; citations: number; prompts: number; answers: number; engines: string[]; prev: number; total: number };
  const rows = (await db.execute(sql`
    with cur as (
      select ${group} k, count(*)::int citations, count(distinct c.prompt_id)::int prompts, count(distinct c.answer_id)::int answers,
        array_agg(distinct c.engine) engines
      from ai_citations c join ai_sources src on src.id = c.source_id
      where ${scopeSql(s.period.from, s.period.to)} ${extraSql}
      group by 1
    ), prev as (
      select ${group} k, count(*)::int citations
      from ai_citations c join ai_sources src on src.id = c.source_id
      where ${scopeSql(s.period.prev.from, s.period.prev.to)} ${extraSql}
      group by 1
    )
    select cur.k key,
      ${opts.domains ? sql`null` : sql`(select url from ai_sources where id = cur.k)`} url,
      ${opts.domains ? sql`cur.k` : sql`(select domain from ai_sources where id = cur.k)`} domain,
      ${opts.domains ? sql`null` : sql`(select title from ai_sources where id = cur.k)`} title,
      ${opts.domains ? sql`(select mode() within group (order by content_type) from ai_sources where project_id = ${s.project.id} and domain = cur.k)` : sql`(select content_type from ai_sources where id = cur.k)`} content_type,
      ${opts.domains ? sql`(select mode() within group (order by ownership) from ai_sources where project_id = ${s.project.id} and domain = cur.k)` : sql`(select ownership from ai_sources where id = cur.k)`} ownership,
      cur.citations, cur.prompts, cur.answers, cur.engines, coalesce(prev.citations, 0)::int prev, count(*) over ()::int total
    from cur left join prev on prev.k = cur.k
    order by cur.citations desc, cur.prompts desc
    limit ${opts.limit} offset ${offset}`)) as unknown as Row[];

  const total = Number(rows[0]?.total ?? 0);
  return {
    period: periodInfo(s),
    groupedBy: opts.domains ? "domain" : "url",
    items: rows.map((r, i) => ({
      rank: offset + i + 1,
      ...(opts.domains ? {} : { sourceId: r.key, url: r.url, title: r.title }),
      domain: r.domain,
      contentType: r.content_type,
      ownership: r.ownership,
      citations: Number(r.citations),
      citationsChange: Number(r.citations) - Number(r.prev),
      prompts: Number(r.prompts),
      answers: Number(r.answers),
      models: (r.engines ?? []).filter(Boolean),
    })),
    pagination: { page, limit: opts.limit, total, totalPages: Math.max(1, Math.ceil(total / opts.limit)) },
  };
}

/* ───────────────────────────── Tags & fan-outs ───────────────────────────── */

export async function getTags(projectId: string) {
  const tags = await listPromptTags(projectId);
  return tags.map((t) => ({ id: t.id, name: t.name, color: t.color, promptCount: Number(t.count) }));
}

export async function getQueryFanouts(s: AiScope, opts: { search?: string; promptId?: string; limit: number; page?: number }) {
  let rows = await getFanouts(s.project.id, s.period, opts.search);
  if (s.engines.length) rows = rows.filter((r) => r.engines.some((e) => s.engines.includes(e)));
  if (s.tagIds.length || opts.promptId) {
    const allowed = opts.promptId
      ? new Set([opts.promptId])
      : new Set(
          (
            await db.execute(sql`select distinct l.prompt_id from prompt_tag_links l where l.tag_id in ${s.tagIds}`)
          ).map((r) => String((r as { prompt_id: string }).prompt_id)),
        );
    rows = rows.filter((r) => r.prompts.some((p) => allowed.has(p.id)));
  }
  const page = opts.page ?? 1;
  const total = rows.length;
  const items = rows.slice((page - 1) * opts.limit, page * opts.limit).map((r) => ({
    query: r.query,
    frequency: r.frequency,
    models: r.engines,
    prompts: r.prompts.slice(0, 10),
    promptCount: r.prompts.length,
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
  }));
  return { period: periodInfo(s), items, pagination: { page, limit: opts.limit, total, totalPages: Math.max(1, Math.ceil(total / opts.limit)) } };
}

/** Occurrences of one fan-out query (which prompts / models / days produced it). */
export async function getFanoutDetails(s: AiScope, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) throw new ApiError("validation_error", "query is required.");
  const rows = (await db.execute(sql`
    select f.id, f.query, f.engine, f.answer_date::text date, f.answer_id, f.prompt_id, p.text prompt_text,
      a.brand_mentioned, a.brand_cited, count(*) over ()::int total
    from ai_fanouts f join prompts p on p.id = f.prompt_id join ai_answers a on a.id = f.answer_id
    where f.project_id = ${s.project.id} and lower(trim(f.query)) = ${q}
      and f.answer_date between ${s.period.from}::date and ${s.period.to}::date
      ${s.engines.length ? sql`and f.engine in ${s.engines}` : sql``}
    order by f.answer_date desc limit 500`)) as unknown as {
    id: string;
    query: string;
    engine: string;
    date: string;
    answer_id: string;
    prompt_id: string;
    prompt_text: string;
    brand_mentioned: boolean;
    brand_cited: boolean;
    total: number;
  }[];
  if (!rows.length) throw new ApiError("not_found", "Fan-out query not found in this period.");
  return {
    period: periodInfo(s),
    query: rows[0]!.query,
    occurrences: Number(rows[0]!.total),
    answersShown: rows.length,
    models: [...new Set(rows.map((r) => r.engine))],
    prompts: [...new Map(rows.map((r) => [r.prompt_id, { promptId: r.prompt_id, text: r.prompt_text }])).values()],
    answers: rows.map((r) => ({
      answerId: r.answer_id,
      promptId: r.prompt_id,
      model: r.engine,
      date: r.date,
      brandMentioned: r.brand_mentioned,
      brandCited: r.brand_cited,
    })),
  };
}

/** Round helper re-exported for text summaries. */
export const r1 = round1;
