import "server-only";
import { sql } from "drizzle-orm";
import type { projects } from "@/server/db/schema";
import type { BrandDTO } from "@/features/ai-insights/types";
import { brandMap, getBrands, OWN_KEY, type BrandInfo } from "./brands";
import { loadBrandMetrics, metricsByBrand } from "./brand-metrics";
import { toBrandDTO } from "./competitors";
import { addDays, dayRange, delta, isoDay, pct, rows, scope, type InsightFilter } from "./filters";
import { getPromptMap } from "./prompts";

type ProjectRow = typeof projects.$inferSelect;

/** SQL expression mapping a statement/mention row to a brand key ("own" | competitor id). */
const BRAND_KEY = (alias: string) => sql.raw(`case when ${alias}.is_own then '${OWN_KEY}' else ${alias}.competitor_id end`);

type StatementAgg = { brand: string; polarity: "praise" | "neutral" | "criticism"; theme: string | null; attribute: string | null; n: number; sev: number; quote: string; answer_id: string };

async function statementAggs(f: InsightFilter, range: "cur" | "prev" = "cur"): Promise<StatementAgg[]> {
  return rows<StatementAgg>(sql`
    select ${BRAND_KEY("st")} as brand, st.polarity, st.theme, st.attribute, count(*)::int as n, avg(st.severity)::float8 as sev,
           (array_agg(st.quote order by st.severity desc, st.answer_date desc))[1] as quote,
           (array_agg(st.answer_id order by st.severity desc, st.answer_date desc))[1] as answer_id
    from ai_statements st
    where ${scope(f, "st", range)} and (st.is_own or st.competitor_id is not null)
    group by 1, 2, 3, 4`);
}

export type SentimentContext = {
  brands: BrandDTO[];
  own: BrandDTO;
  compare: BrandDTO | null;
};

/** Brand list + resolved compare brand (`?compare=` or the most discussed competitor). */
export async function getSentimentContext(project: ProjectRow, f: InsightFilter, compareParam: string | undefined): Promise<SentimentContext & { infos: BrandInfo[] }> {
  const infos = await getBrands(project);
  const own = infos.find((b) => b.isOwn)!;
  let compare = compareParam && compareParam !== "none" ? infos.find((b) => b.competitorId === compareParam) : undefined;
  if (!compare && compareParam !== "none") {
    const top = await rows<{ competitor_id: string }>(sql`
      select m.competitor_id from ai_mentions m
      where ${scope(f, "m")} and m.competitor_id is not null
      group by 1 order by count(*) desc limit 1`);
    compare = infos.find((b) => b.competitorId === top[0]?.competitor_id) ?? infos.find((b) => !b.isOwn && b.tracked);
  }
  return { infos, brands: infos.map(toBrandDTO), own: toBrandDTO(own), compare: compare ? toBrandDTO(compare) : null };
}

/* ───────────────────────────── Overview ───────────────────────────── */

export type SentimentOverview = {
  kpis: {
    you: { score: number | null; scoreDelta: number | null; praise: number; neutral: number; criticism: number; statements: number };
    compare: { score: number | null; praise: number; neutral: number; criticism: number; statements: number } | null;
  };
  daily: { date: string; you: { praise: number; neutral: number; criticism: number }; them: { praise: number; neutral: number; criticism: number } }[];
  praises: { attribute: string; theme: string | null; count: number; quote: string; answerId: string }[];
  criticisms: { attribute: string; theme: string | null; count: number; quote: string; answerId: string }[];
  table: {
    key: string;
    score: number | null;
    scoreDelta: number | null;
    winRate: number | null;
    claims: number;
    praise: number;
    neutral: number;
    criticism: number;
    praises: string[];
    topCriticism: { attribute: string; count: number } | null;
    leadsOn: string[];
  }[];
};

function mix(list: StatementAgg[]) {
  const c = { praise: 0, neutral: 0, criticism: 0 };
  for (const s of list) c[s.polarity] += s.n;
  const total = c.praise + c.neutral + c.criticism;
  return { ...c, total };
}

