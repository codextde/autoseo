import "server-only";
import { sql } from "drizzle-orm";
import type { projects } from "@/server/db/schema";
import { getBrands, OWN_KEY } from "./brands";
import { loadBrandMetrics, metricsByBrand } from "./brand-metrics";
import { dayRange, delta, pct, rows, scope, type InsightFilter } from "./filters";
import { getPromptMap } from "./prompts";

type ProjectRow = typeof projects.$inferSelect;

export type ProductRow = {
  id: string;
  name: string;
  brandName: string | null;
  brandKey: string | null;
  isOwn: boolean;
  category: string | null;
  imageUrl: string | null;
  sources: ("llm" | "shopping")[];
  price: number | null;
  oldPrice: number | null;
  currency: string | null;
  rating: number | null;
  reviews: number | null;
  engines: string[];
  stores: string[];
  appearances: number;
  appearancesDelta: number | null;
  lastSeen: string;
};

export type ProductsOverview = {
  products: ProductRow[];
  brands: {
    key: string;
    name: string;
    domain: string | null;
    isOwn: boolean;
    tracked: boolean;
    products: number;
    productsDelta: number | null;
    mentions: number;
    mentionsDelta: number | null;
    sentiment: number | null;
    sentimentDelta: number | null;
    share: number;
    shareDelta: number | null;
  }[];
  stores: { store: string; domain: string | null; appearances: number; appearancesDelta: number | null; share: number; products: number; avgPrice: number | null; currency: string | null }[];
  totals: { appearances: number; products: number; stores: number };
};

const BRAND_EXPR = sql.raw(`coalesce(case when p.is_own then '${OWN_KEY}' end, p.competitor_id, 'untracked:' || lower(trim(coalesce(p.brand_name, 'unknown'))))`);

