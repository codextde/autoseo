import "server-only";
import { sql } from "drizzle-orm";
import type { projects } from "@/server/db/schema";
import type { BrandDTO } from "@/features/ai-insights/types";
import { getBrands, OWN_KEY } from "./brands";
import { toBrandDTO } from "./competitors";
import { dayRange, delta, pct, rows, scope, type InsightFilter } from "./filters";
import { getPromptMap } from "./prompts";

type ProjectRow = typeof projects.$inferSelect;

export type SourceRow = {
  id: string;
  url: string;
  domain: string;
  title: string | null;
  contentType: string;
  ownership: string;
  citations: number;
  citationsDelta: number | null;
  prompts: number;
  promptsDelta: number | null;
  engines: string[];
};

export type SourcesOverview = {
  group: "url" | "domain";
  top: { domain: string; citations: number; ownership: string }[];
  dates: string[];
  topSeries: Record<string, number[]>;
  types: { type: string; citations: number; share: number }[];
  engines: string[];
  table: SourceRow[];
  totals: { citations: number; sources: number; domains: number; answers: number };
};

export async function getSourcesOverview(project: ProjectRow, f: InsightFilter, group: "url" | "domain"): Promise<SourcesOverview> {
  const curFrom = f.from;
  const groupCols =
    group === "domain"
      ? sql`s.domain as id, 'https://' || s.domain as url, s.domain, null::text as title,
            mode() within group (order by s.content_type) as content_type,
            case when bool_or(s.ownership = 'own') then 'own' when bool_or(s.ownership = 'competitor') then 'competitor' else 'third_party' end as ownership`
      : sql`s.id, min(s.url) as url, min(s.domain) as domain, min(s.title) as title, min(s.content_type) as content_type, min(s.ownership) as ownership`;
  const groupBy = group === "domain" ? sql`s.domain` : sql`s.id`;

  const [table, topDomains, types, totals] = await Promise.all([
    rows<{ id: string; url: string; domain: string; title: string | null; content_type: string; ownership: string; cites: number; prev_cites: number; prompts: number; prev_prompts: number; engines: string[] | null }>(sql`
      select ${groupCols},
             (count(*) filter (where c.answer_date >= ${curFrom}::date))::int as cites,
             (count(*) filter (where c.answer_date < ${curFrom}::date))::int as prev_cites,
             (count(distinct c.prompt_id) filter (where c.answer_date >= ${curFrom}::date))::int as prompts,
             (count(distinct c.prompt_id) filter (where c.answer_date < ${curFrom}::date))::int as prev_prompts,
             array_agg(distinct c.engine) filter (where c.answer_date >= ${curFrom}::date) as engines
      from ai_citations c join ai_sources s on s.id = c.source_id
      where ${scope(f, "c", "both")}
      group by ${groupBy}
      having count(*) filter (where c.answer_date >= ${curFrom}::date) > 0
      order by cites desc
      limit 1000`),
    rows<{ domain: string; n: number; ownership: string }>(sql`
      select s.domain, count(*)::int as n,
             case when bool_or(s.ownership = 'own') then 'own' when bool_or(s.ownership = 'competitor') then 'competitor' else 'third_party' end as ownership
      from ai_citations c join ai_sources s on s.id = c.source_id
      where ${scope(f, "c")}
      group by 1 order by 2 desc limit 10`),
    rows<{ type: string; n: number }>(sql`
      select s.content_type as type, count(*)::int as n
      from ai_citations c join ai_sources s on s.id = c.source_id
      where ${scope(f, "c")}
      group by 1 order by 2 desc`),
    rows<{ citations: number; sources: number; domains: number; answers: number; engines: string[] | null }>(sql`
      select count(*)::int as citations, count(distinct c.source_id)::int as sources, count(distinct s.domain)::int as domains,
             count(distinct c.answer_id)::int as answers, array_agg(distinct c.engine) as engines
      from ai_citations c join ai_sources s on s.id = c.source_id
      where ${scope(f, "c")}`),
  ]);

  const dates = dayRange(f.from, f.to);
  const topSeries: Record<string, number[]> = {};
  const seriesDomains = topDomains.slice(0, 6).map((d) => d.domain);
  if (seriesDomains.length) {
    const daily = await rows<{ domain: string; d: string; n: number }>(sql`
      select s.domain, to_char(c.answer_date, 'YYYY-MM-DD') as d, count(*)::int as n
      from ai_citations c join ai_sources s on s.id = c.source_id
      where ${scope(f, "c")} and s.domain in ${seriesDomains}
      group by 1, 2`);
    const idx = new Map(dates.map((d, i) => [d, i]));
    for (const dom of seriesDomains) topSeries[dom] = dates.map(() => 0);
    for (const r of daily) {
      const i = idx.get(r.d);
      if (i != null) topSeries[r.domain]![i] = r.n;
    }
  }

  const totalCites = types.reduce((s, t) => s + t.n, 0);
  const t = totals[0];
  return {
    group,
    top: topDomains.map((d) => ({ domain: d.domain, citations: d.n, ownership: d.ownership })),
    dates,
    topSeries,
    types: types.map((x) => ({ type: x.type, citations: x.n, share: pct(x.n, totalCites) ?? 0 })),
    engines: (t?.engines ?? []).filter(Boolean),
    table: table.map((r) => ({
      id: r.id,
      url: r.url,
      domain: r.domain,
      title: r.title,
      contentType: r.content_type,
      ownership: r.ownership,
      citations: r.cites,
      citationsDelta: r.prev_cites || r.cites ? r.cites - r.prev_cites : null,
      prompts: r.prompts,
      promptsDelta: r.prompts - r.prev_prompts,
      engines: r.engines ?? [],
    })),
    totals: { citations: t?.citations ?? 0, sources: t?.sources ?? 0, domains: t?.domains ?? 0, answers: t?.answers ?? 0 },
  };
}

