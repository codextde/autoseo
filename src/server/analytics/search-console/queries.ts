import "server-only";
import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { prompts, scQueryIntents } from "@/server/db/schema";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { getIntegration } from "@/server/integrations/store";
import { formatGscSite } from "@/server/integrations/service";
import { dateRange, pctChange, type AnalyticsPeriod } from "../period";
import {
  buildStrikingDistanceRows,
  classifyIntent,
  isAiPrompt,
  matchesWordBucket,
  wordCount,
  type QueryIntent,
} from "./classify";

export type ScSource = "google" | "bing";

async function rows<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);

/* ───────────────────────────── Connections ───────────────────────────── */

export type ScConnection = {
  source: ScSource;
  connected: boolean;
  status: "not_connected" | "pending" | "connected" | "error";
  site: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  syncedThrough: string | null;
  backfilledFrom: string | null;
};

export async function getScConnections(projectId: string): Promise<Record<ScSource, ScConnection>> {
  const [g, b] = await Promise.all([getIntegration(projectId, PROVIDERS.gsc), getIntegration(projectId, PROVIDERS.bing)]);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const google: ScConnection = {
    source: "google",
    connected: !!g && g.status !== "pending" && !!str(g.config.siteUrl),
    status: !g ? "not_connected" : g.status === "pending" || !str(g.config.siteUrl) ? "pending" : g.status === "error" ? "error" : "connected",
    site: str(g?.config.siteUrl) ? formatGscSite(String(g!.config.siteUrl)) : null,
    lastSyncAt: g?.lastSyncAt?.toISOString() ?? null,
    lastError: g?.lastError ?? null,
    syncedThrough: str(g?.config.syncedThrough),
    backfilledFrom: str(g?.config.backfilledFrom),
  };
  const bing: ScConnection = {
    source: "bing",
    connected: !!b && b.status !== "disconnected",
    status: !b ? "not_connected" : b.status === "error" ? "error" : "connected",
    site: str(b?.config.resolvedSiteUrl) ?? str(b?.config.siteUrl),
    lastSyncAt: b?.lastSyncAt?.toISOString() ?? null,
    lastError: b?.lastError ?? null,
    syncedThrough: str(b?.config.syncedThrough),
    backfilledFrom: null,
  };
  return { google, bing };
}

/* ───────────────────────────── Overview (KPIs + chart) ───────────────────────────── */

export type ScTotals = { clicks: number; impressions: number; ctr: number | null; position: number | null };

export type ScOverview = {
  totals: ScTotals;
  prev: ScTotals;
  deltas: { clicks: number | null; impressions: number | null; ctr: number | null; position: number | null };
  series: { date: string; clicks: number; impressions: number }[];
  hasData: boolean;
};

function totalsFrom(r: { clicks?: unknown; imp?: unknown; posw?: unknown; posimp?: unknown } | undefined): ScTotals {
  const clicks = num(r?.clicks);
  const impressions = num(r?.imp);
  const posimp = num(r?.posimp);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    position: posimp > 0 ? num(r?.posw) / posimp : null,
  };
}

export async function getScOverview(projectId: string, source: ScSource, period: AnalyticsPeriod): Promise<ScOverview> {
  const agg = (from: string, to: string) => sql`
    select sum(clicks)::float8 as clicks, sum(impressions)::float8 as imp,
           sum(coalesce(position, 0) * impressions)::float8 as posw,
           sum(case when position is not null then impressions else 0 end)::float8 as posimp
    from analytics_sc_daily
    where project_id = ${projectId} and source = ${source} and date between ${from} and ${to}`;
  const [[cur], [prev], daily] = await Promise.all([
    rows<Record<string, unknown>>(agg(period.from, period.to)),
    rows<Record<string, unknown>>(agg(period.prevFrom, period.prevTo)),
    rows<{ date: string; clicks: number; impressions: number }>(sql`
      select date::text as date, clicks, impressions from analytics_sc_daily
      where project_id = ${projectId} and source = ${source} and date between ${period.from} and ${period.to}
      order by date`),
  ]);
  const totals = totalsFrom(cur);
  const prevTotals = totalsFrom(prev);
  const byDate = new Map(daily.map((d) => [String(d.date).slice(0, 10), d]));
  // Bing reports queries weekly and traffic daily; zero-fill every day of the range.
  const series = dateRange(period.from, period.to).map((date) => ({
    date,
    clicks: num(byDate.get(date)?.clicks),
    impressions: num(byDate.get(date)?.impressions),
  }));
  return {
    totals,
    prev: prevTotals,
    deltas: {
      clicks: pctChange(totals.clicks, prevTotals.clicks),
      impressions: pctChange(totals.impressions, prevTotals.impressions),
      ctr: totals.ctr != null && prevTotals.ctr != null ? totals.ctr - prevTotals.ctr : null,
      // inverted: positive = improvement
      position: totals.position != null && prevTotals.position != null ? prevTotals.position - totals.position : null,
    },
    series,
    hasData: daily.length > 0,
  };
}