export async function getProductsOverview(project: ProjectRow, f: InsightFilter): Promise<ProductsOverview> {
  const cur = sql`pa.answer_date >= ${f.from}::date`;
  const prev = sql`pa.answer_date < ${f.from}::date`;
  const [products, brandRows, stores, infos, curM, prevM] = await Promise.all([
    rows<{
      id: string;
      name: string;
      brand_name: string | null;
      brand_key: string | null;
      is_own: boolean;
      category: string | null;
      image_url: string | null;
      sources: string[] | null;
      price: number | null;
      old_price: number | null;
      currency: string | null;
      rating: number | null;
      reviews: number | null;
      engines: string[] | null;
      stores: string[] | null;
      n: number;
      prev_n: number;
      last_seen: string;
    }>(sql`
      select p.id, p.name, p.brand_name, ${BRAND_EXPR} as brand_key, p.is_own, p.category, p.image_url,
             array_agg(distinct pa.source) filter (where ${cur}) as sources,
             ((array_agg(pa.price order by pa.answer_date desc) filter (where ${cur} and pa.price is not null))[1])::float8 as price,
             ((array_agg(pa.old_price order by pa.answer_date desc) filter (where ${cur} and pa.price is not null))[1])::float8 as old_price,
             (array_agg(pa.currency order by pa.answer_date desc) filter (where ${cur} and pa.currency is not null))[1] as currency,
             (avg(pa.rating) filter (where ${cur}))::float8 as rating,
             (max(pa.reviews) filter (where ${cur}))::int as reviews,
             array_agg(distinct pa.engine) filter (where ${cur}) as engines,
             array_agg(distinct pa.store) filter (where ${cur} and pa.store is not null) as stores,
             (count(*) filter (where ${cur}))::int as n,
             (count(*) filter (where ${prev}))::int as prev_n,
             to_char(max(pa.answer_date), 'YYYY-MM-DD') as last_seen
      from ai_product_appearances pa join ai_products p on p.id = pa.product_id
      where ${scope(f, "pa", "both")}
      group by p.id
      having count(*) filter (where ${cur}) > 0
      order by n desc
      limit 2000`),
    rows<{ key: string; name: string; products: number; prev_products: number; n: number; prev_n: number }>(sql`
      select ${BRAND_EXPR} as key, min(coalesce(p.brand_name, 'Unknown')) as name,
             (count(distinct p.id) filter (where ${cur}))::int as products,
             (count(distinct p.id) filter (where ${prev}))::int as prev_products,
             (count(*) filter (where ${cur}))::int as n,
             (count(*) filter (where ${prev}))::int as prev_n
      from ai_product_appearances pa join ai_products p on p.id = pa.product_id
      where ${scope(f, "pa", "both")}
      group by 1`),
    rows<{ store: string; domain: string | null; n: number; prev_n: number; products: number; avg_price: number | null; currency: string | null }>(sql`
      select pa.store, min(pa.store_domain) as domain,
             (count(*) filter (where ${cur}))::int as n,
             (count(*) filter (where ${prev}))::int as prev_n,
             (count(distinct pa.product_id) filter (where ${cur}))::int as products,
             (avg(pa.price) filter (where ${cur}))::float8 as avg_price,
             min(pa.currency) as currency
      from ai_product_appearances pa
      where ${scope(f, "pa", "both")} and pa.store is not null
      group by 1
      having count(*) filter (where ${cur}) > 0
      order by n desc
      limit 100`),
    getBrands(project),
    loadBrandMetrics(f, "cur"),
    loadBrandMetrics(f, "prev"),
  ]);

  const keys = infos.map((b) => b.key);
  const cm = metricsByBrand(curM, keys);
  const pm = metricsByBrand(prevM, keys);
  const byKey = new Map(infos.map((b) => [b.key, b]));
  const totalCur = brandRows.reduce((s, b) => s + b.n, 0);
  const totalPrev = brandRows.reduce((s, b) => s + b.prev_n, 0);
  const storeCur = stores.reduce((s, b) => s + b.n, 0);

  return {
    products: products.map((p) => {
      const sources = new Set<"llm" | "shopping">();
      for (const s of p.sources ?? []) {
        if (s === "llm" || s === "both") sources.add("llm");
        if (s === "shopping" || s === "both") sources.add("shopping");
      }
      return {
        id: p.id,
        name: p.name,
        brandName: byKey.get(p.brand_key ?? "")?.name ?? p.brand_name,
        brandKey: p.brand_key,
        isOwn: p.is_own,
        category: p.category,
        imageUrl: p.image_url && /^https:\/\//i.test(p.image_url) ? p.image_url : null,
        sources: [...sources],
        price: p.price,
        oldPrice: p.old_price,
        currency: p.currency,
        rating: p.rating,
        reviews: p.reviews,
        engines: p.engines ?? [],
        stores: p.stores ?? [],
        appearances: p.n,
        appearancesDelta: delta(p.n, p.prev_n),
        lastSeen: p.last_seen,
      };
    }),
    brands: brandRows
      .filter((b) => b.n > 0)
      .map((b) => {
        const info = byKey.get(b.key);
        const share = pct(b.n, totalCur) ?? 0;
        const prevShare = pct(b.prev_n, totalPrev);
        return {
          key: b.key,
          name: info?.name ?? b.name,
          domain: info?.domain ?? null,
          isOwn: b.key === OWN_KEY,
          tracked: !!info,
          products: b.products,
          productsDelta: delta(b.products, b.prev_products),
          mentions: b.n,
          mentionsDelta: delta(b.n, b.prev_n),
          sentiment: info ? (cm.get(b.key)?.sentiment ?? null) : null,
          sentimentDelta: info ? delta(cm.get(b.key)?.sentiment, pm.get(b.key)?.sentiment) : null,
          share,
          shareDelta: delta(share, prevShare),
        };
      })
      .sort((a, b) => b.mentions - a.mentions),
    stores: stores.map((s) => ({
      store: s.store,
      domain: s.domain,
      appearances: s.n,
      appearancesDelta: delta(s.n, s.prev_n),
      share: pct(s.n, storeCur) ?? 0,
      products: s.products,
      avgPrice: s.avg_price,
      currency: s.currency,
    })),
    totals: { appearances: totalCur, products: products.length, stores: stores.length },
  };
}