export async function getSentimentOverview(project: ProjectRow, f: InsightFilter, ctx: SentimentContext & { infos: BrandInfo[] }): Promise<SentimentOverview> {
  const keys = ctx.infos.map((b) => b.key);
  const compareKey = ctx.compare?.key ?? null;
  const [aggs, cur, prev, daily, wins] = await Promise.all([
    statementAggs(f),
    loadBrandMetrics(f, "cur"),
    loadBrandMetrics(f, "prev"),
    rows<{ d: string; brand: string; polarity: "praise" | "neutral" | "criticism"; n: number }>(sql`
      select to_char(st.answer_date, 'YYYY-MM-DD') as d, ${BRAND_KEY("st")} as brand, st.polarity, count(*)::int as n
      from ai_statements st
      where ${scope(f, "st")} and (st.is_own${compareKey && compareKey !== OWN_KEY ? sql` or st.competitor_id = ${compareKey}` : sql``})
      group by 1, 2, 3`),
    winRates(f),
  ]);
  const curM = metricsByBrand(cur, keys);
  const prevM = metricsByBrand(prev, keys);

  const byBrand = new Map<string, StatementAgg[]>();
  for (const a of aggs) {
    if (!byBrand.has(a.brand)) byBrand.set(a.brand, []);
    byBrand.get(a.brand)!.push(a);
  }

  // #1 brand per attribute by praise count (min 2 statements).
  const leaders = new Map<string, { brand: string; n: number }>();
  for (const a of aggs) {
    if (a.polarity !== "praise" || !a.attribute || a.n < 2) continue;
    const cur = leaders.get(a.attribute);
    if (!cur || a.n > cur.n) leaders.set(a.attribute, { brand: a.brand, n: a.n });
  }

  const ownMix = mix(byBrand.get(OWN_KEY) ?? []);
  const cmpMix = compareKey ? mix(byBrand.get(compareKey) ?? []) : null;
  const top = (brand: string, polarity: "praise" | "criticism", n: number) => {
    const m = new Map<string, { attribute: string; theme: string | null; count: number; quote: string; answerId: string }>();
    for (const s of byBrand.get(brand) ?? []) {
      if (s.polarity !== polarity || !s.attribute) continue;
      const e = m.get(s.attribute);
      if (e) e.count += s.n;
      else m.set(s.attribute, { attribute: s.attribute, theme: s.theme, count: s.n, quote: s.quote, answerId: s.answer_id });
    }
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);
  };

  const days = dayRange(f.from, f.to);
  const dailyMap = new Map<string, SentimentOverview["daily"][number]>(
    days.map((d) => [d, { date: d, you: { praise: 0, neutral: 0, criticism: 0 }, them: { praise: 0, neutral: 0, criticism: 0 } }]),
  );
  for (const r of daily) {
    const e = dailyMap.get(r.d);
    if (!e) continue;
    if (r.brand === OWN_KEY) e.you[r.polarity] += r.n;
    else if (r.brand === compareKey) e.them[r.polarity] += r.n;
  }

  const table: SentimentOverview["table"] = ctx.infos
    .map((b) => {
      const m = mix(byBrand.get(b.key) ?? []);
      const crit = top(b.key, "criticism", 1)[0];
      const w = wins.get(b.key);
      return {
        key: b.key,
        score: curM.get(b.key)?.sentiment ?? null,
        scoreDelta: delta(curM.get(b.key)?.sentiment, prevM.get(b.key)?.sentiment),
        winRate: w && w.decided ? (w.wins / w.decided) * 100 : null,
        claims: w?.decided ?? 0,
        praise: m.praise,
        neutral: m.neutral,
        criticism: m.criticism,
        praises: top(b.key, "praise", 3).map((p) => p.attribute),
        topCriticism: crit ? { attribute: crit.attribute, count: crit.count } : null,
        leadsOn: [...leaders.entries()].filter(([, l]) => l.brand === b.key).map(([attr]) => attr),
      };
    })
    .filter((r) => r.score != null || r.praise + r.neutral + r.criticism > 0)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return {
    kpis: {
      you: {
        score: curM.get(OWN_KEY)?.sentiment ?? null,
        scoreDelta: delta(curM.get(OWN_KEY)?.sentiment, prevM.get(OWN_KEY)?.sentiment),
        praise: pct(ownMix.praise, ownMix.total) ?? 0,
        neutral: pct(ownMix.neutral, ownMix.total) ?? 0,
        criticism: pct(ownMix.criticism, ownMix.total) ?? 0,
        statements: ownMix.total,
      },
      compare:
        compareKey && cmpMix
          ? {
              score: curM.get(compareKey)?.sentiment ?? null,
              praise: pct(cmpMix.praise, cmpMix.total) ?? 0,
              neutral: pct(cmpMix.neutral, cmpMix.total) ?? 0,
              criticism: pct(cmpMix.criticism, cmpMix.total) ?? 0,
              statements: cmpMix.total,
            }
          : null,
    },
    daily: [...dailyMap.values()],
    praises: top(OWN_KEY, "praise", 5),
    criticisms: top(OWN_KEY, "criticism", 5),
    table,
  };
}