/* ───────────────────────────── Detail ───────────────────────────── */

export type SourceDetail = {
  kind: "url" | "domain";
  key: string;
  url: string;
  domain: string;
  title: string | null;
  contentType: string;
  ownership: string;
  competitor: BrandDTO | null;
  firstSeen: string | null;
  lastSeen: string | null;
  kpis: {
    citations: number;
    citationsDelta: number | null;
    prompts: number;
    promptsDelta: number | null;
    answers: number;
    avgPosition: number | null;
    youShare: number | null;
  };
  dates: string[];
  daily: number[];
  engines: { engine: string; citations: number }[];
  prompts: { id: string; text: string; country: string; citations: number; engines: string[]; lastCited: string; youMentioned: number; answers: number; latestAnswerId: string }[];
  brands: { key: string; name: string; isOwn: boolean; tracked: boolean; answers: number; share: number }[];
  urls: { id: string; url: string; title: string | null; citations: number }[];
};

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export async function getSourceDetail(project: ProjectRow, f: InsightFilter, idOrDomain: string): Promise<SourceDetail | null> {
  const isUrl = idOrDomain.startsWith("src_");
  if (!isUrl && !DOMAIN_RE.test(idOrDomain)) return null;
  const meta = await rows<{ url: string; domain: string; title: string | null; content_type: string; ownership: string; competitor_id: string | null; first_seen: string | null; last_seen: string | null; n: number }>(
    isUrl
      ? sql`select url, domain, title, content_type, ownership, competitor_id, first_seen_at::text as first_seen, last_seen_at::text as last_seen, 1 as n
            from ai_sources where project_id = ${project.id} and id = ${idOrDomain}`
      : sql`select 'https://' || domain as url, domain, null::text as title, mode() within group (order by content_type) as content_type,
                   case when bool_or(ownership = 'own') then 'own' when bool_or(ownership = 'competitor') then 'competitor' else 'third_party' end as ownership,
                   max(competitor_id) as competitor_id, min(first_seen_at)::text as first_seen, max(last_seen_at)::text as last_seen, count(*)::int as n
            from ai_sources where project_id = ${project.id} and domain = ${idOrDomain.toLowerCase()} group by domain`,
  );
  const m = meta[0];
  if (!m) return null;
  const srcFilter = isUrl ? sql`c.source_id = ${idOrDomain}` : sql`c.source_id in (select id from ai_sources where project_id = ${project.id} and domain = ${m.domain})`;

  const [kpi, daily, engines, promptRows, brandRows, urls, promptMap, brands] = await Promise.all([
    rows<{ cites: number; prev_cites: number; prompts: number; prev_prompts: number; answers: number; avg_pos: number | null; you: number }>(sql`
      select (count(*) filter (where c.answer_date >= ${f.from}::date))::int as cites,
             (count(*) filter (where c.answer_date < ${f.from}::date))::int as prev_cites,
             (count(distinct c.prompt_id) filter (where c.answer_date >= ${f.from}::date))::int as prompts,
             (count(distinct c.prompt_id) filter (where c.answer_date < ${f.from}::date))::int as prev_prompts,
             (count(distinct c.answer_id) filter (where c.answer_date >= ${f.from}::date))::int as answers,
             (avg(c.position) filter (where c.answer_date >= ${f.from}::date))::float8 as avg_pos,
             (count(distinct c.answer_id) filter (where c.answer_date >= ${f.from}::date and a.brand_mentioned))::int as you
      from ai_citations c join ai_answers a on a.id = c.answer_id
      where ${scope(f, "c", "both")} and ${srcFilter}`),
    rows<{ d: string; n: number }>(sql`
      select to_char(c.answer_date, 'YYYY-MM-DD') as d, count(*)::int as n
      from ai_citations c where ${scope(f, "c")} and ${srcFilter} group by 1`),
    rows<{ engine: string; n: number }>(sql`
      select c.engine, count(*)::int as n from ai_citations c where ${scope(f, "c")} and ${srcFilter} group by 1 order by 2 desc`),
    rows<{ prompt_id: string; n: number; engines: string[]; last: string; you: number; answers: number; latest: string }>(sql`
      select c.prompt_id, count(*)::int as n, array_agg(distinct c.engine) as engines, to_char(max(c.answer_date), 'YYYY-MM-DD') as last,
             (count(distinct c.answer_id) filter (where a.brand_mentioned))::int as you, count(distinct c.answer_id)::int as answers,
             (array_agg(c.answer_id order by c.answer_date desc))[1] as latest
      from ai_citations c join ai_answers a on a.id = c.answer_id
      where ${scope(f, "c")} and ${srcFilter}
      group by 1 order by 2 desc limit 200`),
    rows<{ key: string; name: string; is_own: boolean; answers: number }>(sql`
      with cited as (select distinct c.answer_id from ai_citations c where ${scope(f, "c")} and ${srcFilter})
      select ${OWN_KEY} as key, '' as name, true as is_own, count(*)::int as answers
      from ai_answers a join cited on cited.answer_id = a.id where a.brand_mentioned
      union all
      select coalesce(m.competitor_id, 'untracked:' || lower(trim(m.brand_name))), min(m.brand_name), false, count(distinct m.answer_id)::int
      from ai_mentions m join cited on cited.answer_id = m.answer_id
      where m.project_id = ${project.id} and m.is_own = false
      group by 1`),
    isUrl
      ? Promise.resolve([] as { id: string; url: string; title: string | null; n: number }[])
      : rows<{ id: string; url: string; title: string | null; n: number }>(sql`
          select s.id, s.url, s.title, count(c.id)::int as n
          from ai_sources s left join ai_citations c on c.source_id = s.id and ${scope(f, "c")}
          where s.project_id = ${project.id} and s.domain = ${m.domain}
          group by s.id order by n desc limit 100`),
    getPromptMap(project.id),
    getBrands(project),
  ]);

  const k = kpi[0]!;
  const dates = dayRange(f.from, f.to);
  const dMap = new Map(daily.map((r) => [r.d, r.n]));
  const byKey = new Map(brands.map((b) => [b.key, b]));
  const competitor = m.competitor_id ? (brands.find((b) => b.competitorId === m.competitor_id) ?? null) : null;

  return {
    kind: isUrl ? "url" : "domain",
    key: idOrDomain,
    url: m.url,
    domain: m.domain,
    title: m.title,
    contentType: m.content_type,
    ownership: m.ownership,
    competitor: competitor ? toBrandDTO(competitor) : null,
    firstSeen: m.first_seen,
    lastSeen: m.last_seen,
    kpis: {
      citations: k.cites,
      citationsDelta: delta(k.cites, k.prev_cites),
      prompts: k.prompts,
      promptsDelta: delta(k.prompts, k.prev_prompts),
      answers: k.answers,
      avgPosition: k.avg_pos,
      youShare: pct(k.you, k.answers),
    },
    dates,
    daily: dates.map((d) => dMap.get(d) ?? 0),
    engines: engines.map((e) => ({ engine: e.engine, citations: e.n })),
    prompts: promptRows
      .filter((p) => promptMap.has(p.prompt_id))
      .map((p) => ({
        id: p.prompt_id,
        text: promptMap.get(p.prompt_id)!.text,
        country: promptMap.get(p.prompt_id)!.country,
        citations: p.n,
        engines: p.engines ?? [],
        lastCited: p.last,
        youMentioned: p.you,
        answers: p.answers,
        latestAnswerId: p.latest,
      })),
    brands: brandRows
      .filter((b) => b.answers > 0)
      .map((b) => {
        const info = byKey.get(b.key);
        return {
          key: b.key,
          name: info?.name ?? b.name,
          isOwn: b.is_own,
          tracked: !!info,
          answers: b.answers,
          share: pct(b.answers, k.answers) ?? 0,
        };
      })
      .sort((a, b) => Number(b.isOwn) - Number(a.isOwn) || b.answers - a.answers)
      .slice(0, 12),
    urls: urls.map((u) => ({ id: u.id, url: u.url, title: u.title, citations: u.n })),
  };
}
