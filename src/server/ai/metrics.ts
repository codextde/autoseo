import "server-only";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  aiAdAppearances,
  aiAds,
  aiAnswers,
  aiCitations,
  aiFanouts,
  aiMentions,
  aiProductAppearances,
  aiProducts,
  aiRecommendations,
  aiRuns,
  aiSources,
  aiStatements,
  competitors,
  projects,
  promptTagLinks,
  promptTags,
  prompts,
} from "@/server/db/schema";
import { ownBrandTerms } from "@/server/ai/analysis/brand-match";
import { eachDay, type DayRange, type PeriodRange } from "@/features/ai-tracking/period";
import type {
  AnswerDetail,
  AnswerListItem,
  BrandChip,
  CompareSeries,
  CountryRow,
  DayPoint,
  EngineCell,
  FanoutRow,
  FlowState,
  KpiKey,
  KpiWithDelta,
  PromptDay,
  PromptFlow,
  PromptRow,
  RunInfo,
  TrackerKpis,
} from "@/features/ai-tracking/types";

/**
 * Tracker metrics (finseo KPI definitions), computed over `ai_answers` with status "ok":
 * - Visibility     = answers that name OR cite the own brand ÷ all answers
 * - Mention rate   = answers naming the brand ÷ all answers
 * - Citation rate  = answers citing an own-domain page ÷ all answers
 * - Avg position   = mean ordinal position of the brand where it is named (1 = named first)
 * - Mention depth  = mean char offset of the first mention ÷ answer length (0 = top)
 * - Sentiment      = mean own-brand sentiment 0–100 (LLM pass)
 * - Share of voice = answers naming the own brand ÷ answer-appearances of all tracked brands
 * Deltas compare with the previous period of equal length.
 */

export type TrackerFilter = {
  projectId: string;
  engines?: string[];
  tagIds?: string[];
  countries?: string[];
  /** Prompt status filter (default: active prompts only). */
  status?: "active" | "archived" | "all";
  promptIds?: string[];
};

type Row = Record<string, unknown>;

function list(values: string[]): SQL {
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
}

/** WHERE fragment over ai_answers aliased as `a`. */
function answerWhere(f: TrackerFilter, range: DayRange): SQL {
  const parts: SQL[] = [
    sql`a.project_id = ${f.projectId}`,
    sql`a.status = 'ok'`,
    sql`a.answer_date between ${range.from}::date and ${range.to}::date`,
  ];
  if (f.engines?.length) parts.push(sql`a.engine in (${list(f.engines)})`);
  if (f.countries?.length) parts.push(sql`a.country in (${list(f.countries)})`);
  if (f.promptIds?.length) parts.push(sql`a.prompt_id in (${list(f.promptIds)})`);
  const status = f.status ?? "active";
  if (status !== "all") parts.push(sql`a.prompt_id in (select p.id from prompts p where p.project_id = ${f.projectId} and p.status = ${status})`);
  if (f.tagIds?.length) parts.push(sql`a.prompt_id in (select l.prompt_id from prompt_tag_links l where l.tag_id in (${list(f.tagIds)}))`);
  return sql.join(parts, sql` and `);
}

async function rows(query: SQL): Promise<Row[]> {
  return (await db.execute(query)) as unknown as Row[];
}

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const nn = (v: unknown): number | null => (v == null ? null : Number(v));
const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
const diff = (a: number | null, b: number | null) => (a == null || b == null ? null : Math.round((a - b) * 10) / 10);

const EMPTY_KPIS: TrackerKpis = {
  answers: 0,
  prompts: 0,
  visible: 0,
  mentioned: 0,
  cited: 0,
  visibility: null,
  mentionRate: null,
  citationRate: null,
  position: null,
  mentionDepth: null,
  sentiment: null,
  shareOfVoice: null,
};