/** Share of decided head-to-head claims each brand won. */
async function winRates(f: InsightFilter): Promise<Map<string, { wins: number; decided: number }>> {
  const res = await rows<{ brand: string; wins: number; decided: number }>(sql`
    with h as (
      select r.* from ai_recommendations r where ${scope(f, "r")} and r.kind = 'head_to_head'
    ), sides as (
      select case when is_own then ${OWN_KEY} else competitor_id end as brand, winner = 'brand' as won, winner in ('brand', 'opponent') as decided
      from h where is_own or competitor_id is not null
      union all
      select case when opponent_is_own then ${OWN_KEY} else opponent_competitor_id end, winner = 'opponent', winner in ('brand', 'opponent')
      from h where coalesce(opponent_is_own, false) or opponent_competitor_id is not null
    )
    select brand, (count(*) filter (where won))::int as wins, (count(*) filter (where decided))::int as decided
    from sides group by 1`);
  return new Map(res.map((r) => [r.brand, { wins: r.wins, decided: r.decided }]));
}

/* ───────────────────────────── Perception ───────────────────────────── */

export type Perception = {
  themes: string[];
  /** brand → theme → value */
  prominence: Record<string, Record<string, number>>;
  association: Record<string, Record<string, number>>;
  avgProminence: { key: string; value: number }[];
  attributes: {
    attribute: string;
    theme: string;
    mentions: number;
    isNew: boolean;
    /** brand → praise share % */
    shares: Record<string, number>;
    counts: Record<string, number>;
    leader: string | null;
    ownRank: number | null;
    brandsRanked: number;
  }[];
  kpis: {
    mostAssociated: { attribute: string; share: number } | null;
    best: { attribute: string; rank: number; of: number } | null;
    biggestGap: { attribute: string; rank: number; leader: string } | null;
    strongest: { key: string; value: number } | null;
  };
};

