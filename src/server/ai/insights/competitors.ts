import "server-only";
import { sql } from "drizzle-orm";
import type { projects } from "@/server/db/schema";
import { METRIC_KEYS, type MetricKey, type MetricValues } from "@/features/ai-insights/lib/metrics";
import type { BrandDTO, BrandSuggestion, CompetitorsData, EngineShare, RankingRow } from "@/features/ai-insights/types";
import { brandNames, getBrands, OWN_KEY, type BrandInfo } from "./brands";
import { loadBrandMetrics, metricsByBrand, metricsByDim, metricsByGroup, toMetrics, sumsOf } from "./brand-metrics";
import { addDays, dayRange, delta, isoDay, pct, rows, scope, type InsightFilter } from "./filters";
import { getPromptMap, getTagGroups } from "./prompts";

type ProjectRow = typeof projects.$inferSelect;

export function toBrandDTO(b: BrandInfo): BrandDTO {
  return {
    key: b.key,
    competitorId: b.competitorId,
    isOwn: b.isOwn,
    name: b.name,
    domain: b.domain,
    aliases: b.aliases,
    color: b.color,
    tracked: b.tracked,
    source: b.source,
  };
}

export function metricDeltas(cur: MetricValues, prev: MetricValues): MetricValues {
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, delta(cur[k], prev[k])])) as MetricValues;
}

export async function getCompetitorsData(project: ProjectRow, f: InsightFilter): Promise<CompetitorsData> {
  const brands = await getBrands(project);
  const keys = brands.map((b) => b.key);
  const [cur, prev, tagInfo, suggestions] = await Promise.all([
    loadBrandMetrics(f, "cur", ["date", "engine", "prompt"]),
    loadBrandMetrics(f, "prev"),
    getTagGroups(project.id),
    getBrandSuggestions(project, brands),
  ]);
  const curM = metricsByBrand(cur, keys);
  const prevM = metricsByBrand(prev, keys);
  const byEngine = metricsByDim(cur, "engine", keys);
  const byDate = metricsByDim(cur, "date", keys);
  const byTag = metricsByGroup(cur, tagInfo.groups, keys);
  const engineKeys = [...cur.totals.engine.keys()].sort();

  const rowsOut: RankingRow[] = brands.map((b) => {
    const engines: EngineShare[] = engineKeys.map((e) => {
      const total = cur.totals.engine.get(e) ?? 0;
      const visible = cur.by.engine.get(b.key)?.get(e)?.visible ?? 0;
      return { engine: e, visibility: pct(visible, total) ?? 0, visible, answers: total };
    });
    return { key: b.key, metrics: curM.get(b.key)!, deltas: metricDeltas(curM.get(b.key)!, prevM.get(b.key)!), engines };
  });

  const dates = dayRange(f.from, f.to);
  const series: CompetitorsData["series"] = {};
  for (const b of brands) {
    const perMetric: Partial<Record<MetricKey, (number | null)[]>> = {};
    for (const m of METRIC_KEYS) perMetric[m] = dates.map((d) => byDate.get(d)?.get(b.key)?.[m] ?? null);
    series[b.key] = perMetric;
  }

  const engineValues: Record<string, Record<string, MetricValues>> = {};
  const tagValues: Record<string, Record<string, MetricValues>> = {};
  for (const b of brands) {
    engineValues[b.key] = Object.fromEntries(engineKeys.map((e) => [e, byEngine.get(e)!.get(b.key)!]));
    tagValues[b.key] = Object.fromEntries([...byTag.keys()].map((t) => [t, byTag.get(t)!.get(b.key)!]));
  }

  return {
    brands: brands.map(toBrandDTO),
    rows: rowsOut,
    dates,
    series,
    byEngine: { keys: engineKeys, values: engineValues },
    byTag: { keys: tagInfo.tags.filter((t) => byTag.has(t.id)).map((t) => ({ id: t.id, name: t.name })), values: tagValues },
    totals: { answers: cur.total, prompts: cur.totals.prompt.size },
    suggestions,
  };
}

/* ───────────────────────────── Suggestions ───────────────────────────── */