async function kpisFor(f: TrackerFilter, range: DayRange): Promise<TrackerKpis> {
  const w = answerWhere(f, range);
  const [agg] = await rows(sql`
    select count(*)::int answers,
      count(distinct a.prompt_id)::int prompts,
      count(*) filter (where a.brand_mentioned or a.brand_cited)::int visible,
      count(*) filter (where a.brand_mentioned)::int mentioned,
      count(*) filter (where a.brand_cited)::int cited,
      avg(a.brand_position) filter (where a.brand_mentioned)::float8 position,
      avg(a.mention_depth) filter (where a.brand_mentioned)::float8 depth,
      avg(a.sentiment)::float8 sentiment
    from ai_answers a where ${w}`);
  const [sov] = await rows(sql`
    select count(*) filter (where m.is_own)::int own, count(*)::int total
    from ai_mentions m join ai_answers a on a.id = m.answer_id
    where ${w} and (m.is_own or m.competitor_id is not null)`);
  const answers = n(agg?.answers);
  if (!answers) return EMPTY_KPIS;
  return {
    answers,
    prompts: n(agg?.prompts),
    visible: n(agg?.visible),
    mentioned: n(agg?.mentioned),
    cited: n(agg?.cited),
    visibility: pct(n(agg?.visible), answers),
    mentionRate: pct(n(agg?.mentioned), answers),
    citationRate: pct(n(agg?.cited), answers),
    position: round1(nn(agg?.position)),
    mentionDepth: round1(nn(agg?.depth)),
    sentiment: round1(nn(agg?.sentiment)),
    shareOfVoice: pct(n(sov?.own), n(sov?.total)),
  };
}

export async function getTrackerKpis(f: TrackerFilter, period: PeriodRange): Promise<KpiWithDelta> {
  const [current, previous] = await Promise.all([kpisFor(f, period), kpisFor(f, period.prev)]);
  return { current, previous };
}

export function kpiDelta(k: KpiWithDelta, key: keyof TrackerKpis): number | null {
  return diff(k.current[key] as number | null, k.previous[key] as number | null);
}

/** Per-day series incl. the visibility mix (mentioned+cited / mentioned only / cited only / none). */
export async function getDailySeries(f: TrackerFilter, range: DayRange): Promise<DayPoint[]> {
  const w = answerWhere(f, range);
  const data = await rows(sql`
    select a.answer_date::text d, count(*)::int answers,
      count(*) filter (where a.brand_mentioned or a.brand_cited)::int visible,
      count(*) filter (where a.brand_mentioned)::int mentioned,
      count(*) filter (where a.brand_cited)::int cited,
      count(*) filter (where a.brand_mentioned and a.brand_cited)::int both,
      avg(a.brand_position) filter (where a.brand_mentioned)::float8 position,
      avg(a.sentiment)::float8 sentiment
    from ai_answers a where ${w} group by 1`);
  const byDay = new Map(data.map((r) => [String(r.d), r]));
  return eachDay(range).map((date) => {
    const r = byDay.get(date);
    const answers = n(r?.answers);
    const both = n(r?.both);
    const mentioned = n(r?.mentioned);
    const cited = n(r?.cited);
    return {
      date,
      answers,
      visibility: pct(n(r?.visible), answers),
      mentionRate: pct(mentioned, answers),
      citationRate: pct(cited, answers),
      position: round1(nn(r?.position)),
      sentiment: round1(nn(r?.sentiment)),
      both,
      mentionedOnly: mentioned - both,
      citedOnly: cited - both,
      none: answers - n(r?.visible),
    };
  });
}

