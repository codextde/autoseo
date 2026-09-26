import "server-only";
import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { getEngine } from "@/lib/engines";
import type { BrandRow, DataBundle, Kpis, PromptRow, StatementRow, TaskRow, TrendPoint } from "@/features/reports/lib/bundle";
import { daysBetween, resolveReportPeriod, type ResolvedPeriod } from "@/features/reports/lib/period";
import type { DateRangeValue } from "@/features/reports/lib/types";
import { getBrandKit } from "./brand";

/*
 * Live data resolver for reports. Loads everything a deck can bind to (tokens, charts, lists,
 * tables) for one project + period in a handful of aggregate queries over the AI visibility tables:
 *   Visibility     = answers naming OR citing the brand ÷ all answers
 *   Mention rate   = answers naming the brand ÷ all answers
 *   Citation rate  = answers citing an own domain ÷ all answers
 *   Avg. position  = mean rank of the brand among brands named (where named)
 *   Share of voice = own mention rows ÷ all brand mention rows
 * Other modules' tables (tasks, audits, Search Console, AI traffic) are read defensively.
 */

type Row = Record<string, unknown>;

async function q(query: SQL): Promise<Row[]> {
  const res = await db.execute(query);
  return res as unknown as Row[];
}

/** Runs a query against another module's table; returns null when the table/columns are missing. */
async function qSafe(query: SQL): Promise<Row[] | null> {
  try {
    return await q(query);
  } catch {
    return null;
  }
}

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const nn = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const pct = (part: number, total: number): number | null => (total > 0 ? Math.round((part / total) * 1000) / 10 : null);
const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

const CONTENT_TYPE_LABELS: Record<string, string> = {
  listicle: "Listicle",
  "buying-guide": "Buying guide",
  test: "Test / review",
  ugc: "UGC",
  article: "Article",
  reference: "Reference",
  video: "Video",
  retail: "Retail",
  news: "News",
  forum: "Forum",
  brand: "Brand site",
  docs: "Docs",
  other: "Other",
};

const FUNNEL_LABELS: Record<string, string> = { tofu: "Awareness (TOFU)", mofu: "Consideration (MOFU)", bofu: "Decision (BOFU)" };

export function geoScore(k: { visibility: number | null; citationRate: number | null; sentiment: number | null; avgPosition: number | null }): number | null {
  if (k.visibility === null) return null;
  const parts: [number, number][] = [[k.visibility, 0.45]];
  if (k.citationRate !== null) parts.push([k.citationRate, 0.25]);
  if (k.sentiment !== null) parts.push([k.sentiment, 0.15]);
  if (k.avgPosition !== null) parts.push([Math.max(0, 100 - (k.avgPosition - 1) * 20), 0.15]);
  const wsum = parts.reduce((s, [, w]) => s + w, 0);
  return Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / wsum);
}

async function answerKpis(projectId: string, from: string, to: string) {
  const [row] = await q(sql`
    SELECT count(*) AS answers,
      count(*) FILTER (WHERE brand_mentioned OR brand_cited) AS visible,
      count(*) FILTER (WHERE brand_mentioned) AS mentioned,
      count(*) FILTER (WHERE brand_cited) AS cited,
      count(*) FILTER (WHERE brand_mentioned AND brand_cited) AS both_mc,
      avg(brand_position) FILTER (WHERE brand_mentioned AND brand_position IS NOT NULL) AS pos,
      avg(sentiment) FILTER (WHERE brand_mentioned AND sentiment IS NOT NULL) AS sent
    FROM ai_answers
    WHERE project_id = ${projectId} AND status = 'ok' AND answer_date BETWEEN ${from} AND ${to}`);
  const [sov] = await q(sql`
    SELECT count(*) FILTER (WHERE is_own) AS own, count(*) AS total
    FROM ai_mentions WHERE project_id = ${projectId} AND answer_date BETWEEN ${from} AND ${to}`);
  const answers = n(row?.answers);
  const k = {
    answers,
    visible: n(row?.visible),
    mentioned: n(row?.mentioned),
    cited: n(row?.cited),
    both: n(row?.both_mc),
    visibility: pct(n(row?.visible), answers),
    mentionRate: pct(n(row?.mentioned), answers),
    citationRate: pct(n(row?.cited), answers),
    avgPosition: r1(nn(row?.pos)),
    sentiment: r1(nn(row?.sent)),
    shareOfVoice: pct(n(sov?.own), n(sov?.total)),
  };
  return k;
}

