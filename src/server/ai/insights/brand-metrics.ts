import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { emptyMetrics, type MetricValues } from "@/features/ai-insights/lib/metrics";
import { OWN_KEY } from "./brands";
import { avg, pct, rows, scope, type InsightFilter, type Range } from "./filters";

/**
 * Brand-level fact engine. For every (brand, answer) pair where the brand is named or its
 * domain is cited we derive: mentioned, cited, position, depth, sentiment, citation count.
 * The own brand uses the denormalised columns on ai_answers (same source as the Tracker);
 * competitors use ai_mentions + citations of competitor-owned sources.
 */

export type BrandAgg = {
  visible: number;
  mentioned: number;
  cited: number;
  cites: number;
  posSum: number;
  posN: number;
  depthSum: number;
  depthN: number;
  sentSum: number;
  sentN: number;
  first: number;
  top3: number;
};

export function emptyAgg(): BrandAgg {
  return { visible: 0, mentioned: 0, cited: 0, cites: 0, posSum: 0, posN: 0, depthSum: 0, depthN: 0, sentSum: 0, sentN: 0, first: 0, top3: 0 };
}

export function addAgg(a: BrandAgg, b: BrandAgg): BrandAgg {
  return {
    visible: a.visible + b.visible,
    mentioned: a.mentioned + b.mentioned,
    cited: a.cited + b.cited,
    cites: a.cites + b.cites,
    posSum: a.posSum + b.posSum,
    posN: a.posN + b.posN,
    depthSum: a.depthSum + b.depthSum,
    depthN: a.depthN + b.depthN,
    sentSum: a.sentSum + b.sentSum,
    sentN: a.sentN + b.sentN,
    first: a.first + b.first,
    top3: a.top3 + b.top3,
  };
}

/** SQL producing `ans` (scoped answers) and `facts` (brand × answer) CTEs. */
export function factsCte(f: InsightFilter, range: Range): SQL {
  return sql`
    ans as (
      select a.id, a.engine, a.answer_date, a.prompt_id, a.brand_mentioned, a.brand_cited, a.brand_position,
             a.mention_depth, a.sentiment
      from ai_answers a
      where a.status = 'ok' and ${scope(f, "a", range)}
    ),
    oc as (
      select c.answer_id, count(*)::int as n
      from ai_citations c join ai_sources s on s.id = c.source_id
      where ${scope(f, "c", range)} and s.ownership = 'own'
      group by 1
    ),
    cm as (
      select m.competitor_id as brand, m.answer_id, min(m.position) as position, min(m.depth_pct) as depth,
             avg(m.sentiment) as sentiment, bool_or(m.cited) as cited
      from ai_mentions m
      where ${scope(f, "m", range)} and m.competitor_id is not null
      group by 1, 2
    ),
    cc as (
      select s.competitor_id as brand, c.answer_id, count(*)::int as n
      from ai_citations c join ai_sources s on s.id = c.source_id
      where ${scope(f, "c", range)} and s.competitor_id is not null
      group by 1, 2
    ),
    facts as (
      select ${OWN_KEY}::text as brand, ans.id as answer_id, ans.engine, ans.answer_date, ans.prompt_id,
             ans.brand_mentioned as mentioned, (ans.brand_cited or oc.n is not null) as cited,
             case when ans.brand_mentioned then ans.brand_position end as position,
             case when ans.brand_mentioned then ans.mention_depth end as depth,
             case when ans.brand_mentioned then ans.sentiment end as sentiment,
             coalesce(oc.n, 0) as cites
      from ans left join oc on oc.answer_id = ans.id
      where ans.brand_mentioned or ans.brand_cited or oc.n is not null
      union all
      select coalesce(cm.brand, cc.brand), ans.id, ans.engine, ans.answer_date, ans.prompt_id,
             cm.answer_id is not null, coalesce(cm.cited, false) or cc.n is not null,
             cm.position, cm.depth, cm.sentiment, coalesce(cc.n, 0)
      from cm full join cc on cc.brand = cm.brand and cc.answer_id = cm.answer_id
      join ans on ans.id = coalesce(cm.answer_id, cc.answer_id)
    )`;
}