/* ───────────────────────────── Shared lookups ───────────────────────────── */

type IntentOverride = { intent: QueryIntent; isPrompt: boolean; source: "heuristic" | "llm" | "manual" };

async function loadIntentOverrides(projectId: string): Promise<Map<string, IntentOverride>> {
  const list = await db
    .select({ query: scQueryIntents.query, intent: scQueryIntents.intent, isPrompt: scQueryIntents.isPrompt, source: scQueryIntents.source })
    .from(scQueryIntents)
    .where(eq(scQueryIntents.projectId, projectId));
  return new Map(list.map((r) => [r.query, { intent: r.intent, isPrompt: r.isPrompt, source: r.source }]));
}

/** Lower-cased texts of the project's tracked prompts (active + archived). */
export async function loadTrackedPromptTexts(projectId: string): Promise<Set<string>> {
  const list = await db.select({ text: prompts.text }).from(prompts).where(eq(prompts.projectId, projectId));
  return new Set(list.map((p) => p.text.trim().toLowerCase()));
}

function classify(query: string, overrides: Map<string, IntentOverride>) {
  const o = overrides.get(query);
  return {
    intent: o?.intent ?? classifyIntent(query),
    isPrompt: o && o.source !== "heuristic" ? o.isPrompt : isAiPrompt(query),
    intentSource: (o?.source ?? "heuristic") as IntentOverride["source"],
  };
}

/* ───────────────────────────── Queries ───────────────────────────── */

export type ScQueryFilters = {
  view: "all" | "prompts";
  words?: string | null;
  intents: string[];
  countries: string[];
  q?: string | null;
  page?: string | null;
};

export type ScQueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  prevImpressions: number;
  deltaPct: number | null;
  position: number | null;
  ctr: number | null;
  countries: { code: string; impressions: number }[];
  topCountry: string | null;
  words: number;
  isPrompt: boolean;
  intent: QueryIntent;
  intentSource: "heuristic" | "llm" | "manual";
  tracked: boolean;
};

export type ScQueriesResult = {
  rows: ScQueryRow[];
  /** Queries matching all filters except the All / AI Prompts view. */
  queryCount: number;
  promptCount: number;
  /** Countries seen in the period (for the filter). */
  countries: { code: string; impressions: number }[];
  truncated: boolean;
};

const QUERY_LIMIT = 5000;
const RETURN_LIMIT = 2000;

function countryFilter(countries: string[]) {
  const list = countries.map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  return list.length ? sql`and country in (${sql.join(list.map((c) => sql`${c}`), sql`, `)})` : sql``;
}

function pageFilter(projectId: string, source: ScSource, period: AnalyticsPeriod, page: string | null | undefined) {
  if (!page) return sql``;
  return sql`and query in (select query from analytics_sc_pages where project_id = ${projectId} and source = ${source}
    and date between ${period.from} and ${period.to} and page = ${page} and query <> '')`;
}