/** Competitor series for the Trends "Compare" selector (same KPI definitions per competitor). */
export async function getCompetitorSeries(f: TrackerFilter, range: DayRange, competitorIds: string[]): Promise<CompareSeries[]> {
  if (!competitorIds.length) return [];
  const comps = await db
    .select({ id: competitors.id, name: competitors.name, color: competitors.color })
    .from(competitors)
    .where(and(eq(competitors.projectId, f.projectId), inArray(competitors.id, competitorIds)));
  if (!comps.length) return [];
  const ids = comps.map((c) => c.id);
  const w = answerWhere(f, range);
  const [totals, mentioned, visible, cited] = await Promise.all([
    rows(sql`select a.answer_date::text d, count(*)::int answers from ai_answers a where ${w} group by 1`),
    rows(sql`
      select a.answer_date::text d, m.competitor_id cid, count(*)::int mentioned, avg(m.position)::float8 position
      from ai_mentions m join ai_answers a on a.id = m.answer_id
      where ${w} and m.competitor_id in (${list(ids)}) group by 1, 2`),
    rows(sql`
      select d, cid, count(distinct answer_id)::int visible from (
        select a.answer_date::text d, m.competitor_id cid, m.answer_id from ai_mentions m join ai_answers a on a.id = m.answer_id
        where ${w} and m.competitor_id in (${list(ids)})
        union all
        select a.answer_date::text d, s.competitor_id cid, c.answer_id from ai_citations c
        join ai_sources s on s.id = c.source_id join ai_answers a on a.id = c.answer_id
        where ${w} and s.competitor_id in (${list(ids)})
      ) x group by 1, 2`),
    rows(sql`
      select a.answer_date::text d, s.competitor_id cid, count(distinct c.answer_id)::int cited from ai_citations c
      join ai_sources s on s.id = c.source_id join ai_answers a on a.id = c.answer_id
      where ${w} and s.competitor_id in (${list(ids)}) group by 1, 2`),
  ]);
  const totalByDay = new Map(totals.map((r) => [String(r.d), n(r.answers)]));
  return comps.map((c) => {
    const values: CompareSeries["values"] = {};
    for (const date of eachDay(range)) {
      const total = totalByDay.get(date) ?? 0;
      if (!total) continue;
      const m = mentioned.find((r) => r.d === date && r.cid === c.id);
      const v = visible.find((r) => r.d === date && r.cid === c.id);
      const ci = cited.find((r) => r.d === date && r.cid === c.id);
      values[date] = {
        visibility: pct(n(v?.visible), total),
        mentionRate: pct(n(m?.mentioned), total),
        citationRate: pct(n(ci?.cited), total),
        position: round1(nn(m?.position)),
      };
    }
    return { key: c.id, label: c.name, color: c.color, values };
  });
}

/** "Prompts per day": per prompt visibility vs its previous tracked day → net+ / net− / even. */
export async function getPromptsPerDay(f: TrackerFilter, range: DayRange): Promise<PromptDay[]> {
  // Look back a bit so the first day of the range has a comparison point.
  const lookback: DayRange = { from: sqlDay(range.from, -14), to: range.to, days: range.days + 14 };
  const data = await rows(sql`
    select a.prompt_id pid, a.answer_date::text d, count(*)::int answers,
      count(*) filter (where a.brand_mentioned or a.brand_cited)::int visible
    from ai_answers a where ${answerWhere(f, lookback)} group by 1, 2 order by 1, 2`);
  const texts = await promptTextMap(f.projectId, [...new Set(data.map((r) => String(r.pid)))]);
  const days = new Map<string, PromptDay>(eachDay(range).map((d) => [d, { date: d, prompts: 0, answers: 0, improved: 0, declined: 0, even: 0, details: [] }]));
  let prevPid = "";
  let prevVal: number | null = null;
  for (const r of data) {
    const pid = String(r.pid);
    if (pid !== prevPid) {
      prevPid = pid;
      prevVal = null;
    }
    const val = n(r.answers) ? (n(r.visible) / n(r.answers)) * 100 : 0;
    const day = days.get(String(r.d));
    if (day) {
      day.prompts++;
      day.answers += n(r.answers);
      if (prevVal == null || Math.abs(val - prevVal) < 0.5) day.even++;
      else {
        if (val > prevVal) day.improved++;
        else day.declined++;
        day.details.push({ promptId: pid, text: texts.get(pid) ?? "", from: Math.round(prevVal), to: Math.round(val) });
      }
    }
    prevVal = val;
  }
  return [...days.values()];
}