export function dismissedBrands(project: ProjectRow): string[] {
  const s = (project.settings ?? {}) as { aiInsights?: { dismissedBrands?: unknown } };
  const list = s.aiInsights?.dismissedBrands;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Untracked brands (ai_mentions with isOwn=false and competitorId=null) that AI engines name
 * frequently in the last 90 days — offered as "Suggested competitors".
 */
export async function getBrandSuggestions(project: ProjectRow, brands: BrandInfo[]): Promise<BrandSuggestion[]> {
  const today = isoDay(new Date());
  const from = addDays(today, -89);
  const known = new Set([...brands.flatMap((b) => brandNames(b)), ...dismissedBrands(project).map((d) => d.toLowerCase())]);
  const res = await rows<{ name: string; key: string; answers: number; prompts: number; engines: string[]; avg_pos: number | null; last_seen: string; sample: string | null }>(sql`
    select min(m.brand_name) as name, lower(trim(m.brand_name)) as key,
           count(distinct m.answer_id)::int as answers, count(distinct m.prompt_id)::int as prompts,
           array_agg(distinct m.engine) as engines, avg(m.position)::float8 as avg_pos,
           to_char(max(m.answer_date), 'YYYY-MM-DD') as last_seen,
           (array_agg(m.snippet order by m.answer_date desc) filter (where m.snippet is not null))[1] as sample
    from ai_mentions m
    where m.project_id = ${project.id} and m.competitor_id is null and m.is_own = false
      and m.answer_date between ${from}::date and ${today}::date
    group by 2
    having count(distinct m.answer_id) >= 2
    order by 3 desc
    limit 40`);
  return res
    .filter((r) => !known.has(r.key))
    .slice(0, 12)
    .map((r) => ({
      name: r.name.trim(),
      answers: r.answers,
      prompts: r.prompts,
      engines: r.engines ?? [],
      avgPosition: r.avg_pos,
      lastSeen: r.last_seen,
      sample: r.sample ? r.sample.slice(0, 240) : null,
    }));
}

/* ───────────────────────────── Detail ───────────────────────────── */

export type CompetitorDetail = {
  brand: BrandDTO;
  own: BrandDTO;
  kpis: { key: MetricKey; you: number | null; them: number | null; youDelta: number | null; themDelta: number | null }[];
  dates: string[];
  series: Record<"you" | "them", Partial<Record<MetricKey, (number | null)[]>>>;
  headToHead: {
    shared: number;
    wins: number;
    losses: number;
    ties: number;
    byEngine: { engine: string; shared: number; wins: number; losses: number }[];
  };
  claims: { id: string; label: string; winner: "you" | "them" | "tie" | null; engine: string; date: string; answerId: string; promptText: string }[];
  prompts: {
    id: string;
    text: string;
    country: string;
    tags: { id: string; name: string; color: string | null }[];
    answers: number;
    them: number;
    you: number;
    themPos: number | null;
    youPos: number | null;
  }[];
  sources: { id: string; url: string; domain: string; title: string | null; contentType: string; ownership: string; answers: number; withYou: number }[];
  sentiment: {
    score: number | null;
    praise: number;
    neutral: number;
    criticism: number;
    topPraise: { attribute: string; count: number; quote: string }[];
    topCriticism: { attribute: string; count: number; quote: string }[];
  };
  totals: { answers: number };
};

export async function getCompetitorDetail(project: ProjectRow, f: InsightFilter, competitorId: string): Promise<CompetitorDetail | null> {
  const brands = await getBrands(project);
  const brand = brands.find((b) => b.competitorId === competitorId);
  const own = brands.find((b) => b.isOwn)!;
  if (!brand) return null;
  const keys = brands.map((b) => b.key);

  const [cur, prev, promptMap, h2h, claims, sources, statements] = await Promise.all([
    loadBrandMetrics(f, "cur", ["date", "prompt"]),
    loadBrandMetrics(f, "prev"),
    getPromptMap(project.id),
    rows<{ engine: string | null; shared: number; wins: number; losses: number; g: number }>(sql`
      with ans as (
        select a.id, a.engine, a.brand_position from ai_answers a
        where a.status = 'ok' and a.brand_mentioned and a.brand_position is not null and ${scope(f, "a")}
      ),
      them as (
        select m.answer_id, min(m.position) as position from ai_mentions m
        where ${scope(f, "m")} and m.competitor_id = ${competitorId}
        group by 1
      )
      select ans.engine, count(*)::int as shared,
             (count(*) filter (where ans.brand_position < them.position))::int as wins,
             (count(*) filter (where ans.brand_position > them.position))::int as losses,
             grouping(ans.engine)::int as g
      from ans join them on them.answer_id = ans.id
      group by grouping sets ((), (ans.engine))`),
    rows<{ id: string; label: string; winner: string | null; is_own: boolean; engine: string; date: string; answer_id: string; prompt_id: string }>(sql`
      select r.id, r.label, r.winner, r.is_own, r.engine, to_char(r.answer_date, 'YYYY-MM-DD') as date, r.answer_id, r.prompt_id
      from ai_recommendations r
      where ${scope(f, "r")} and r.kind = 'head_to_head'
        and ((r.competitor_id = ${competitorId} and r.opponent_is_own) or (r.is_own and r.opponent_competitor_id = ${competitorId}))
      order by r.answer_date desc
      limit 200`),
    rows<{ id: string; url: string; domain: string; title: string | null; content_type: string; ownership: string; answers: number; with_you: number }>(sql`
      with them as (
        select distinct m.answer_id from ai_mentions m where ${scope(f, "m")} and m.competitor_id = ${competitorId}
      )
      select s.id, s.url, s.domain, s.title, s.content_type, s.ownership,
             count(distinct c.answer_id)::int as answers,
             (count(distinct c.answer_id) filter (where a.brand_mentioned))::int as with_you
      from ai_citations c
      join them on them.answer_id = c.answer_id
      join ai_sources s on s.id = c.source_id
      join ai_answers a on a.id = c.answer_id
      where ${scope(f, "c")}
      group by s.id
      order by answers desc
      limit 15`),
    rows<{ polarity: string; attribute: string | null; n: number; quote: string }>(sql`
      select st.polarity, st.attribute, count(*)::int as n, (array_agg(st.quote order by st.severity desc))[1] as quote
      from ai_statements st
      where ${scope(f, "st")} and st.competitor_id = ${competitorId}
      group by 1, 2
      order by n desc`),
  ]);

  const curM = metricsByBrand(cur, keys);
  const prevM = metricsByBrand(prev, keys);
  const kpiKeys: MetricKey[] = ["visibility", "mentionRate", "citationRate", "sov", "avgPosition", "sentiment"];
  const kpis = kpiKeys.map((k) => ({
    key: k,
    you: curM.get(OWN_KEY)![k],
    them: curM.get(brand.key)![k],
    youDelta: delta(curM.get(OWN_KEY)![k], prevM.get(OWN_KEY)![k]),
    themDelta: delta(curM.get(brand.key)![k], prevM.get(brand.key)![k]),
  }));

  const dates = dayRange(f.from, f.to);
  const byDate = metricsByDim(cur, "date", keys);
  const seriesFor = (key: string) =>
    Object.fromEntries(kpiKeys.map((m) => [m, dates.map((d) => byDate.get(d)?.get(key)?.[m] ?? null)])) as Partial<Record<MetricKey, (number | null)[]>>;

  const promptRows: CompetitorDetail["prompts"] = [];
  for (const [promptId, total] of cur.totals.prompt) {
    const p = promptMap.get(promptId);
    if (!p) continue;
    const sums = sumsOf([...cur.by.prompt.values()].map((m) => m.get(promptId)));
    const them = toMetrics(cur.by.prompt.get(brand.key)?.get(promptId), total, sums);
    const you = toMetrics(cur.by.prompt.get(OWN_KEY)?.get(promptId), total, sums);
    promptRows.push({
      id: promptId,
      text: p.text,
      country: p.country,
      tags: p.tags,
      answers: total,
      them: them.visibility ?? 0,
      you: you.visibility ?? 0,
      themPos: them.avgPosition,
      youPos: you.avgPosition,
    });
  }
  promptRows.sort((a, b) => b.them - b.you - (a.them - a.you));

  const overall = h2h.find((r) => r.g === 1);
  const polarityCount = (p: string) => statements.filter((s) => s.polarity === p).reduce((a, s) => a + s.n, 0);
  const top = (p: string) =>
    statements
      .filter((s) => s.polarity === p && s.attribute)
      .slice(0, 5)
      .map((s) => ({ attribute: s.attribute!, count: s.n, quote: s.quote }));

  return {
    brand: toBrandDTO(brand),
    own: toBrandDTO(own),
    kpis,
    dates,
    series: { you: seriesFor(OWN_KEY), them: seriesFor(brand.key) },
    headToHead: {
      shared: overall?.shared ?? 0,
      wins: overall?.wins ?? 0,
      losses: overall?.losses ?? 0,
      ties: (overall?.shared ?? 0) - (overall?.wins ?? 0) - (overall?.losses ?? 0),
      byEngine: h2h.filter((r) => r.g === 0 && r.engine).map((r) => ({ engine: r.engine!, shared: r.shared, wins: r.wins, losses: r.losses })),
    },
    claims: claims.map((c) => {
      // Normalise the winner to the own-brand perspective.
      let winner: "you" | "them" | "tie" | null = null;
      if (c.winner === "tie") winner = "tie";
      else if (c.winner === "brand") winner = c.is_own ? "you" : "them";
      else if (c.winner === "opponent") winner = c.is_own ? "them" : "you";
      return { id: c.id, label: c.label, winner, engine: c.engine, date: c.date, answerId: c.answer_id, promptText: promptMap.get(c.prompt_id)?.text ?? "" };
    }),
    prompts: promptRows,
    sources: sources.map((s) => ({
      id: s.id,
      url: s.url,
      domain: s.domain,
      title: s.title,
      contentType: s.content_type,
      ownership: s.ownership,
      answers: s.answers,
      withYou: s.with_you,
    })),
    sentiment: {
      score: curM.get(brand.key)!.sentiment,
      praise: polarityCount("praise"),
      neutral: polarityCount("neutral"),
      criticism: polarityCount("criticism"),
      topPraise: top("praise"),
      topCriticism: top("criticism"),
    },
    totals: { answers: cur.total },
  };
}
