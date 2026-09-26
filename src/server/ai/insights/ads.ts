import "server-only";
import { sql } from "drizzle-orm";
import type { projects } from "@/server/db/schema";
import { getBrands, OWN_KEY } from "./brands";
import { dayRange, delta, pct, rows, scope, type InsightFilter } from "./filters";
import { getPromptMap } from "./prompts";

type ProjectRow = typeof projects.$inferSelect;

export type AdRow = {
  id: string;
  advertiser: string;
  advertiserDomain: string | null;
  advertiserKey: string;
  isOwn: boolean;
  headline: string;
  description: string | null;
  imageUrl: string | null;
  landingUrl: string | null;
  avgPosition: number | null;
  rating: number | null;
  engines: string[];
  appearances: number;
  appearancesDelta: number | null;
  lastSeen: string;
};

export type AdsOverview = {
  ads: AdRow[];
  advertisers: {
    key: string;
    name: string;
    domain: string | null;
    isOwn: boolean;
    tracked: boolean;
    ads: number;
    appearances: number;
    appearancesDelta: number | null;
    share: number;
    shareDelta: number | null;
  }[];
  totals: { appearances: number; ads: number; answersWithAds: number; answers: number };
};

const ADV_KEY = sql.raw(`coalesce(case when ad.is_own then '${OWN_KEY}' end, ad.competitor_id, 'adv:' || lower(trim(ad.advertiser)))`);

export async function getAdsOverview(project: ProjectRow, f: InsightFilter): Promise<AdsOverview> {
  const cur = sql`ap.answer_date >= ${f.from}::date`;
  const prev = sql`ap.answer_date < ${f.from}::date`;
  const [ads, advertisers, totals, brands] = await Promise.all([
    rows<{
      id: string;
      advertiser: string;
      advertiser_domain: string | null;
      key: string;
      is_own: boolean;
      headline: string;
      description: string | null;
      image_url: string | null;
      landing_url: string | null;
      pos: number | null;
      rating: number | null;
      engines: string[] | null;
      n: number;
      prev_n: number;
      last_seen: string;
    }>(sql`
      select ad.id, ad.advertiser, ad.advertiser_domain, ${ADV_KEY} as key, ad.is_own, ad.headline, ad.description, ad.image_url, ad.landing_url,
             (avg(ap.position) filter (where ${cur}))::float8 as pos,
             (avg(ap.rating) filter (where ${cur}))::float8 as rating,
             array_agg(distinct ap.engine) filter (where ${cur}) as engines,
             (count(*) filter (where ${cur}))::int as n,
             (count(*) filter (where ${prev}))::int as prev_n,
             to_char(max(ap.answer_date), 'YYYY-MM-DD') as last_seen
      from ai_ad_appearances ap join ai_ads ad on ad.id = ap.ad_id
      where ${scope(f, "ap", "both")}
      group by ad.id
      having count(*) filter (where ${cur}) > 0
      order by n desc
      limit 1000`),
    rows<{ key: string; name: string; domain: string | null; is_own: boolean; ads: number; n: number; prev_n: number }>(sql`
      select ${ADV_KEY} as key, min(ad.advertiser) as name, min(ad.advertiser_domain) as domain, bool_or(ad.is_own) as is_own,
             (count(distinct ad.id) filter (where ${cur}))::int as ads,
             (count(*) filter (where ${cur}))::int as n,
             (count(*) filter (where ${prev}))::int as prev_n
      from ai_ad_appearances ap join ai_ads ad on ad.id = ap.ad_id
      where ${scope(f, "ap", "both")}
      group by 1`),
    rows<{ with_ads: number; answers: number }>(sql`
      select (select count(distinct ap.answer_id)::int from ai_ad_appearances ap where ${scope(f, "ap")}) as with_ads,
             (select count(*)::int from ai_answers a where a.status = 'ok' and ${scope(f, "a")}) as answers`),
    getBrands(project),
  ]);
  const byKey = new Map(brands.map((b) => [b.key, b]));
  const totalCur = advertisers.reduce((s, a) => s + a.n, 0);
  const totalPrev = advertisers.reduce((s, a) => s + a.prev_n, 0);
  return {
    ads: ads.map((a) => ({
      id: a.id,
      advertiser: byKey.get(a.key)?.name ?? a.advertiser,
      advertiserDomain: a.advertiser_domain ?? byKey.get(a.key)?.domain ?? null,
      advertiserKey: a.key,
      isOwn: a.is_own,
      headline: a.headline,
      description: a.description,
      imageUrl: a.image_url && /^https:\/\//i.test(a.image_url) ? a.image_url : null,
      landingUrl: a.landing_url && /^https?:\/\//i.test(a.landing_url) ? a.landing_url : null,
      avgPosition: a.pos,
      rating: a.rating,
      engines: a.engines ?? [],
      appearances: a.n,
      appearancesDelta: delta(a.n, a.prev_n),
      lastSeen: a.last_seen,
    })),
    advertisers: advertisers
      .filter((a) => a.n > 0)
      .map((a) => {
        const share = pct(a.n, totalCur) ?? 0;
        return {
          key: a.key,
          name: byKey.get(a.key)?.name ?? a.name,
          domain: a.domain ?? byKey.get(a.key)?.domain ?? null,
          isOwn: a.is_own,
          tracked: byKey.has(a.key),
          ads: a.ads,
          appearances: a.n,
          appearancesDelta: delta(a.n, a.prev_n),
          share,
          shareDelta: delta(share, pct(a.prev_n, totalPrev)),
        };
      })
      .sort((a, b) => b.appearances - a.appearances),
    totals: { appearances: totalCur, ads: ads.length, answersWithAds: totals[0]?.with_ads ?? 0, answers: totals[0]?.answers ?? 0 },
  };
}