const AGG_SELECT = sql`
  count(*)::int as visible,
  (count(*) filter (where mentioned))::int as mentioned,
  (count(*) filter (where cited))::int as cited,
  coalesce(sum(cites), 0)::int as cites,
  coalesce(sum(position), 0)::float8 as pos_sum,
  count(position)::int as pos_n,
  coalesce(sum(depth), 0)::float8 as depth_sum,
  count(depth)::int as depth_n,
  coalesce(sum(sentiment), 0)::float8 as sent_sum,
  count(sentiment)::int as sent_n,
  (count(*) filter (where position = 1))::int as first,
  (count(*) filter (where position <= 3))::int as top3`;

type AggRow = {
  visible: number;
  mentioned: number;
  cited: number;
  cites: number;
  pos_sum: number;
  pos_n: number;
  depth_sum: number;
  depth_n: number;
  sent_sum: number;
  sent_n: number;
  first: number;
  top3: number;
};

function toAgg(r: AggRow): BrandAgg {
  return {
    visible: r.visible,
    mentioned: r.mentioned,
    cited: r.cited,
    cites: r.cites,
    posSum: r.pos_sum,
    posN: r.pos_n,
    depthSum: r.depth_sum,
    depthN: r.depth_n,
    sentSum: r.sent_sum,
    sentN: r.sent_n,
    first: r.first,
    top3: r.top3,
  };
}

export type Dim = "date" | "engine" | "prompt";

export type BrandMetricsData = {
  total: number;
  totals: Record<Dim, Map<string, number>>;
  all: Map<string, BrandAgg>;
  by: Record<Dim, Map<string, Map<string, BrandAgg>>>;
};

const DIM_COL: Record<Dim, SQL> = {
  date: sql`to_char(answer_date, 'YYYY-MM-DD')`,
  engine: sql`engine`,
  prompt: sql`prompt_id`,
};

/**
 * Loads brand aggregates for a range: overall per brand plus optional breakdowns per day,
 * engine and prompt (single scan via GROUPING SETS).
 */
export async function loadBrandMetrics(f: InsightFilter, range: Range, dims: Dim[] = []): Promise<BrandMetricsData> {
  const sets = [sql`(brand)`, ...dims.map((d) => sql`(brand, ${DIM_COL[d]})`)];
  const totalSets = [sql`()`, ...dims.map((d) => sql`(${DIM_COL[d]})`)];
  const dimSelect = (["date", "engine", "prompt"] as Dim[]).map((d) =>
    dims.includes(d) ? sql`${DIM_COL[d]} as ${sql.raw(`k_${d}`)}, grouping(${DIM_COL[d]})::int as ${sql.raw(`g_${d}`)}` : sql`null::text as ${sql.raw(`k_${d}`)}, 1 as ${sql.raw(`g_${d}`)}`,
  );

  const [factRows, totalRows] = await Promise.all([
    rows<AggRow & { brand: string; k_date: string | null; k_engine: string | null; k_prompt: string | null; g_date: number; g_engine: number; g_prompt: number }>(sql`
      with ${factsCte(f, range)}
      select brand, ${sql.join(dimSelect, sql`, `)}, ${AGG_SELECT}
      from facts
      group by grouping sets (${sql.join(sets, sql`, `)})`),
    rows<{ n: number; k_date: string | null; k_engine: string | null; k_prompt: string | null; g_date: number; g_engine: number; g_prompt: number }>(sql`
      with ans as (select a.engine, a.answer_date, a.prompt_id from ai_answers a where a.status = 'ok' and ${scope(f, "a", range)})
      select count(*)::int as n, ${sql.join(dimSelect, sql`, `)}
      from ans
      group by grouping sets (${sql.join(totalSets, sql`, `)})`),
  ]);

  const data: BrandMetricsData = {
    total: 0,
    totals: { date: new Map(), engine: new Map(), prompt: new Map() },
    all: new Map(),
    by: { date: new Map(), engine: new Map(), prompt: new Map() },
  };
  for (const r of totalRows) {
    if (r.g_date === 0 && r.k_date) data.totals.date.set(r.k_date, r.n);
    else if (r.g_engine === 0 && r.k_engine) data.totals.engine.set(r.k_engine, r.n);
    else if (r.g_prompt === 0 && r.k_prompt) data.totals.prompt.set(r.k_prompt, r.n);
    else data.total = r.n;
  }
  for (const r of factRows) {
    const agg = toAgg(r);
    const put = (dim: Dim, key: string | null) => {
      if (!key) return;
      let m = data.by[dim].get(r.brand);
      if (!m) data.by[dim].set(r.brand, (m = new Map()));
      m.set(key, agg);
    };
    if (r.g_date === 0) put("date", r.k_date);
    else if (r.g_engine === 0) put("engine", r.k_engine);
    else if (r.g_prompt === 0) put("prompt", r.k_prompt);
    else data.all.set(r.brand, agg);
  }
  return data;
}