function toKpis(k: Awaited<ReturnType<typeof answerKpis>>): Kpis {
  return {
    visibility: k.visibility,
    mentionRate: k.mentionRate,
    citationRate: k.citationRate,
    avgPosition: k.avgPosition,
    sentiment: k.sentiment,
    shareOfVoice: k.shareOfVoice,
    geoScore: geoScore(k),
  };
}

/** Competitor visible answers (named OR cited via a competitor-owned source). */
async function competitorVisibility(projectId: string, from: string, to: string) {
  const rows = await q(sql`
    SELECT competitor_id, count(DISTINCT answer_id) AS visible FROM (
      SELECT competitor_id, answer_id FROM ai_mentions
        WHERE project_id = ${projectId} AND answer_date BETWEEN ${from} AND ${to} AND competitor_id IS NOT NULL
      UNION ALL
      SELECT s.competitor_id, c.answer_id FROM ai_citations c JOIN ai_sources s ON s.id = c.source_id
        WHERE c.project_id = ${projectId} AND c.answer_date BETWEEN ${from} AND ${to} AND s.competitor_id IS NOT NULL
    ) x GROUP BY competitor_id`);
  return new Map(rows.map((r) => [String(r.competitor_id), n(r.visible)]));
}

async function loadAi(projectId: string, p: ResolvedPeriod, ownName: string, ownDomain: string): Promise<DataBundle["ai"]> {
  const [cur, prev] = await Promise.all([answerKpis(projectId, p.from, p.to), answerKpis(projectId, p.prevFrom, p.prevTo)]);
  const answers = cur.answers;

  const [
    trendRows,
    competitorRows,
    mentionStats,
    visCur,
    visPrev,
    engineRows,
    sourceRows,
    sourceTotals,
    typeRows,
    ownPageRows,
    promptRows,
    promptPrevRows,
    statementMix,
    praiseRows,
    criticismRows,
    fanoutRows,
  ] = await Promise.all([
    q(sql`
      SELECT to_char(answer_date, 'YYYY-MM-DD') AS d, count(*) AS answers,
        count(*) FILTER (WHERE brand_mentioned OR brand_cited) AS visible,
        count(*) FILTER (WHERE brand_mentioned) AS mentioned,
        count(*) FILTER (WHERE brand_cited) AS cited,
        avg(brand_position) FILTER (WHERE brand_mentioned AND brand_position IS NOT NULL) AS pos,
        avg(sentiment) FILTER (WHERE brand_mentioned AND sentiment IS NOT NULL) AS sent
      FROM ai_answers WHERE project_id = ${projectId} AND status = 'ok' AND answer_date BETWEEN ${p.from} AND ${p.to}
      GROUP BY answer_date ORDER BY answer_date`),
    q(sql`SELECT id, name, domain, color FROM competitors WHERE project_id = ${projectId} AND tracked = true ORDER BY name`),
    q(sql`
      SELECT competitor_id, count(DISTINCT answer_id) AS mention_answers, count(*) AS mention_rows,
        avg(position) AS pos, avg(sentiment) FILTER (WHERE sentiment IS NOT NULL) AS sent
      FROM ai_mentions WHERE project_id = ${projectId} AND answer_date BETWEEN ${p.from} AND ${p.to} AND competitor_id IS NOT NULL
      GROUP BY competitor_id`),
    competitorVisibility(projectId, p.from, p.to),
    competitorVisibility(projectId, p.prevFrom, p.prevTo),
    q(sql`
      SELECT engine, count(*) AS answers,
        count(*) FILTER (WHERE brand_mentioned OR brand_cited) AS visible,
        count(*) FILTER (WHERE brand_mentioned) AS mentioned,
        count(*) FILTER (WHERE brand_cited) AS cited
      FROM ai_answers WHERE project_id = ${projectId} AND status = 'ok' AND answer_date BETWEEN ${p.from} AND ${p.to}
      GROUP BY engine ORDER BY count(*) DESC`),
    q(sql`
      SELECT s.domain, max(s.title) AS title, count(*) AS citations, count(DISTINCT c.prompt_id) AS prompts,
        mode() WITHIN GROUP (ORDER BY s.content_type) AS content_type,
        bool_or(s.ownership = 'own') AS is_own, bool_or(s.ownership = 'competitor') AS is_comp
      FROM ai_citations c JOIN ai_sources s ON s.id = c.source_id
      WHERE c.project_id = ${projectId} AND c.answer_date BETWEEN ${p.from} AND ${p.to}
      GROUP BY s.domain ORDER BY count(*) DESC, s.domain LIMIT 30`),
    q(sql`
      SELECT count(*) AS total, count(*) FILTER (WHERE s.ownership = 'own') AS own, count(DISTINCT s.domain) AS domains
      FROM ai_citations c JOIN ai_sources s ON s.id = c.source_id
      WHERE c.project_id = ${projectId} AND c.answer_date BETWEEN ${p.from} AND ${p.to}`),
    q(sql`
      SELECT s.content_type AS type, count(*) AS citations
      FROM ai_citations c JOIN ai_sources s ON s.id = c.source_id
      WHERE c.project_id = ${projectId} AND c.answer_date BETWEEN ${p.from} AND ${p.to}
      GROUP BY s.content_type ORDER BY count(*) DESC`),
    q(sql`
      SELECT s.url, max(s.title) AS title, count(*) AS citations
      FROM ai_citations c JOIN ai_sources s ON s.id = c.source_id
      WHERE c.project_id = ${projectId} AND c.answer_date BETWEEN ${p.from} AND ${p.to} AND s.ownership = 'own'
      GROUP BY s.url ORDER BY count(*) DESC LIMIT 12`),
    q(sql`
      SELECT pr.id, pr.text, pr.topic, pr.funnel_stage,
        count(a.id) AS answers,
        count(a.id) FILTER (WHERE a.brand_mentioned OR a.brand_cited) AS visible,
        count(a.id) FILTER (WHERE a.brand_mentioned) AS mentioned,
        count(a.id) FILTER (WHERE a.brand_cited) AS cited
      FROM prompts pr
      LEFT JOIN ai_answers a ON a.prompt_id = pr.id AND a.status = 'ok' AND a.answer_date BETWEEN ${p.from} AND ${p.to}
      WHERE pr.project_id = ${projectId} AND pr.status = 'active'
      GROUP BY pr.id ORDER BY pr.created_at LIMIT 400`),
    q(sql`
      SELECT prompt_id, count(*) AS answers, count(*) FILTER (WHERE brand_mentioned OR brand_cited) AS visible
      FROM ai_answers WHERE project_id = ${projectId} AND status = 'ok' AND answer_date BETWEEN ${p.prevFrom} AND ${p.prevTo}
      GROUP BY prompt_id`),
    q(sql`
      SELECT polarity, count(*) AS c FROM ai_statements
      WHERE project_id = ${projectId} AND is_own = true AND answer_date BETWEEN ${p.from} AND ${p.to}
      GROUP BY polarity`),
    q(sql`
      SELECT quote, theme, attribute, brand_name FROM ai_statements
      WHERE project_id = ${projectId} AND is_own = true AND polarity = 'praise' AND answer_date BETWEEN ${p.from} AND ${p.to}
      ORDER BY severity DESC, answer_date DESC LIMIT 20`),
    q(sql`
      SELECT quote, theme, attribute, brand_name FROM ai_statements
      WHERE project_id = ${projectId} AND is_own = true AND polarity = 'criticism' AND answer_date BETWEEN ${p.from} AND ${p.to}
      ORDER BY severity DESC, answer_date DESC LIMIT 20`),
    q(sql`
      SELECT min(query) AS query, count(*) AS c FROM ai_fanouts
      WHERE project_id = ${projectId} AND answer_date BETWEEN ${p.from} AND ${p.to}
      GROUP BY lower(query) ORDER BY count(*) DESC LIMIT 15`),
  ]);

  /* trend (every day of the period, null where no answers) */
  const byDay = new Map(trendRows.map((r) => [String(r.d).slice(0, 10), r]));
  const days = daysBetween(p.from, p.to);
  const trend: TrendPoint[] = days.map((d) => {
    const r = byDay.get(d);
    const a = n(r?.answers);
    return {
      date: d,
      answers: a,
      visibility: r ? pct(n(r.visible), a) : null,
      mentionRate: r ? pct(n(r.mentioned), a) : null,
      citationRate: r ? pct(n(r.cited), a) : null,
      sentiment: r ? r1(nn(r.sent)) : null,
      position: r ? r1(nn(r.pos)) : null,
    };
  });

  /* brands (own + competitors) */
  const totalMentionRows = await q(sql`
    SELECT count(*) AS total FROM ai_mentions WHERE project_id = ${projectId} AND answer_date BETWEEN ${p.from} AND ${p.to}`);
  const allMentions = n(totalMentionRows[0]?.total);
  const mStats = new Map(mentionStats.map((r) => [String(r.competitor_id), r]));
  const prevAnswers = prev.answers;
  const brands: BrandRow[] = [
    {
      key: "own",
      name: ownName,
      domain: ownDomain,
      isOwn: true,
      color: null,
      visibleAnswers: cur.visible,
      mentions: cur.mentioned,
      citedAnswers: cur.cited,
      visibility: cur.visibility,
      prevVisibility: prev.visibility,
      mentionRate: cur.mentionRate,
      avgPosition: cur.avgPosition,
      sentiment: cur.sentiment,
      shareOfVoice: cur.shareOfVoice,
    },
    ...competitorRows.map((c): BrandRow => {
      const id = String(c.id);
      const ms = mStats.get(id);
      const visible = visCur.get(id) ?? 0;
      const mentionAnswers = n(ms?.mention_answers);
      return {
        key: id,
        name: String(c.name),
        domain: (c.domain as string | null) ?? null,
        isOwn: false,
        color: (c.color as string | null) ?? null,
        visibleAnswers: visible,
        mentions: n(ms?.mention_rows),
        citedAnswers: Math.max(0, visible - mentionAnswers),
        visibility: pct(visible, answers) ?? (answers ? 0 : null),
        prevVisibility: prevAnswers ? (pct(visPrev.get(id) ?? 0, prevAnswers) ?? 0) : null,
        mentionRate: answers ? (pct(mentionAnswers, answers) ?? 0) : null,
        avgPosition: r1(nn(ms?.pos)),
        sentiment: r1(nn(ms?.sent)),
        shareOfVoice: allMentions ? (pct(n(ms?.mention_rows), allMentions) ?? 0) : null,
      };
    }),
  ].sort((a, b) => (b.visibility ?? -1) - (a.visibility ?? -1) || Number(b.isOwn) - Number(a.isOwn));

  /* brand trend: own + top competitors (daily visibility) */
  const topRivals = brands.filter((b) => !b.isOwn && (b.visibility ?? 0) > 0).slice(0, 5);
  let rivalDaily = new Map<string, Map<string, number>>();
  if (topRivals.length) {
    const ids = topRivals.map((b) => b.key);
    const rows = await q(sql`
      SELECT competitor_id, to_char(answer_date, 'YYYY-MM-DD') AS d, count(DISTINCT answer_id) AS visible FROM (
        SELECT competitor_id, answer_id, answer_date FROM ai_mentions
          WHERE project_id = ${projectId} AND answer_date BETWEEN ${p.from} AND ${p.to} AND competitor_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        UNION ALL
        SELECT s.competitor_id, c.answer_id, c.answer_date FROM ai_citations c JOIN ai_sources s ON s.id = c.source_id
          WHERE c.project_id = ${projectId} AND c.answer_date BETWEEN ${p.from} AND ${p.to} AND s.competitor_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      ) x GROUP BY competitor_id, answer_date`);
    rivalDaily = new Map();
    for (const r of rows) {
      const id = String(r.competitor_id);
      if (!rivalDaily.has(id)) rivalDaily.set(id, new Map());
      rivalDaily.get(id)!.set(String(r.d).slice(0, 10), n(r.visible));
    }
  }
  const trendBrands = [{ key: "own", name: ownName, isOwn: true }, ...topRivals.map((b) => ({ key: b.key, name: b.name, isOwn: false }))];
  const brandTrend = {
    brands: trendBrands,
    rows: trend.map((t) => {
      const values: Record<string, number | null> = { own: t.visibility };
      for (const b of topRivals) values[b.key] = t.answers ? (pct(rivalDaily.get(b.key)?.get(t.date) ?? 0, t.answers) ?? 0) : null;
      return { date: t.date, values };
    }),
  };

  /* engines (best visibility first) */
  const engines = engineRows.map((r) => {
    const a = n(r.answers);
    const id = String(r.engine);
    return {
      engine: id,
      label: getEngine(id)?.name ?? id,
      answers: a,
      visibility: pct(n(r.visible), a),
      mentionRate: pct(n(r.mentioned), a),
      citationRate: pct(n(r.cited), a),
    };
  }).sort((x, y) => (y.visibility ?? -1) - (x.visibility ?? -1));

  /* sources */
  const sources = sourceRows.map((r) => ({
    domain: String(r.domain),
    title: (r.title as string | null) ?? null,
    citations: n(r.citations),
    prompts: n(r.prompts),
    contentType: CONTENT_TYPE_LABELS[String(r.content_type)] ?? String(r.content_type ?? "Other"),
    ownership: (r.is_own ? "own" : r.is_comp ? "competitor" : "third_party") as "own" | "competitor" | "third_party",
  }));
  const sourceTypes = typeRows.map((r) => ({ type: String(r.type), label: CONTENT_TYPE_LABELS[String(r.type)] ?? String(r.type), citations: n(r.citations) }));
  const ownPages = ownPageRows.map((r) => ({ url: String(r.url), title: (r.title as string | null) ?? null, citations: n(r.citations) }));

  /* prompts */
  const prevByPrompt = new Map(promptPrevRows.map((r) => [String(r.prompt_id), r]));
  const prompts: PromptRow[] = promptRows.map((r) => {
    const a = n(r.answers);
    const m = n(r.mentioned);
    const c = n(r.cited);
    const pr = prevByPrompt.get(String(r.id));
    const category: PromptRow["category"] = a === 0 ? "no_data" : m > 0 && c > 0 ? "mentioned_cited" : m > 0 ? "mentioned" : c > 0 ? "cited" : "none";
    return {
      id: String(r.id),
      text: String(r.text),
      topic: (r.topic as string | null) ?? null,
      funnelStage: (r.funnel_stage as string | null) ?? null,
      answers: a,
      visibility: pct(n(r.visible), a),
      prevVisibility: pr ? pct(n(pr.visible), n(pr.answers)) : null,
      mentionRate: pct(m, a),
      citationRate: pct(c, a),
      category,
    };
  });
  const withData = prompts.filter((pr) => pr.category !== "no_data");
  const visiblePrompts = withData.filter((pr) => pr.category !== "none").length;

  const funnelAgg = new Map<string, { prompts: number; answers: number; visible: number }>();
  const topicAgg = new Map<string, { prompts: number; answers: number; visible: number }>();
  for (const r of promptRows) {
    const a = n(r.answers);
    const v = n(r.visible);
    if (r.funnel_stage) {
      const f = funnelAgg.get(String(r.funnel_stage)) ?? { prompts: 0, answers: 0, visible: 0 };
      f.prompts++;
      f.answers += a;
      f.visible += v;
      funnelAgg.set(String(r.funnel_stage), f);
    }
    const topic = (r.topic as string | null) || "Other";
    const t = topicAgg.get(topic) ?? { prompts: 0, answers: 0, visible: 0 };
    t.prompts++;
    t.answers += a;
    t.visible += v;
    topicAgg.set(topic, t);
  }
  const funnel = ["tofu", "mofu", "bofu"]
    .filter((s) => funnelAgg.has(s))
    .map((s) => {
      const f = funnelAgg.get(s)!;
      return { stage: s, label: FUNNEL_LABELS[s] ?? s, prompts: f.prompts, visibility: pct(f.visible, f.answers) };
    });
  const topics = [...topicAgg.entries()]
    .map(([topic, t]) => ({ topic, prompts: t.prompts, visibility: pct(t.visible, t.answers) }))
    .sort((a, b) => (b.visibility ?? -1) - (a.visibility ?? -1) || b.prompts - a.prompts)
    .slice(0, 12);

  /* sentiment */
  const mix = { praise: 0, neutral: 0, criticism: 0 };
  for (const r of statementMix) {
    const k = String(r.polarity) as keyof typeof mix;
    if (k in mix) mix[k] = n(r.c);
  }
  const dedupe = (rows: Row[]): StatementRow[] => {
    const seen = new Set<string>();
    const out: StatementRow[] = [];
    for (const r of rows) {
      const quote = String(r.quote).trim();
      const key = quote.toLowerCase().slice(0, 80);
      if (!quote || seen.has(key)) continue;
      seen.add(key);
      out.push({ quote, theme: (r.theme as string | null) ?? null, attribute: (r.attribute as string | null) ?? null, brand: String(r.brand_name) });
      if (out.length >= 8) break;
    }
    return out;
  };

  const [promptCountRow] = await q(sql`SELECT count(*) AS c FROM prompts WHERE project_id = ${projectId} AND status = 'active'`);

  return {
    answers,
    prevAnswers,
    current: toKpis(cur),
    previous: toKpis(prev),
    counts: {
      mentionAnswers: cur.mentioned,
      citedAnswers: cur.cited,
      ownCitations: n(sourceTotals[0]?.own),
      totalCitations: n(sourceTotals[0]?.total),
      trackedPrompts: n(promptCountRow?.c),
      engines: engines.length,
      competitors: competitorRows.length,
      sources: n(sourceTotals[0]?.domains),
      promptsVisible: visiblePrompts,
      promptsInvisible: withData.length - visiblePrompts,
      promptsWithData: withData.length,
    },
    trend,
    brandTrend,
    brands,
    engines,
    sources,
    sourceTypes,
    ownPages,
    prompts: prompts.map((pr) => ({ ...pr, text: pr.text.length > 240 ? `${pr.text.slice(0, 239)}…` : pr.text })),
    coverage: {
      mentionedCited: cur.both,
      mentionedOnly: cur.mentioned - cur.both,
      citedOnly: cur.cited - cur.both,
      notVisible: answers - cur.visible,
    },
    funnel,
    topics,
    sentimentMix: mix,
    praise: dedupe(praiseRows),
    criticism: dedupe(criticismRows),
    fanouts: fanoutRows.map((r) => ({ query: String(r.query), count: n(r.c) })),
  };
}