export async function getPerception(project: ProjectRow, f: InsightFilter, ctx: SentimentContext & { infos: BrandInfo[] }): Promise<Perception> {
  const [aggs, firstSeen] = await Promise.all([
    statementAggs(f),
    rows<{ attribute: string; first: string }>(sql`
      select st.attribute, to_char(min(st.answer_date), 'YYYY-MM-DD') as first
      from ai_statements st where st.project_id = ${project.id} and st.is_own and st.attribute is not null
      group by 1`),
  ]);
  const known = brandMap(ctx.infos);
  const valid = aggs.filter((a) => known.has(a.brand));
  const themes = [...new Set(valid.map((a) => a.theme ?? "Other"))].sort();
  const brandKeys = [...new Set(valid.map((a) => a.brand))];

  const nBrandTheme = new Map<string, number>();
  const nBrand = new Map<string, number>();
  const nTheme = new Map<string, number>();
  for (const a of valid) {
    const t = a.theme ?? "Other";
    nBrandTheme.set(`${a.brand}|${t}`, (nBrandTheme.get(`${a.brand}|${t}`) ?? 0) + a.n);
    nBrand.set(a.brand, (nBrand.get(a.brand) ?? 0) + a.n);
    nTheme.set(t, (nTheme.get(t) ?? 0) + a.n);
  }
  const prominence: Perception["prominence"] = {};
  const association: Perception["association"] = {};
  for (const b of brandKeys) {
    prominence[b] = {};
    association[b] = {};
    for (const t of themes) {
      const n = nBrandTheme.get(`${b}|${t}`) ?? 0;
      prominence[b]![t] = pct(n, nTheme.get(t) ?? 0) ?? 0;
      association[b]![t] = pct(n, nBrand.get(b) ?? 0) ?? 0;
    }
  }
  const avgProminence = brandKeys
    .map((k) => ({ key: k, value: themes.reduce((s, t) => s + (prominence[k]?.[t] ?? 0), 0) / (themes.length || 1) }))
    .sort((a, b) => b.value - a.value);

  // Attribute leadership by praise share.
  const attrs = new Map<string, { theme: string; praise: Map<string, number>; mentions: Map<string, number> }>();
  for (const a of valid) {
    if (!a.attribute) continue;
    let e = attrs.get(a.attribute);
    if (!e) attrs.set(a.attribute, (e = { theme: a.theme ?? "Other", praise: new Map(), mentions: new Map() }));
    e.mentions.set(a.brand, (e.mentions.get(a.brand) ?? 0) + a.n);
    if (a.polarity === "praise") e.praise.set(a.brand, (e.praise.get(a.brand) ?? 0) + a.n);
  }
  const newCutoff = addDays(isoDay(new Date()), -13);
  const firstMap = new Map(firstSeen.map((r) => [r.attribute, r.first]));
  const attributes: Perception["attributes"] = [...attrs.entries()]
    .map(([attribute, e]) => {
      const totalPraise = [...e.praise.values()].reduce((s, n) => s + n, 0);
      const shares: Record<string, number> = {};
      const counts: Record<string, number> = {};
      for (const [b, n] of e.mentions) counts[b] = n;
      for (const [b, n] of e.praise) shares[b] = pct(n, totalPraise) ?? 0;
      const ranked = Object.entries(shares).sort((a, b) => b[1] - a[1]);
      const ownIdx = ranked.findIndex(([b]) => b === OWN_KEY);
      return {
        attribute,
        theme: e.theme,
        mentions: [...e.mentions.values()].reduce((s, n) => s + n, 0),
        isNew: (firstMap.get(attribute) ?? "0000") >= newCutoff,
        shares,
        counts,
        leader: ranked[0]?.[0] ?? null,
        ownRank: ownIdx >= 0 ? ownIdx + 1 : null,
        brandsRanked: ranked.length,
      };
    })
    .sort((a, b) => a.theme.localeCompare(b.theme) || b.mentions - a.mentions);

  // KPI strip
  const ownAttr = valid.filter((a) => a.brand === OWN_KEY && a.attribute);
  const ownTotal = ownAttr.reduce((s, a) => s + a.n, 0);
  const byOwnAttr = new Map<string, number>();
  for (const a of ownAttr) byOwnAttr.set(a.attribute!, (byOwnAttr.get(a.attribute!) ?? 0) + a.n);
  const mostAssoc = [...byOwnAttr.entries()].sort((a, b) => b[1] - a[1])[0];
  const rankedAttrs = attributes.filter((a) => a.ownRank != null);
  const best = [...rankedAttrs].sort((a, b) => a.ownRank! - b.ownRank! || b.mentions - a.mentions)[0];
  const gap = [...rankedAttrs].filter((a) => a.ownRank! > 1).sort((a, b) => b.ownRank! - a.ownRank! || b.mentions - a.mentions)[0];
  const strongest = avgProminence.find((a) => a.key !== OWN_KEY) ?? null;

  return {
    themes,
    prominence,
    association,
    avgProminence,
    attributes,
    kpis: {
      mostAssociated: mostAssoc ? { attribute: mostAssoc[0], share: pct(mostAssoc[1], ownTotal) ?? 0 } : null,
      best: best ? { attribute: best.attribute, rank: best.ownRank!, of: best.brandsRanked } : null,
      biggestGap: gap ? { attribute: gap.attribute, rank: gap.ownRank!, leader: gap.leader ?? "" } : null,
      strongest,
    },
  };
}