function sqlDay(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

async function promptTextMap(projectId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const r = await db
    .select({ id: prompts.id, text: prompts.text })
    .from(prompts)
    .where(and(eq(prompts.projectId, projectId), inArray(prompts.id, ids)));
  return new Map(r.map((x) => [x.id, x.text]));
}

const STATE_RANK: Record<FlowState, number> = { new: -1, none: 0, cited: 1, mentioned: 2, both: 3 };

function dominantState(r: Row | undefined): FlowState | null {
  if (!r || !n(r.answers)) return null;
  const counts: [FlowState, number][] = [
    ["both", n(r.both)],
    ["mentioned", n(r.mentioned) - n(r.both)],
    ["cited", n(r.cited) - n(r.both)],
    ["none", n(r.answers) - n(r.visible)],
  ];
  // Most frequent state; ties resolve to the better state.
  counts.sort((a, b) => b[1] - a[1] || STATE_RANK[b[0]] - STATE_RANK[a[0]]);
  return counts[0]![0];
}

/** Prompt flow between the previous and the current period (dominant visibility state per prompt). */
export async function getPromptFlow(f: TrackerFilter, period: PeriodRange): Promise<PromptFlow> {
  const both: DayRange = { from: period.prev.from, to: period.to, days: period.days * 2 };
  const data = await rows(sql`
    select a.prompt_id pid, (a.answer_date >= ${period.from}::date) cur, count(*)::int answers,
      count(*) filter (where a.brand_mentioned or a.brand_cited)::int visible,
      count(*) filter (where a.brand_mentioned)::int mentioned,
      count(*) filter (where a.brand_cited)::int cited,
      count(*) filter (where a.brand_mentioned and a.brand_cited)::int both
    from ai_answers a where ${answerWhere(f, both)} group by 1, 2`);
  const byPrompt = new Map<string, { cur?: Row; prev?: Row }>();
  for (const r of data) {
    const e = byPrompt.get(String(r.pid)) ?? {};
    if (r.cur === true || r.cur === "t") e.cur = r;
    else e.prev = r;
    byPrompt.set(String(r.pid), e);
  }
  const zero = (): Record<FlowState, number> => ({ both: 0, mentioned: 0, cited: 0, none: 0, new: 0 });
  const totals = { previous: zero(), current: zero() };
  const linkMap = new Map<string, number>();
  let improved = 0;
  let declined = 0;
  let unchanged = 0;
  for (const e of byPrompt.values()) {
    const cur = dominantState(e.cur);
    if (!cur) continue;
    const prev = dominantState(e.prev) ?? "new";
    totals.previous[prev]++;
    totals.current[cur]++;
    linkMap.set(`${prev}>${cur}`, (linkMap.get(`${prev}>${cur}`) ?? 0) + 1);
    if (prev === "new") continue;
    if (STATE_RANK[cur] > STATE_RANK[prev]) improved++;
    else if (STATE_RANK[cur] < STATE_RANK[prev]) declined++;
    else unchanged++;
  }
  return {
    links: [...linkMap].map(([k, value]) => {
      const [from, to] = k.split(">") as [FlowState, FlowState];
      return { from, to, value };
    }),
    improved,
    declined,
    unchanged,
    totals,
  };
}

/** Per-country aggregates (Locations tab). */
export async function getCountryRows(f: TrackerFilter, period: PeriodRange): Promise<CountryRow[]> {
  const q = (range: DayRange) =>
    rows(sql`
      select a.country, count(distinct a.prompt_id)::int prompts, count(*)::int answers,
        count(*) filter (where a.brand_mentioned or a.brand_cited)::int visible,
        count(*) filter (where a.brand_mentioned)::int mentioned,
        count(*) filter (where a.brand_cited)::int cited,
        avg(a.brand_position) filter (where a.brand_mentioned)::float8 position,
        avg(a.sentiment)::float8 sentiment
      from ai_answers a where ${answerWhere(f, range)} group by 1`);
  const [cur, prev] = await Promise.all([q(period), q(period.prev)]);
  const prevMap = new Map(prev.map((r) => [String(r.country), pct(n(r.visible), n(r.answers))]));
  return cur
    .map((r) => {
      const answers = n(r.answers);
      const visibility = pct(n(r.visible), answers);
      return {
        country: String(r.country),
        prompts: n(r.prompts),
        answers,
        visibility,
        mentionRate: pct(n(r.mentioned), answers),
        citationRate: pct(n(r.cited), answers),
        position: round1(nn(r.position)),
        sentiment: round1(nn(r.sentiment)),
        visibilityDelta: diff(visibility, prevMap.get(String(r.country)) ?? null),
      };
    })
    .sort((a, b) => b.answers - a.answers);
}

/** Prompt table rows with per-engine breakdown and deltas vs the previous period. */
export async function getPromptRows(f: TrackerFilter, period: PeriodRange): Promise<PromptRow[]> {
  const status = f.status ?? "active";
  const pConds = [eq(prompts.projectId, f.projectId)];
  if (status !== "all") pConds.push(eq(prompts.status, status));
  if (f.countries?.length) pConds.push(inArray(prompts.country, f.countries));
  if (f.promptIds?.length) pConds.push(inArray(prompts.id, f.promptIds));
  if (f.tagIds?.length) {
    pConds.push(inArray(prompts.id, db.select({ id: promptTagLinks.promptId }).from(promptTagLinks).where(inArray(promptTagLinks.tagId, f.tagIds))));
  }
  const [project] = await db.select({ engines: projects.engines }).from(projects).where(eq(projects.id, f.projectId)).limit(1);
  const list_ = await db.select().from(prompts).where(and(...pConds)).orderBy(desc(prompts.createdAt));
  if (!list_.length) return [];
  const ids = list_.map((p) => p.id);
  const scoped: TrackerFilter = { ...f, status: "all", promptIds: ids };

  const aggQuery = (range: DayRange, byEngine: boolean) =>
    rows(sql`
      select a.prompt_id pid, ${byEngine ? sql`a.engine` : sql`''`} engine, count(*)::int answers,
        count(*) filter (where a.brand_mentioned or a.brand_cited)::int visible,
        count(*) filter (where a.brand_mentioned)::int mentioned,
        count(*) filter (where a.brand_cited)::int cited,
        coalesce(sum(a.own_citation_count), 0)::int citations,
        avg(a.sentiment)::float8 sentiment,
        avg(a.brand_position) filter (where a.brand_mentioned)::float8 position
      from ai_answers a where ${answerWhere(scoped, range)} group by 1, 2`);

  const [curEng, prevAll, latest, brandRows, tagRows] = await Promise.all([
    aggQuery(period, true),
    aggQuery(period.prev, false),
    // Latest answer (ok or error) per prompt × engine in the period.
    rows(sql`
      select distinct on (a.prompt_id, a.engine) a.prompt_id pid, a.engine, a.id, a.status, a.answer_date::text d,
        (a.brand_mentioned or a.brand_cited) visible
      from ai_answers a
      where a.project_id = ${f.projectId} and a.prompt_id in (${list(ids)})
        and a.answer_date between ${period.from}::date and ${period.to}::date
        ${f.engines?.length ? sql`and a.engine in (${list(f.engines)})` : sql``}
      order by a.prompt_id, a.engine, a.answer_date desc`),
    rows(sql`
      select m.prompt_id pid, m.engine, m.competitor_id cid, c.name, c.domain, count(*)::int cnt
      from ai_mentions m join ai_answers a on a.id = m.answer_id join competitors c on c.id = m.competitor_id
      where ${answerWhere(scoped, period)} and m.competitor_id is not null
      group by 1, 2, 3, 4, 5`),
    db
      .select({ promptId: promptTagLinks.promptId, id: promptTags.id, name: promptTags.name, color: promptTags.color })
      .from(promptTagLinks)
      .innerJoin(promptTags, eq(promptTags.id, promptTagLinks.tagId))
      .where(inArray(promptTagLinks.promptId, ids)),
  ]);

  const prevMap = new Map(prevAll.map((r) => [String(r.pid), r]));
  const tagsByPrompt = new Map<string, PromptRow["tags"]>();
  for (const t of tagRows) {
    const arr = tagsByPrompt.get(t.promptId) ?? [];
    arr.push({ id: t.id, name: t.name, color: t.color });
    tagsByPrompt.set(t.promptId, arr);
  }
  const chips = (filter: (r: Row) => boolean): BrandChip[] => {
    const acc = new Map<string, BrandChip>();
    for (const r of brandRows) {
      if (!filter(r)) continue;
      const id = String(r.cid);
      const cur = acc.get(id) ?? { competitorId: id, name: String(r.name), domain: (r.domain as string | null) ?? null, count: 0 };
      cur.count += n(r.cnt);
      acc.set(id, cur);
    }
    return [...acc.values()].sort((a, b) => b.count - a.count);
  };

  return list_.map((p) => {
    const engines = (p.engines?.length ? (project?.engines ?? []).filter((e) => p.engines!.includes(e)) : (project?.engines ?? [])).filter(
      (e) => !f.engines?.length || f.engines.includes(e),
    );
    const engRows = curEng.filter((r) => r.pid === p.id);
    const engineSet = [...new Set([...engines, ...engRows.map((r) => String(r.engine))])];
    const perEngine: EngineCell[] = engineSet.map((engine) => {
      const r = engRows.find((x) => x.engine === engine);
      const l = latest.find((x) => x.pid === p.id && x.engine === engine);
      const answers = n(r?.answers);
      return {
        engine,
        answers,
        visible: n(r?.visible),
        mentioned: n(r?.mentioned),
        cited: n(r?.cited),
        citations: n(r?.citations),
        visibility: pct(n(r?.visible), answers),
        sentiment: round1(nn(r?.sentiment)),
        position: round1(nn(r?.position)),
        latestVisible: l ? l.status === "ok" && (l.visible === true || l.visible === "t") : null,
        latestDate: l ? String(l.d) : null,
        latestAnswerId: l ? String(l.id) : null,
        latestStatus: l ? (l.status as "ok" | "error") : null,
        brands: chips((x) => x.pid === p.id && x.engine === engine).slice(0, 6),
      };
    });
    const sum = (k: keyof EngineCell) => perEngine.reduce((acc, e) => acc + (typeof e[k] === "number" ? (e[k] as number) : 0), 0);
    const answers = sum("answers");
    const visible = sum("visible");
    const mentions = sum("mentioned");
    const citations = sum("citations");
    const sentVals = engRows.filter((r) => r.sentiment != null);
    const sentiment = sentVals.length
      ? round1(sentVals.reduce((a, r) => a + n(r.sentiment) * n(r.answers), 0) / Math.max(1, sentVals.reduce((a, r) => a + n(r.answers), 0)))
      : null;
    const posVals = engRows.filter((r) => r.position != null);
    const position = posVals.length
      ? round1(posVals.reduce((a, r) => a + n(r.position) * n(r.mentioned), 0) / Math.max(1, posVals.reduce((a, r) => a + n(r.mentioned), 0)))
      : null;
    const prev = prevMap.get(p.id);
    const visibility = pct(visible, answers);
    const prevVisibility = prev ? pct(n(prev.visible), n(prev.answers)) : null;
    return {
      id: p.id,
      text: p.text,
      country: p.country,
      language: p.language,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      lastRunAt: p.lastRunAt?.toISOString() ?? null,
      engines: engineSet,
      tags: tagsByPrompt.get(p.id) ?? [],
      answers,
      visibility,
      visibilityDelta: diff(visibility, prevVisibility),
      mentions,
      mentionsDelta: prev ? mentions - n(prev.mentioned) : null,
      sentiment,
      sentimentDelta: diff(sentiment, prev ? round1(nn(prev.sentiment)) : null),
      citations,
      citationsDelta: prev ? citations - n(prev.citations) : null,
      position,
      brands: chips((x) => x.pid === p.id).slice(0, 8),
      perEngine,
    };
  });
}

/** Markers for the trend chart: days on which prompts were added. */
export async function getPromptAddedMarkers(projectId: string, range: DayRange): Promise<{ date: string; count: number }[]> {
  const data = await rows(sql`
    select (p.created_at at time zone 'UTC')::date::text d, count(*)::int cnt from prompts p
    where p.project_id = ${projectId} and (p.created_at at time zone 'UTC')::date between ${range.from}::date and ${range.to}::date
    group by 1 order by 1`);
  return data.map((r) => ({ date: String(r.d), count: n(r.cnt) }));
}

/* ─────────────────────────── Fan-outs ─────────────────────────── */

export async function getFanouts(projectId: string, range: DayRange, q?: string): Promise<FanoutRow[]> {
  const search = q?.trim() ? sql`and f.query ilike ${`%${q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`}` : sql``;
  const data = await rows(sql`
    select min(f.query) query, count(*)::int freq, array_agg(distinct f.engine) engines,
      array_agg(distinct f.prompt_id) prompt_ids, min(f.answer_date)::text first_seen, max(f.answer_date)::text last_seen
    from ai_fanouts f
    where f.project_id = ${projectId} and f.answer_date between ${range.from}::date and ${range.to}::date ${search}
    group by lower(trim(f.query))
    order by freq desc, last_seen desc
    limit 2000`);
  const pids = [...new Set(data.flatMap((r) => (r.prompt_ids as string[]) ?? []))];
  const texts = await promptTextMap(projectId, pids);
  return data.map((r) => ({
    query: String(r.query),
    frequency: n(r.freq),
    engines: ((r.engines as string[]) ?? []).filter(Boolean),
    prompts: ((r.prompt_ids as string[]) ?? []).map((id) => ({ id, text: texts.get(id) ?? "" })),
    firstSeen: String(r.first_seen),
    lastSeen: String(r.last_seen),
  }));
}

/* ─────────────────────────── Answers (response drawer) ─────────────────────────── */

export async function listPromptAnswers(projectId: string, promptId: string, days = 120): Promise<AnswerListItem[]> {
  const since = sqlDay(new Date().toISOString().slice(0, 10), -days);
  const data = await db
    .select({
      id: aiAnswers.id,
      engine: aiAnswers.engine,
      date: aiAnswers.answerDate,
      status: aiAnswers.status,
      provider: aiAnswers.provider,
      model: aiAnswers.model,
      brandMentioned: aiAnswers.brandMentioned,
      brandCited: aiAnswers.brandCited,
      position: aiAnswers.brandPosition,
      sentiment: aiAnswers.sentiment,
      analysisStatus: aiAnswers.analysisStatus,
    })
    .from(aiAnswers)
    .where(and(eq(aiAnswers.projectId, projectId), eq(aiAnswers.promptId, promptId), sql`${aiAnswers.answerDate} >= ${since}::date`))
    .orderBy(desc(aiAnswers.answerDate));
  return data;
}

export async function getAnswerDetail(projectId: string, answerId: string): Promise<AnswerDetail | null> {
  const [a] = await db
    .select({ answer: aiAnswers, promptText: prompts.text })
    .from(aiAnswers)
    .innerJoin(prompts, eq(prompts.id, aiAnswers.promptId))
    .where(and(eq(aiAnswers.projectId, projectId), eq(aiAnswers.id, answerId)))
    .limit(1);
  if (!a) return null;
  const ans = a.answer;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const [comps, mentions, cites, fanouts, products, ads, statements, recs] = await Promise.all([
    db.select().from(competitors).where(eq(competitors.projectId, projectId)),
    db.select().from(aiMentions).where(eq(aiMentions.answerId, answerId)).orderBy(aiMentions.position),
    db
      .select({
        url: aiSources.url,
        domain: aiSources.domain,
        title: aiSources.title,
        contentType: aiSources.contentType,
        ownership: aiSources.ownership,
        position: aiCitations.position,
      })
      .from(aiCitations)
      .innerJoin(aiSources, eq(aiSources.id, aiCitations.sourceId))
      .where(eq(aiCitations.answerId, answerId))
      .orderBy(aiCitations.position),
    db.select({ query: aiFanouts.query }).from(aiFanouts).where(eq(aiFanouts.answerId, answerId)),
    db
      .select({
        name: aiProducts.name,
        brand: aiProducts.brandName,
        imageUrl: aiProducts.imageUrl,
        source: aiProductAppearances.source,
        price: aiProductAppearances.price,
        oldPrice: aiProductAppearances.oldPrice,
        currency: aiProductAppearances.currency,
        rating: aiProductAppearances.rating,
        reviews: aiProductAppearances.reviews,
        store: aiProductAppearances.store,
        url: aiProductAppearances.url,
      })
      .from(aiProductAppearances)
      .innerJoin(aiProducts, eq(aiProducts.id, aiProductAppearances.productId))
      .where(eq(aiProductAppearances.answerId, answerId))
      .orderBy(aiProductAppearances.position),
    db
      .select({
        advertiser: aiAds.advertiser,
        advertiserDomain: aiAds.advertiserDomain,
        headline: aiAds.headline,
        description: aiAds.description,
        landingUrl: aiAds.landingUrl,
        position: aiAdAppearances.position,
      })
      .from(aiAdAppearances)
      .innerJoin(aiAds, eq(aiAds.id, aiAdAppearances.adId))
      .where(eq(aiAdAppearances.answerId, answerId))
      .orderBy(aiAdAppearances.position),
    db.select().from(aiStatements).where(eq(aiStatements.answerId, answerId)),
    db.select().from(aiRecommendations).where(eq(aiRecommendations.answerId, answerId)),
  ]);
  const highlights: AnswerDetail["highlights"] = [
    ...(project
      ? [{ name: project.name, terms: ownBrandTerms({ name: project.name, domain: project.domain, brand: project.brand }), kind: "own" as const, color: null }]
      : []),
    ...comps.map((c) => ({ name: c.name, terms: [c.name, ...(c.aliases ?? [])], kind: "competitor" as const, color: c.color })),
    ...mentions
      .filter((m) => !m.isOwn && !m.competitorId)
      .map((m) => ({ name: m.brandName, terms: [m.brandName], kind: "other" as const, color: null })),
  ];
  return {
    id: ans.id,
    engine: ans.engine,
    date: ans.answerDate,
    status: ans.status,
    provider: ans.provider,
    model: ans.model,
    brandMentioned: ans.brandMentioned,
    brandCited: ans.brandCited,
    position: ans.brandPosition,
    sentiment: ans.sentiment,
    analysisStatus: ans.analysisStatus,
    text: ans.text,
    error: ans.error,
    analysisError: ans.analysisError,
    costUsd: ans.costUsd,
    durationMs: ans.durationMs,
    createdAt: ans.createdAt.toISOString(),
    promptText: a.promptText,
    country: ans.country,
    highlights,
    mentions: mentions.map((m) => ({
      name: m.brandName,
      isOwn: m.isOwn,
      competitorId: m.competitorId,
      position: m.position,
      sentiment: m.sentiment,
      occurrences: m.occurrences,
      cited: m.cited,
      recommended: m.recommended,
      snippet: m.snippet,
    })),
    citations: cites,
    fanouts: fanouts.map((f) => f.query),
    products,
    ads,
    statements: statements.map((s) => ({
      brandName: s.brandName,
      isOwn: s.isOwn,
      polarity: s.polarity,
      theme: s.theme,
      attribute: s.attribute,
      quote: s.quote,
      severity: s.severity,
    })),
    recommendations: recs.map((r) => ({ kind: r.kind, label: r.label, brandName: r.brandName, opponentName: r.opponentName, winner: r.winner })),
  };
}

/* ─────────────────────────── Runs & usage ─────────────────────────── */

export function toRunInfo(r: typeof aiRuns.$inferSelect): RunInfo {
  return {
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    totalTasks: r.totalTasks,
    doneTasks: r.doneTasks,
    failedTasks: r.failedTasks,
    costUsd: r.costUsd,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    skipped: r.meta?.skipped ?? [],
  };
}

export async function getLatestRun(projectId: string): Promise<RunInfo | null> {
  const [r] = await db.select().from(aiRuns).where(eq(aiRuns.projectId, projectId)).orderBy(desc(aiRuns.createdAt)).limit(1);
  return r ? toRunInfo(r) : null;
}

/** Cost of tracking answers in the last 30 days (sum of answer costs). */
export async function getTrackingCost(projectId: string, days = 30): Promise<number> {
  const since = sqlDay(new Date().toISOString().slice(0, 10), -days);
  const [r] = await rows(sql`select coalesce(sum(cost_usd), 0)::float8 cost from ai_answers where project_id = ${projectId} and answer_date >= ${since}::date`);
  return n(r?.cost);
}

export type { KpiKey };