export async function getScQueries(
  projectId: string,
  source: ScSource,
  period: AnalyticsPeriod,
  filters: ScQueryFilters,
): Promise<ScQueriesResult> {
  const cf = countryFilter(filters.countries);
  const pf = pageFilter(projectId, source, period, filters.page);
  const [data, countryList, overrides, tracked] = await Promise.all([
    rows<{ query: string; clicks: number; imp: number; posw: number; posimp: number; countries: [string, number][] | null; prev_imp: number | null }>(sql`
      with cur as (
        select query, country, sum(clicks)::float8 as clicks, sum(impressions)::float8 as imp,
               sum(coalesce(position, 0) * impressions)::float8 as posw,
               sum(case when position is not null then impressions else 0 end)::float8 as posimp
        from analytics_sc_queries
        where project_id = ${projectId} and source = ${source} and date between ${period.from} and ${period.to} ${cf} ${pf}
        group by query, country
      ), agg as (
        select query, sum(clicks) as clicks, sum(imp) as imp, sum(posw) as posw, sum(posimp) as posimp,
               json_agg(json_build_array(country, imp) order by imp desc) filter (where country <> '') as countries
        from cur group by query
        order by sum(imp) desc, query
        limit ${QUERY_LIMIT}
      ), prev as (
        select query, sum(impressions)::float8 as imp from analytics_sc_queries
        where project_id = ${projectId} and source = ${source} and date between ${period.prevFrom} and ${period.prevTo} ${cf}
          and query in (select query from agg)
        group by query
      )
      select agg.*, prev.imp as prev_imp from agg left join prev using (query)
      order by agg.imp desc, agg.query`),
    rows<{ country: string; imp: number }>(sql`
      select country, sum(impressions)::float8 as imp from analytics_sc_queries
      where project_id = ${projectId} and source = ${source} and date between ${period.from} and ${period.to} and country <> ''
      group by country order by imp desc limit 250`),
    loadIntentOverrides(projectId),
    loadTrackedPromptTexts(projectId),
  ]);

  const q = filters.q?.trim().toLowerCase() ?? "";
  const intents = new Set(filters.intents);
  const all: ScQueryRow[] = [];
  for (const r of data) {
    const words = wordCount(r.query);
    if (!matchesWordBucket(words, filters.words)) continue;
    if (q && !r.query.toLowerCase().includes(q)) continue;
    const c = classify(r.query, overrides);
    if (intents.size && !intents.has(c.intent)) continue;
    const impressions = num(r.imp);
    const clicks = num(r.clicks);
    const countries = (r.countries ?? []).map(([code, imp]) => ({ code, impressions: num(imp) }));
    all.push({
      query: r.query,
      clicks,
      impressions,
      prevImpressions: num(r.prev_imp),
      deltaPct: pctChange(impressions, num(r.prev_imp)),
      position: num(r.posimp) > 0 ? num(r.posw) / num(r.posimp) : null,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
      countries,
      topCountry: countries[0]?.code ?? null,
      words,
      isPrompt: c.isPrompt,
      intent: c.intent,
      intentSource: c.intentSource,
      tracked: tracked.has(r.query.trim().toLowerCase()),
    });
  }
  const promptCount = all.filter((r) => r.isPrompt).length;
  const visible = filters.view === "prompts" ? all.filter((r) => r.isPrompt) : all;
  return {
    rows: visible.slice(0, RETURN_LIMIT),
    queryCount: all.length,
    promptCount,
    countries: countryList.map((c) => ({ code: c.country, impressions: num(c.imp) })),
    truncated: data.length >= QUERY_LIMIT || visible.length > RETURN_LIMIT,
  };
}

/* ───────────────────────────── Top pages ───────────────────────────── */

export type ScPageRow = {
  page: string;
  clicks: number;
  impressions: number;
  prevImpressions: number;
  deltaPct: number | null;
  position: number | null;
  queryCount: number;
  promptCount: number;
};