/** Converts a brand aggregate into KPI values given the slice denominators. */
export function toMetrics(
  a: BrandAgg | undefined,
  total: number,
  sums: { mentioned: number; cites: number },
): MetricValues {
  if (!total) return emptyMetrics();
  const x = a ?? emptyAgg();
  return {
    visibility: pct(x.visible, total) ?? 0,
    mentionRate: pct(x.mentioned, total) ?? 0,
    mentions: x.mentioned,
    citationRate: pct(x.cited, total) ?? 0,
    citations: x.cites,
    sentiment: avg(x.sentSum, x.sentN),
    avgPosition: avg(x.posSum, x.posN),
    mentionDepth: avg(x.depthSum, x.depthN),
    sov: pct(x.mentioned, sums.mentioned) ?? 0,
    firstShare: pct(x.first, total) ?? 0,
    top3Share: pct(x.top3, total) ?? 0,
    citationShare: pct(x.cites, sums.cites) ?? 0,
  };
}

export function sumsOf(aggs: Iterable<BrandAgg | undefined>): { mentioned: number; cites: number } {
  let mentioned = 0;
  let cites = 0;
  for (const a of aggs) {
    if (!a) continue;
    mentioned += a.mentioned;
    cites += a.cites;
  }
  return { mentioned, cites };
}

/** Metrics for every brand key on the overall level. */
export function metricsByBrand(data: BrandMetricsData, keys: string[]): Map<string, MetricValues> {
  const sums = sumsOf(data.all.values());
  return new Map(keys.map((k) => [k, toMetrics(data.all.get(k), data.total, sums)]));
}

/** Metrics per brand for each value of a dimension (date / engine / prompt). */
export function metricsByDim(data: BrandMetricsData, dim: Dim, keys: string[]): Map<string, Map<string, MetricValues>> {
  const out = new Map<string, Map<string, MetricValues>>();
  for (const [dimKey, total] of data.totals[dim]) {
    const sums = sumsOf([...data.by[dim].values()].map((m) => m.get(dimKey)));
    const perBrand = new Map<string, MetricValues>();
    for (const k of keys) perBrand.set(k, toMetrics(data.by[dim].get(k)?.get(dimKey), total, sums));
    out.set(dimKey, perBrand);
  }
  return out;
}

/** Aggregates per-prompt aggregates into groups (e.g. tags → prompts). */
export function metricsByGroup(
  data: BrandMetricsData,
  groups: Map<string, string[]>,
  keys: string[],
): Map<string, Map<string, MetricValues>> {
  const out = new Map<string, Map<string, MetricValues>>();
  for (const [group, promptIds] of groups) {
    let total = 0;
    for (const p of promptIds) total += data.totals.prompt.get(p) ?? 0;
    if (!total) continue;
    const aggs = new Map<string, BrandAgg>();
    for (const [brand, byPrompt] of data.by.prompt) {
      let acc = emptyAgg();
      for (const p of promptIds) {
        const a = byPrompt.get(p);
        if (a) acc = addAgg(acc, a);
      }
      aggs.set(brand, acc);
    }
    const sums = sumsOf(aggs.values());
    out.set(group, new Map(keys.map((k) => [k, toMetrics(aggs.get(k), total, sums)])));
  }
  return out;
}