/* ───────────────────────────── Praise / Criticism ───────────────────────────── */

export type StatementRow = {
  id: string;
  brand: string;
  brandName: string;
  quote: string;
  theme: string | null;
  attribute: string | null;
  engines: string[];
  count: number;
  severity: number;
  answerId: string;
  promptText: string;
  date: string;
};

export async function getStatements(project: ProjectRow, f: InsightFilter, polarity: "praise" | "criticism"): Promise<StatementRow[]> {
  const [res, promptMap] = await Promise.all([
    rows<{ id: string; brand: string | null; brand_name: string; quote: string; theme: string | null; attribute: string | null; engines: string[]; n: number; severity: number; answer_id: string; prompt_id: string; d: string }>(sql`
      select min(st.id) as id, ${BRAND_KEY("st")} as brand, min(st.brand_name) as brand_name, min(st.quote) as quote,
             st.theme, st.attribute, array_agg(distinct st.engine) as engines, count(*)::int as n,
             max(st.severity)::float8 as severity,
             (array_agg(st.answer_id order by st.answer_date desc))[1] as answer_id,
             (array_agg(st.prompt_id order by st.answer_date desc))[1] as prompt_id,
             to_char(max(st.answer_date), 'YYYY-MM-DD') as d
      from ai_statements st
      where ${scope(f, "st")} and st.polarity = ${polarity}
      group by ${BRAND_KEY("st")}, lower(st.brand_name), lower(trim(st.quote)), st.theme, st.attribute
      order by max(st.severity) desc, count(*) desc
      limit 1500`),
    getPromptMap(project.id),
  ]);
  return res.map((r) => ({
    id: r.id,
    brand: r.brand ?? `untracked:${r.brand_name.toLowerCase()}`,
    brandName: r.brand_name,
    quote: r.quote,
    theme: r.theme,
    attribute: r.attribute,
    engines: r.engines ?? [],
    count: r.n,
    severity: r.severity,
    answerId: r.answer_id,
    promptText: promptMap.get(r.prompt_id)?.text ?? "",
    date: r.d,
  }));
}

/* ───────────────────────────── Recommendations ───────────────────────────── */

export type Recommendations = {
  headToHead: {
    key: string;
    youWins: number;
    themWins: number;
    ties: number;
    claims: { id: string; label: string; winner: "you" | "them" | "tie" | null; engine: string; answerId: string }[];
  }[];
  takers: { key: string; name: string; answers: number; prompts: number; answerIds: string[] }[];
  takersTotal: number;
  bestFor: {
    labels: string[];
    brands: { key: string; name: string; isOwn: boolean }[];
    /** brand → label → { n, answers } */
    cells: Record<string, Record<string, { n: number; answers: { answerId: string; promptText: string; engine: string; date: string }[] }>>;
  };
};