async function loadOther(projectId: string, p: ResolvedPeriod): Promise<DataBundle["other"]> {
  const [taskRows, openRows, auditRows, crawlRows, scRows, trafficRows] = await Promise.all([
    qSafe(sql`
      SELECT title, category, priority, impact, effort, status FROM optimize_tasks
      WHERE project_id = ${projectId} AND status IN ('open', 'in_progress')
      ORDER BY priority DESC, impact DESC LIMIT 12`),
    qSafe(sql`SELECT count(*) AS c FROM optimize_tasks WHERE project_id = ${projectId} AND status IN ('open', 'in_progress')`),
    qSafe(sql`
      SELECT score, pages_crawled, issue_counts, to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS completed_at FROM site_audits
      WHERE project_id = ${projectId} AND status = 'completed' ORDER BY completed_at DESC NULLS LAST LIMIT 1`),
    qSafe(sql`
      SELECT score, to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS completed_at FROM crawlability_checks
      WHERE project_id = ${projectId} AND status = 'completed' ORDER BY completed_at DESC NULLS LAST LIMIT 1`),
    qSafe(sql`
      SELECT
        coalesce(sum(clicks) FILTER (WHERE date BETWEEN ${p.from} AND ${p.to}), 0) AS clicks,
        coalesce(sum(impressions) FILTER (WHERE date BETWEEN ${p.from} AND ${p.to}), 0) AS impressions,
        coalesce(sum(clicks) FILTER (WHERE date BETWEEN ${p.prevFrom} AND ${p.prevTo}), 0) AS prev_clicks,
        coalesce(sum(impressions) FILTER (WHERE date BETWEEN ${p.prevFrom} AND ${p.prevTo}), 0) AS prev_impressions,
        count(*) AS rows
      FROM analytics_sc_daily WHERE project_id = ${projectId} AND source = 'google'`),
    qSafe(sql`
      SELECT
        coalesce(sum(sessions) FILTER (WHERE date BETWEEN ${p.from} AND ${p.to}), 0) AS sessions,
        coalesce(sum(conversions) FILTER (WHERE date BETWEEN ${p.from} AND ${p.to}), 0) AS conversions,
        coalesce(sum(revenue) FILTER (WHERE date BETWEEN ${p.from} AND ${p.to}), 0) AS revenue,
        coalesce(sum(sessions) FILTER (WHERE date BETWEEN ${p.prevFrom} AND ${p.prevTo}), 0) AS prev_sessions,
        count(*) AS rows
      FROM analytics_traffic_rows WHERE project_id = ${projectId}`),
  ]);
  const tasks: TaskRow[] | null = taskRows
    ? taskRows.map((r) => ({
        title: String(r.title),
        category: String(r.category ?? "other"),
        priority: n(r.priority),
        impact: n(r.impact),
        effort: n(r.effort),
        status: String(r.status),
      }))
    : null;
  const audit = auditRows?.[0];
  const counts = (audit?.issue_counts ?? null) as { critical?: number; warning?: number } | null;
  const crawl = crawlRows?.[0];
  const sc = scRows?.[0];
  const tr = trafficRows?.[0];
  return {
    tasks,
    openTasks: openRows ? n(openRows[0]?.c) : null,
    audit: audit
      ? {
          score: nn(audit.score),
          pages: n(audit.pages_crawled),
          critical: n(counts?.critical),
          warning: n(counts?.warning),
          completedAt: audit.completed_at ? String(audit.completed_at) : null,
        }
      : null,
    crawlability: crawl ? { score: nn(crawl.score), completedAt: crawl.completed_at ? String(crawl.completed_at) : null } : null,
    searchConsole:
      sc && n(sc.rows) > 0
        ? { clicks: n(sc.clicks), impressions: n(sc.impressions), prevClicks: n(sc.prev_clicks), prevImpressions: n(sc.prev_impressions) }
        : null,
    aiTraffic:
      tr && n(tr.rows) > 0
        ? { sessions: n(tr.sessions), conversions: Math.round(n(tr.conversions)), revenue: Math.round(n(tr.revenue)), prevSessions: n(tr.prev_sessions) }
        : null,
  };
}

/**
 * Builds the live data bundle for a project and date range. Callers MUST have verified project
 * access (the function itself only scopes every query by projectId).
 */
export async function loadReportData(projectId: string, range: DateRangeValue | null | undefined): Promise<DataBundle> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found");
  const period = resolveReportPeriod(range);
  const [kit, ai, other] = await Promise.all([
    getBrandKit(project.workspaceId, project.id),
    loadAi(project.id, period, project.name, project.domain),
    loadOther(project.id, period),
  ]);
  const k = kit.effective;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      domain: project.domain,
      country: project.country,
      clientName: k.clientName || project.name,
      clientLogo: k.clientLogo || null,
      clientColor: k.clientColor || null,
    },
    agency: {
      name: k.agencyName || "",
      logo: k.agencyLogo || null,
      website: k.agencyWebsite || null,
      email: k.agencyEmail || null,
    },
    period,
    ai,
    other,
  };
}