/* ───────────────────────────── Detail ───────────────────────────── */

export type ProductDetail = {
  id: string;
  name: string;
  brandName: string | null;
  brandDomain: string | null;
  isOwn: boolean;
  category: string | null;
  imageUrl: string | null;
  attributes: Record<string, string>;
  firstSeen: string | null;
  lastSeen: string | null;
  kpis: { appearances: number; appearancesDelta: number | null; engines: number; avgPosition: number | null; rating: number | null; reviews: number | null };
  dates: string[];
  daily: number[];
  engines: { engine: string; n: number }[];
  sources: { source: string; n: number }[];
  stores: { store: string; domain: string | null; price: number | null; oldPrice: number | null; currency: string | null; min: number | null; max: number | null; n: number; url: string | null }[];
  recent: { answerId: string; date: string; engine: string; promptText: string; store: string | null; price: number | null; currency: string | null; position: number | null; source: string }[];
  prompts: { id: string; text: string; country: string; n: number; engines: string[]; avgPosition: number | null; lastSeen: string; latestAnswerId: string }[];
};

export async function getProductDetail(project: ProjectRow, f: InsightFilter, productId: string): Promise<ProductDetail | null> {
  const meta = await rows<{
    id: string;
    name: string;
    brand_name: string | null;
    competitor_id: string | null;
    is_own: boolean;
    category: string | null;
    image_url: string | null;
    attributes: Record<string, string> | null;
    first_seen: string | null;
    last_seen: string | null;
  }>(sql`
    select id, name, brand_name, competitor_id, is_own, category, image_url, attributes,
           to_char(first_seen_at, 'YYYY-MM-DD') as first_seen, to_char(last_seen_at, 'YYYY-MM-DD') as last_seen
    from ai_products where project_id = ${project.id} and id = ${productId}`);
  const p = meta[0];
  if (!p) return null;
  const pf = sql`pa.product_id = ${productId}`;
  const [kpi, daily, engines, sources, stores, recent, promptRows, promptMap, brands] = await Promise.all([
    rows<{ n: number; prev_n: number; engines: number; pos: number | null; rating: number | null; reviews: number | null; last: string | null }>(sql`
      select (count(*) filter (where pa.answer_date >= ${f.from}::date))::int as n,
             (count(*) filter (where pa.answer_date < ${f.from}::date))::int as prev_n,
             (count(distinct pa.engine) filter (where pa.answer_date >= ${f.from}::date))::int as engines,
             (avg(pa.position) filter (where pa.answer_date >= ${f.from}::date))::float8 as pos,
             (avg(pa.rating) filter (where pa.answer_date >= ${f.from}::date))::float8 as rating,
             (max(pa.reviews) filter (where pa.answer_date >= ${f.from}::date))::int as reviews,
             to_char(max(pa.answer_date), 'YYYY-MM-DD') as last
      from ai_product_appearances pa where ${scope(f, "pa", "both")} and ${pf}`),
    rows<{ d: string; n: number }>(sql`
      select to_char(pa.answer_date, 'YYYY-MM-DD') as d, count(*)::int as n
      from ai_product_appearances pa where ${scope(f, "pa")} and ${pf} group by 1`),
    rows<{ engine: string; n: number }>(sql`
      select pa.engine, count(*)::int as n from ai_product_appearances pa where ${scope(f, "pa")} and ${pf} group by 1 order by 2 desc`),
    rows<{ source: string; n: number }>(sql`
      select pa.source, count(*)::int as n from ai_product_appearances pa where ${scope(f, "pa")} and ${pf} group by 1 order by 2 desc`),
    rows<{ store: string; domain: string | null; price: number | null; old_price: number | null; currency: string | null; min: number | null; max: number | null; n: number; url: string | null }>(sql`
      select pa.store, min(pa.store_domain) as domain,
             ((array_agg(pa.price order by pa.answer_date desc) filter (where pa.price is not null))[1])::float8 as price,
             ((array_agg(pa.old_price order by pa.answer_date desc) filter (where pa.price is not null))[1])::float8 as old_price,
             min(pa.currency) as currency, min(pa.price)::float8 as min, max(pa.price)::float8 as max, count(*)::int as n,
             (array_agg(pa.url order by pa.answer_date desc) filter (where pa.url is not null))[1] as url
      from ai_product_appearances pa where ${scope(f, "pa")} and ${pf} and pa.store is not null
      group by 1 order by n desc limit 30`),
    rows<{ answer_id: string; d: string; engine: string; prompt_id: string; store: string | null; price: number | null; currency: string | null; position: number | null; source: string }>(sql`
      select pa.answer_id, to_char(pa.answer_date, 'YYYY-MM-DD') as d, pa.engine, pa.prompt_id, pa.store, pa.price::float8 as price, pa.currency, pa.position, pa.source
      from ai_product_appearances pa where ${scope(f, "pa")} and ${pf}
      order by pa.answer_date desc, pa.engine limit 40`),
    rows<{ prompt_id: string; n: number; engines: string[]; pos: number | null; last: string; latest: string }>(sql`
      select pa.prompt_id, count(*)::int as n, array_agg(distinct pa.engine) as engines, avg(pa.position)::float8 as pos,
             to_char(max(pa.answer_date), 'YYYY-MM-DD') as last, (array_agg(pa.answer_id order by pa.answer_date desc))[1] as latest
      from ai_product_appearances pa where ${scope(f, "pa")} and ${pf}
      group by 1 order by 2 desc limit 200`),
    getPromptMap(project.id),
    getBrands(project),
  ]);
  const k = kpi[0]!;
  const dates = dayRange(f.from, f.to);
  const dm = new Map(daily.map((r) => [r.d, r.n]));
  const brand = p.is_own ? brands.find((b) => b.isOwn) : p.competitor_id ? brands.find((b) => b.competitorId === p.competitor_id) : undefined;
  return {
    id: p.id,
    name: p.name,
    brandName: brand?.name ?? p.brand_name,
    brandDomain: brand?.domain ?? null,
    isOwn: p.is_own,
    category: p.category,
    imageUrl: p.image_url && /^https:\/\//i.test(p.image_url) ? p.image_url : null,
    attributes: p.attributes ?? {},
    firstSeen: p.first_seen,
    lastSeen: k.last ?? p.last_seen,
    kpis: { appearances: k.n, appearancesDelta: delta(k.n, k.prev_n), engines: k.engines, avgPosition: k.pos, rating: k.rating, reviews: k.reviews },
    dates,
    daily: dates.map((d) => dm.get(d) ?? 0),
    engines: engines.map((e) => ({ engine: e.engine, n: e.n })),
    sources: sources.map((s) => ({ source: s.source, n: s.n })),
    stores: stores.map((s) => ({ store: s.store, domain: s.domain, price: s.price, oldPrice: s.old_price, currency: s.currency, min: s.min, max: s.max, n: s.n, url: s.url })),
    recent: recent.map((r) => ({
      answerId: r.answer_id,
      date: r.d,
      engine: r.engine,
      promptText: promptMap.get(r.prompt_id)?.text ?? "",
      store: r.store,
      price: r.price,
      currency: r.currency,
      position: r.position,
      source: r.source,
    })),
    prompts: promptRows
      .filter((r) => promptMap.has(r.prompt_id))
      .map((r) => ({
        id: r.prompt_id,
        text: promptMap.get(r.prompt_id)!.text,
        country: promptMap.get(r.prompt_id)!.country,
        n: r.n,
        engines: r.engines ?? [],
        avgPosition: r.pos,
        lastSeen: r.last,
        latestAnswerId: r.latest,
      })),
  };
}