export async function getRecommendations(project: ProjectRow, f: InsightFilter, ctx: SentimentContext & { infos: BrandInfo[] }): Promise<Recommendations> {
  const [h2h, takers, bestFor, promptMap] = await Promise.all([
    rows<{ id: string; label: string; winner: string | null; is_own: boolean; other: string | null; engine: string; answer_id: string }>(sql`
      select r.id, r.label, r.winner, r.is_own, case when r.is_own then r.opponent_competitor_id else r.competitor_id end as other,
             r.engine, r.answer_id
      from ai_recommendations r
      where ${scope(f, "r")} and r.kind = 'head_to_head'
        and ((r.is_own and r.opponent_competitor_id is not null) or (coalesce(r.opponent_is_own, false) and r.competitor_id is not null))
      order by r.answer_date desc
      limit 3000`),
    rows<{ key: string; name: string; answers: number; prompts: number; answer_ids: string[] }>(sql`
      with own as (
        select a.id from ai_answers a
        where a.status = 'ok' and ${scope(f, "a")} and a.brand_mentioned
          and not exists (select 1 from ai_mentions m2 where m2.answer_id = a.id and m2.is_own and m2.recommended)
      )
      select coalesce(m.competitor_id, 'untracked:' || lower(trim(m.brand_name))) as key, min(m.brand_name) as name,
             count(distinct m.answer_id)::int as answers, count(distinct m.prompt_id)::int as prompts,
             (array_agg(distinct m.answer_id))[1:12] as answer_ids
      from ai_mentions m join own on own.id = m.answer_id
      where ${scope(f, "m")} and m.is_own = false and m.recommended
      group by 1 order by 3 desc limit 12`),
    rows<{ key: string; name: string; is_own: boolean; label: string; n: number; answers: { a: string; p: string; e: string; d: string }[] }>(sql`
      select coalesce(case when r.is_own then ${OWN_KEY} end, r.competitor_id, 'untracked:' || lower(trim(r.brand_name))) as key,
             min(r.brand_name) as name, bool_or(r.is_own) as is_own, r.label, count(*)::int as n,
             (array_agg(json_build_object('a', r.answer_id, 'p', r.prompt_id, 'e', r.engine, 'd', to_char(r.answer_date, 'YYYY-MM-DD')) order by r.answer_date desc))[1:15] as answers
      from ai_recommendations r
      where ${scope(f, "r")} and r.kind = 'best_for'
      group by 1, r.label`),
    getPromptMap(project.id),
  ]);

  const h = new Map<string, Recommendations["headToHead"][number]>();
  for (const c of h2h) {
    if (!c.other) continue;
    let e = h.get(c.other);
    if (!e) h.set(c.other, (e = { key: c.other, youWins: 0, themWins: 0, ties: 0, claims: [] }));
    let winner: "you" | "them" | "tie" | null = null;
    if (c.winner === "tie") winner = "tie";
    else if (c.winner === "brand") winner = c.is_own ? "you" : "them";
    else if (c.winner === "opponent") winner = c.is_own ? "them" : "you";
    if (winner === "you") e.youWins++;
    else if (winner === "them") e.themWins++;
    else e.ties++;
    if (e.claims.length < 25) e.claims.push({ id: c.id, label: c.label, winner, engine: c.engine, answerId: c.answer_id });
  }

  const labelTotals = new Map<string, number>();
  const brandTotals = new Map<string, { key: string; name: string; isOwn: boolean; n: number }>();
  const cells: Recommendations["bestFor"]["cells"] = {};
  const known = brandMap(ctx.infos);
  for (const r of bestFor) {
    labelTotals.set(r.label, (labelTotals.get(r.label) ?? 0) + r.n);
    const name = known.get(r.key)?.name ?? r.name;
    const bt = brandTotals.get(r.key) ?? { key: r.key, name, isOwn: r.is_own, n: 0 };
    bt.n += r.n;
    brandTotals.set(r.key, bt);
    (cells[r.key] ??= {})[r.label] = {
      n: r.n,
      answers: (r.answers ?? []).map((a) => ({ answerId: a.a, promptText: promptMap.get(a.p)?.text ?? "", engine: a.e, date: a.d })),
    };
  }
  const brandsSorted = [...brandTotals.values()].sort((a, b) => Number(b.isOwn) - Number(a.isOwn) || b.n - a.n).slice(0, 12);

  return {
    headToHead: [...h.values()].sort((a, b) => b.youWins + b.themWins + b.ties - (a.youWins + a.themWins + a.ties)),
    takers: takers.map((t) => ({ key: t.key, name: known.get(t.key)?.name ?? t.name, answers: t.answers, prompts: t.prompts, answerIds: t.answer_ids ?? [] })),
    takersTotal: takers.reduce((s, t) => s + t.answers, 0),
    bestFor: {
      labels: [...labelTotals.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l).slice(0, 10),
      brands: brandsSorted.map(({ key, name, isOwn }) => ({ key, name, isOwn })),
      cells,
    },
  };
}