export async function getScPages(
  projectId: string,
  source: ScSource,
  period: AnalyticsPeriod,
  opts: { q?: string | null } = {},
): Promise<{ rows: ScPageRow[]; truncated: boolean }> {
  const search = opts.q?.trim() ? sql`and page ilike ${`%${opts.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`}` : sql``;
  const data = await rows<{ page: string; clicks: number; imp: number; posw: number; posimp: number; prev_imp: number | null }>(sql`
    with agg as (
      select page, sum(clicks)::float8 as clicks, sum(impressions)::float8 as imp,
             sum(coalesce(position, 0) * impressions)::float8 as posw,
             sum(case when position is not null then impressions else 0 end)::float8 as posimp
      from analytics_sc_pages
      where project_id = ${projectId} and source = ${source} and date between ${period.from} and ${period.to} ${search}
      group by page order by imp desc, page limit 1000
    ), prev as (
      select page, sum(impressions)::float8 as imp from analytics_sc_pages
      where project_id = ${projectId} and source = ${source} and date between ${period.prevFrom} and ${period.prevTo}
        and page in (select page from agg)
      group by page
    )
    select agg.*, prev.imp as prev_imp from agg left join prev using (page) order by agg.imp desc, agg.page`);
  if (!data.length) return { rows: [], truncated: false };
  const pairs = await rows<{ page: string; query: string }>(sql`
    select distinct page, query from analytics_sc_pages
    where project_id = ${projectId} and source = ${source} and date between ${period.from} and ${period.to} and query <> ''
      and page in (${sql.join(data.map((d) => sql`${d.page}`), sql`, `)})
    limit 200000`);
  const overrides = await loadIntentOverrides(projectId);
  const qCount = new Map<string, number>();
  const pCount = new Map<string, number>();
  const promptCache = new Map<string, boolean>();
  for (const p of pairs) {
    qCount.set(p.page, (qCount.get(p.page) ?? 0) + 1);
    let isPrompt = promptCache.get(p.query);
    if (isPrompt === undefined) {
      isPrompt = classify(p.query, overrides).isPrompt;
      promptCache.set(p.query, isPrompt);
    }
    if (isPrompt) pCount.set(p.page, (pCount.get(p.page) ?? 0) + 1);
  }
  return {
    rows: data.map((d) => ({
      page: d.page,
      clicks: num(d.clicks),
      impressions: num(d.imp),
      prevImpressions: num(d.prev_imp),
      deltaPct: pctChange(num(d.imp), num(d.prev_imp)),
      position: num(d.posimp) > 0 ? num(d.posw) / num(d.posimp) : null,
      queryCount: qCount.get(d.page) ?? 0,
      promptCount: pCount.get(d.page) ?? 0,
    })),
    truncated: data.length >= 1000,
  };
}

/* ───────────────────────────── Locations ───────────────────────────── */

export type ScLocationRow = {
  country: string;
  clicks: number;
  impressions: number;
  prevImpressions: number;
  deltaPct: number | null;
  queryCount: number;
  promptCount: number;
  share: number;
};

export async function getScLocations(
  projectId: string,
  source: ScSource,
  period: AnalyticsPeriod,
  filters: Pick<ScQueryFilters, "view" | "words" | "intents">,
): Promise<{ rows: ScLocationRow[]; totalImpressions: number }> {
  const byRange = (from: string, to: string) => sql`
    select query, country, sum(clicks)::float8 as clicks, sum(impressions)::float8 as imp from analytics_sc_queries
    where project_id = ${projectId} and source = ${source} and date between ${from} and ${to} and country <> ''
    group by query, country order by imp desc limit 60000`;
  const [cur, prev, overrides] = await Promise.all([
    rows<{ query: string; country: string; clicks: number; imp: number }>(byRange(period.from, period.to)),
    rows<{ query: string; country: string; clicks: number; imp: number }>(byRange(period.prevFrom, period.prevTo)),
    loadIntentOverrides(projectId),
  ]);
  const intents = new Set(filters.intents);
  const cache = new Map<string, boolean>();
  const keep = (query: string) => {
    let v = cache.get(query);
    if (v === undefined) {
      const c = classify(query, overrides);
      v =
        matchesWordBucket(wordCount(query), filters.words) &&
        (!intents.size || intents.has(c.intent)) &&
        (filters.view !== "prompts" || c.isPrompt);
      cache.set(query, v);
    }
    return v;
  };
  const promptCache = new Map<string, boolean>();
  const isPrompt = (query: string) => {
    let v = promptCache.get(query);
    if (v === undefined) {
      v = classify(query, overrides).isPrompt;
      promptCache.set(query, v);
    }
    return v;
  };
  const agg = new Map<string, { clicks: number; imp: number; prev: number; queries: number; prompts: number }>();
  for (const r of cur) {
    if (!keep(r.query)) continue;
    const a = agg.get(r.country) ?? { clicks: 0, imp: 0, prev: 0, queries: 0, prompts: 0 };
    a.clicks += num(r.clicks);
    a.imp += num(r.imp);
    a.queries += 1;
    if (isPrompt(r.query)) a.prompts += 1;
    agg.set(r.country, a);
  }
  for (const r of prev) {
    if (!keep(r.query)) continue;
    const a = agg.get(r.country);
    if (a) a.prev += num(r.imp);
  }
  const total = [...agg.values()].reduce((s, a) => s + a.imp, 0);
  return {
    rows: [...agg.entries()]
      .map(([country, a]) => ({
        country,
        clicks: a.clicks,
        impressions: a.imp,
        prevImpressions: a.prev,
        deltaPct: pctChange(a.imp, a.prev),
        queryCount: a.queries,
        promptCount: a.prompts,
        share: total > 0 ? (a.imp / total) * 100 : 0,
      }))
      .sort((a, b) => b.impressions - a.impressions),
    totalImpressions: total,
  };
}

/* ───────────────────────────── Striking distance ───────────────────────────── */

export type StrikingRow = {
  query: string;
  page: string;
  impressions: number;
  clicks: number;
  position: number;
  isPrompt: boolean;
  tracked: boolean;
};

export async function getStrikingDistance(projectId: string, source: ScSource, period: AnalyticsPeriod): Promise<StrikingRow[]> {
  const data = await rows<{ query: string; page: string; clicks: number; imp: number; pos: number | null }>(sql`
    select query, page, sum(clicks)::float8 as clicks, sum(impressions)::float8 as imp,
           case when sum(case when position is not null then impressions else 0 end) > 0
             then sum(coalesce(position, 0) * impressions) / sum(case when position is not null then impressions else 0 end)
           end::float8 as pos
    from analytics_sc_pages
    where project_id = ${projectId} and source = ${source} and date between ${period.from} and ${period.to} and query <> ''
    group by query, page
    having sum(case when position is not null then impressions else 0 end) > 0
       and sum(coalesce(position, 0) * impressions) / sum(case when position is not null then impressions else 0 end) <= 20
    order by imp desc limit 50000`);
  const best = buildStrikingDistanceRows(
    data.map((d) => ({ query: d.query, page: d.page, impressions: num(d.imp), clicks: num(d.clicks), position: d.pos == null ? null : num(d.pos) })),
    100,
  );
  const [overrides, tracked] = await Promise.all([loadIntentOverrides(projectId), loadTrackedPromptTexts(projectId)]);
  return best.map((r) => ({
    query: r.query,
    page: r.page,
    impressions: r.impressions,
    clicks: r.clicks,
    position: r.position!,
    isPrompt: classify(r.query, overrides).isPrompt,
    tracked: tracked.has(r.query.trim().toLowerCase()),
  }));
}

/** Top country per query in a period (used when adding queries as tracked prompts). */
export async function topCountriesForQueries(projectId: string, queries: string[]): Promise<Map<string, string>> {
  if (!queries.length) return new Map();
  const data = await rows<{ query: string; country: string }>(sql`
    select distinct on (query) query, country from (
      select query, country, sum(impressions) as imp from analytics_sc_queries
      where project_id = ${projectId} and country <> '' and query in (${sql.join(queries.map((q) => sql`${q}`), sql`, `)})
      group by query, country
    ) t order by query, imp desc`);
  return new Map(data.map((d) => [d.query, d.country]));
}

/** Whether the project has any synced Search Console data at all (per source). */
export async function hasScData(projectId: string, source: ScSource): Promise<boolean> {
  const [r] = await rows<{ ok: boolean }>(sql`
    select exists(select 1 from analytics_sc_daily where project_id = ${projectId} and source = ${source}) as ok`);
  return !!r?.ok;
}