export type AdDetail = {
  id: string;
  advertiser: string;
  advertiserDomain: string | null;
  isOwn: boolean;
  headline: string;
  description: string | null;
  imageUrl: string | null;
  landingUrl: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  kpis: { appearances: number; engines: number; avgPosition: number | null; rating: number | null };
  dates: string[];
  daily: number[];
  engines: { engine: string; n: number }[];
  recent: { answerId: string; date: string; engine: string; promptText: string; position: number | null }[];
};

export async function getAdDetail(project: ProjectRow, f: InsightFilter, adId: string): Promise<AdDetail | null> {
  const meta = await rows<{
    id: string;
    advertiser: string;
    advertiser_domain: string | null;
    is_own: boolean;
    headline: string;
    description: string | null;
    image_url: string | null;
    landing_url: string | null;
    first_seen: string | null;
    last_seen: string | null;
  }>(sql`
    select id, advertiser, advertiser_domain, is_own, headline, description, image_url, landing_url,
           to_char(first_seen_at, 'YYYY-MM-DD') as first_seen, to_char(last_seen_at, 'YYYY-MM-DD') as last_seen
    from ai_ads where project_id = ${project.id} and id = ${adId}`);
  const a = meta[0];
  if (!a) return null;
  const af = sql`ap.ad_id = ${adId}`;
  const [kpi, daily, engines, recent, promptMap] = await Promise.all([
    rows<{ n: number; engines: number; pos: number | null; rating: number | null }>(sql`
      select count(*)::int as n, count(distinct ap.engine)::int as engines, avg(ap.position)::float8 as pos, avg(ap.rating)::float8 as rating
      from ai_ad_appearances ap where ${scope(f, "ap")} and ${af}`),
    rows<{ d: string; n: number }>(sql`
      select to_char(ap.answer_date, 'YYYY-MM-DD') as d, count(*)::int as n from ai_ad_appearances ap where ${scope(f, "ap")} and ${af} group by 1`),
    rows<{ engine: string; n: number }>(sql`
      select ap.engine, count(*)::int as n from ai_ad_appearances ap where ${scope(f, "ap")} and ${af} group by 1 order by 2 desc`),
    rows<{ answer_id: string; d: string; engine: string; prompt_id: string; position: number | null }>(sql`
      select ap.answer_id, to_char(ap.answer_date, 'YYYY-MM-DD') as d, ap.engine, ap.prompt_id, ap.position
      from ai_ad_appearances ap where ${scope(f, "ap")} and ${af}
      order by ap.answer_date desc limit 30`),
    getPromptMap(project.id),
  ]);
  const dates = dayRange(f.from, f.to);
  const dm = new Map(daily.map((r) => [r.d, r.n]));
  const k = kpi[0]!;
  return {
    id: a.id,
    advertiser: a.advertiser,
    advertiserDomain: a.advertiser_domain,
    isOwn: a.is_own,
    headline: a.headline,
    description: a.description,
    imageUrl: a.image_url && /^https:\/\//i.test(a.image_url) ? a.image_url : null,
    landingUrl: a.landing_url && /^https?:\/\//i.test(a.landing_url) ? a.landing_url : null,
    firstSeen: a.first_seen,
    lastSeen: recent[0]?.d ?? a.last_seen,
    kpis: { appearances: k.n, engines: k.engines, avgPosition: k.pos, rating: k.rating },
    dates,
    daily: dates.map((d) => dm.get(d) ?? 0),
    engines: engines.map((e) => ({ engine: e.engine, n: e.n })),
    recent: recent.map((r) => ({ answerId: r.answer_id, date: r.d, engine: r.engine, promptText: promptMap.get(r.prompt_id)?.text ?? "", position: r.position })),
  };
}
