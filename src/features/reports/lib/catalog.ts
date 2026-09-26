import { format as formatDate, parseISO } from "date-fns";
import { getCountry } from "@/lib/countries";
import type { DataBundle, Kpis } from "./bundle";
import type { ChartType } from "./types";

/*
 * Live data catalog: every token, chart binding, list source and live table the report builder
 * can insert. Each entry resolves against a DataBundle, so switching project ("one deck, every
 * client") or date range re-resolves the whole deck.
 */

export type ValueFormat =
  | "text"
  | "percent"
  | "number"
  | "compact"
  | "position"
  | "score"
  | "delta_pp"
  | "delta_num"
  | "delta_pos"
  | "delta_pct"
  | "currency";

export type ResolveCtx = {
  bundle: DataBundle | null;
  report?: { title?: string; subtitle?: string | null };
  /** Pre-resolved values (public share pages never receive the raw bundle). */
  resolved?: ResolvedData | null;
};

export type TokenDef = {
  label: string;
  category: string;
  format: ValueFormat;
  description?: string;
  /** For deltas: false when a negative change is good (e.g. position). */
  higherIsBetter?: boolean;
  get: (b: DataBundle, ctx: ResolveCtx) => string | number | null;
};

const nf = (digits = 0) => new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export function formatValue(value: string | number | null | undefined, format: ValueFormat): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "—";
  switch (format) {
    case "percent":
      return `${nf(1).format(value)}%`;
    case "number":
      return nf(0).format(value);
    case "compact":
      return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
    case "position":
      return `#${nf(1).format(value)}`;
    case "score":
      return nf(0).format(Math.round(value));
    case "delta_pp":
      return `${value > 0 ? "+" : value < 0 ? "−" : "±"}${nf(1).format(Math.abs(value))} pp`;
    case "delta_num":
      return `${value > 0 ? "+" : value < 0 ? "−" : "±"}${nf(0).format(Math.abs(value))}`;
    case "delta_pos":
      return `${value > 0 ? "+" : value < 0 ? "−" : "±"}${nf(1).format(Math.abs(value))}`;
    case "delta_pct":
      return `${value > 0 ? "+" : value < 0 ? "−" : "±"}${nf(1).format(Math.abs(value))}%`;
    case "currency":
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
    default:
      return String(value);
  }
}

const diff = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined ? null : Math.round((a - b) * 10) / 10;
const pctChange = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
const fmtDay = (iso: string) => {
  try {
    return formatDate(parseISO(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
};

function kpi(key: keyof Kpis, label: string, format: ValueFormat, category = "AI Visibility", description?: string): Record<string, TokenDef> {
  const deltaFormat: ValueFormat = format === "percent" ? "delta_pp" : format === "position" ? "delta_pos" : "delta_num";
  const lowerBetter = key === "avgPosition";
  const base = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  return {
    [`ai.${base}`]: { label, category, format, description, get: (b) => b.ai.current[key] },
    [`ai.${base}_delta`]: {
      label: `${label} change`,
      category,
      format: deltaFormat,
      higherIsBetter: !lowerBetter,
      description: `Change vs. previous period`,
      get: (b) => diff(b.ai.current[key], b.ai.previous[key]),
    },
    [`ai.${base}_prev`]: { label: `${label} (previous period)`, category, format, get: (b) => b.ai.previous[key] },
  };
}

const own = (b: DataBundle) => b.ai.brands.find((r) => r.isOwn) ?? null;
const rivals = (b: DataBundle) => b.ai.brands.filter((r) => !r.isOwn);
const leader = (b: DataBundle) => rivals(b)[0] ?? null;

function grade(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "E";
}

export const TOKENS: Record<string, TokenDef> = {
  /* ── General ── */
  "brand.name": { label: "Brand name", category: "General", format: "text", get: (b) => b.project.name },
  "client.name": { label: "Client name", category: "General", format: "text", get: (b) => b.project.clientName },
  "agency.name": { label: "Agency name", category: "General", format: "text", get: (b) => b.agency.name || null },
  "agency.website": { label: "Agency website", category: "General", format: "text", get: (b) => b.agency.website },
  "agency.email": { label: "Agency email", category: "General", format: "text", get: (b) => b.agency.email },
  "project.domain": { label: "Website", category: "General", format: "text", get: (b) => b.project.domain },
  "project.market": {
    label: "Tracking market",
    category: "General",
    format: "text",
    get: (b) => getCountry(b.project.country)?.name ?? b.project.country,
  },
  "report.title": { label: "Report title", category: "General", format: "text", get: (_b, c) => c.report?.title ?? null },
  "report.subtitle": { label: "Report subtitle", category: "General", format: "text", get: (_b, c) => c.report?.subtitle ?? null },
  "report.period": { label: "Reporting period", category: "General", format: "text", get: (b) => b.period.label },
  "report.period_start": { label: "Period start", category: "General", format: "text", get: (b) => fmtDay(b.period.from) },
  "report.period_end": { label: "Period end", category: "General", format: "text", get: (b) => fmtDay(b.period.to) },
  "report.month": {
    label: "Reporting month",
    category: "General",
    format: "text",
    get: (b) => {
      try {
        return formatDate(parseISO(b.period.to), "MMMM yyyy");
      } catch {
        return null;
      }
    },
  },
  "report.date": { label: "Date", category: "General", format: "text", get: (b) => fmtDay(b.generatedAt.slice(0, 10)) },
  "report.days": { label: "Days in period", category: "General", format: "number", get: (b) => b.period.days },

  /* ── AI visibility KPIs ── */
  ...kpi("visibility", "Visibility score", "percent", "AI Visibility", "Answers naming or citing the brand ÷ all answers"),
  ...kpi("mentionRate", "Mention rate", "percent", "AI Visibility", "Answers naming the brand ÷ all answers"),
  ...kpi("citationRate", "Citation rate", "percent", "AI Visibility", "Answers citing an own domain ÷ all answers"),
  ...kpi("avgPosition", "Avg. position", "position", "AI Visibility", "Mean rank among brands named in an answer"),
  ...kpi("sentiment", "Sentiment", "score", "Sentiment", "Mean own-brand sentiment (0–100)"),
  ...kpi("shareOfVoice", "Share of voice", "percent", "Competitors", "Own mentions ÷ all brand mentions"),
  ...kpi("geoScore", "GEO score", "score", "AI Visibility", "Composite: 45% visibility, 25% citation rate, 15% sentiment, 15% position"),
  "ai.geo_grade": { label: "GEO grade", category: "AI Visibility", format: "text", get: (b) => grade(b.ai.current.geoScore) },
  "ai.answers": { label: "AI answers analysed", category: "AI Visibility", format: "number", get: (b) => b.ai.answers },
  "ai.answers_delta": {
    label: "AI answers change",
    category: "AI Visibility",
    format: "delta_num",
    get: (b) => b.ai.answers - b.ai.prevAnswers,
  },
  "ai.mentions": { label: "Answers mentioning brand", category: "AI Visibility", format: "number", get: (b) => b.ai.counts.mentionAnswers },
  "ai.citations": { label: "Citations (own domain)", category: "Citations", format: "number", get: (b) => b.ai.counts.ownCitations },
  "ai.cited_answers": { label: "Answers citing brand", category: "Citations", format: "number", get: (b) => b.ai.counts.citedAnswers },
  "ai.total_citations": { label: "All citations in answers", category: "Citations", format: "number", get: (b) => b.ai.counts.totalCitations },
  "ai.sources": { label: "Distinct cited sources", category: "Citations", format: "number", get: (b) => b.ai.counts.sources },
  "ai.own_citation_share": {
    label: "Own share of citations",
    category: "Citations",
    format: "percent",
    get: (b) => (b.ai.counts.totalCitations ? Math.round((b.ai.counts.ownCitations / b.ai.counts.totalCitations) * 1000) / 10 : null),
  },
  "ai.top_source": { label: "Top cited source", category: "Citations", format: "text", get: (b) => b.ai.sources[0]?.domain ?? null },
  "ai.top_source_type": {
    label: "Top source type",
    category: "Citations",
    format: "text",
    get: (b) => [...b.ai.sourceTypes].sort((x, y) => y.citations - x.citations)[0]?.label ?? null,
  },
  "ai.tracked_prompts": { label: "Tracked prompts", category: "Prompts", format: "number", get: (b) => b.ai.counts.trackedPrompts },
  "ai.prompts_visible": { label: "Prompts where visible", category: "Prompts", format: "number", get: (b) => b.ai.counts.promptsVisible },
  "ai.prompts_invisible": { label: "Prompts where invisible", category: "Prompts", format: "number", get: (b) => b.ai.counts.promptsInvisible },
  "ai.prompt_coverage": {
    label: "Prompt coverage",
    category: "Prompts",
    format: "percent",
    description: "Prompts with at least one visible answer ÷ prompts with answers",
    get: (b) => (b.ai.counts.promptsWithData ? Math.round((b.ai.counts.promptsVisible / b.ai.counts.promptsWithData) * 1000) / 10 : null),
  },
  "ai.top_prompt": {
    label: "Best performing prompt",
    category: "Prompts",
    format: "text",
    get: (b) => [...b.ai.prompts].filter((p) => p.visibility !== null).sort((x, y) => (y.visibility ?? 0) - (x.visibility ?? 0))[0]?.text ?? null,
  },
  "ai.engines": { label: "AI engines tracked", category: "AI Visibility", format: "number", get: (b) => b.ai.counts.engines },
  "ai.best_engine": {
    label: "Best engine",
    category: "AI Visibility",
    format: "text",
    get: (b) => [...b.ai.engines].filter((e) => e.visibility !== null).sort((x, y) => (y.visibility ?? 0) - (x.visibility ?? 0))[0]?.label ?? null,
  },
  "ai.best_engine_visibility": {
    label: "Best engine visibility",
    category: "AI Visibility",
    format: "percent",
    get: (b) => [...b.ai.engines].filter((e) => e.visibility !== null).sort((x, y) => (y.visibility ?? 0) - (x.visibility ?? 0))[0]?.visibility ?? null,
  },
  "ai.worst_engine": {
    label: "Weakest engine",
    category: "AI Visibility",
    format: "text",
    get: (b) => [...b.ai.engines].filter((e) => e.visibility !== null).sort((x, y) => (x.visibility ?? 0) - (y.visibility ?? 0))[0]?.label ?? null,
  },
  "ai.worst_engine_visibility": {
    label: "Weakest engine visibility",
    category: "AI Visibility",
    format: "percent",
    get: (b) => [...b.ai.engines].filter((e) => e.visibility !== null).sort((x, y) => (x.visibility ?? 0) - (y.visibility ?? 0))[0]?.visibility ?? null,
  },

  /* ── Competitors ── */
  "ai.competitors": { label: "Competitors tracked", category: "Competitors", format: "number", get: (b) => b.ai.counts.competitors },
  "ai.rank": {
    label: "Visibility rank",
    category: "Competitors",
    format: "text",
    get: (b) => {
      const idx = b.ai.brands.findIndex((r) => r.isOwn);
      return idx >= 0 && b.ai.answers ? `#${idx + 1}` : null;
    },
  },
  "ai.rank_of": {
    label: "Brands ranked",
    category: "Competitors",
    format: "text",
    get: (b) => (b.ai.brands.length && b.ai.answers ? `of ${b.ai.brands.length}` : null),
  },
  "ai.top_competitor": { label: "Top competitor", category: "Competitors", format: "text", get: (b) => leader(b)?.name ?? null },
  "ai.top_competitor_visibility": {
    label: "Top competitor visibility",
    category: "Competitors",
    format: "percent",
    get: (b) => leader(b)?.visibility ?? null,
  },
  "ai.visibility_gap": {
    label: "Gap to top competitor",
    category: "Competitors",
    format: "delta_pp",
    description: "Own visibility minus the strongest competitor's visibility",
    get: (b) => diff(own(b)?.visibility ?? b.ai.current.visibility, leader(b)?.visibility),
  },
  "ai.leader": { label: "Visibility leader", category: "Competitors", format: "text", get: (b) => (b.ai.answers ? (b.ai.brands[0]?.name ?? null) : null) },

  /* ── Sentiment ── */
  "ai.praise_share": {
    label: "Praise share",
    category: "Sentiment",
    format: "percent",
    get: (b) => {
      const t = b.ai.sentimentMix.praise + b.ai.sentimentMix.neutral + b.ai.sentimentMix.criticism;
      return t ? Math.round((b.ai.sentimentMix.praise / t) * 1000) / 10 : null;
    },
  },
  "ai.criticism_share": {
    label: "Criticism share",
    category: "Sentiment",
    format: "percent",
    get: (b) => {
      const t = b.ai.sentimentMix.praise + b.ai.sentimentMix.neutral + b.ai.sentimentMix.criticism;
      return t ? Math.round((b.ai.sentimentMix.criticism / t) * 1000) / 10 : null;
    },
  },
  "ai.top_praise": { label: "Top praise", category: "Sentiment", format: "text", get: (b) => b.ai.praise[0]?.quote ?? null },
  "ai.top_criticism": { label: "Top criticism", category: "Sentiment", format: "text", get: (b) => b.ai.criticism[0]?.quote ?? null },

  /* ── SEO, traffic & tasks (other modules; null when not connected) ── */
  "seo.audit_score": { label: "Site audit score", category: "SEO & Traffic", format: "score", get: (b) => b.other.audit?.score ?? null },
  "seo.audit_critical": { label: "Critical audit issues", category: "SEO & Traffic", format: "number", get: (b) => b.other.audit?.critical ?? null },
  "seo.audit_pages": { label: "Pages crawled", category: "SEO & Traffic", format: "number", get: (b) => b.other.audit?.pages ?? null },
  "seo.crawlability_score": {
    label: "AI crawlability score",
    category: "SEO & Traffic",
    format: "score",
    get: (b) => b.other.crawlability?.score ?? null,
  },
  "gsc.clicks": { label: "Search clicks", category: "SEO & Traffic", format: "compact", get: (b) => b.other.searchConsole?.clicks ?? null },
  "gsc.clicks_delta": {
    label: "Search clicks change",
    category: "SEO & Traffic",
    format: "delta_pct",
    get: (b) => (b.other.searchConsole ? pctChange(b.other.searchConsole.clicks, b.other.searchConsole.prevClicks) : null),
  },
  "gsc.impressions": {
    label: "Search impressions",
    category: "SEO & Traffic",
    format: "compact",
    get: (b) => b.other.searchConsole?.impressions ?? null,
  },
  "traffic.ai_sessions": {
    label: "Sessions from AI platforms",
    category: "SEO & Traffic",
    format: "compact",
    get: (b) => b.other.aiTraffic?.sessions ?? null,
  },
  "traffic.ai_sessions_delta": {
    label: "AI sessions change",
    category: "SEO & Traffic",
    format: "delta_pct",
    get: (b) => (b.other.aiTraffic ? pctChange(b.other.aiTraffic.sessions, b.other.aiTraffic.prevSessions) : null),
  },
  "traffic.ai_conversions": {
    label: "Conversions from AI",
    category: "SEO & Traffic",
    format: "number",
    get: (b) => b.other.aiTraffic?.conversions ?? null,
  },
  "traffic.ai_revenue": { label: "Revenue from AI", category: "SEO & Traffic", format: "currency", get: (b) => b.other.aiTraffic?.revenue ?? null },
  "tasks.open": { label: "Open optimization tasks", category: "Tasks", format: "number", get: (b) => b.other.openTasks },
};

/** The fields shown first in the Data panel (finseo order). */
export const FEATURED_TOKENS = [
  "brand.name",
  "report.period",
  "report.date",
  "client.name",
  "agency.name",
  "ai.visibility",
  "ai.citations",
  "ai.tracked_prompts",
];

export function resolveToken(key: string, ctx: ResolveCtx): { value: string | number | null; text: string; def?: TokenDef } {
  const def = TOKENS[key];
  if (!def) return { value: null, text: `{{${key}}}` };
  if (ctx.resolved) {
    const r = ctx.resolved.tokens[key];
    return r ? { value: r.value, text: r.text, def } : { value: null, text: "—", def };
  }
  if (!ctx.bundle) return { value: null, text: "…", def };
  let value: string | number | null = null;
  try {
    value = def.get(ctx.bundle, ctx);
  } catch {
    value = null;
  }
  return { value, text: formatValue(value, def.format), def };
}

/** Sign tone of a delta token: 1 good, -1 bad, 0 neutral. */
export function deltaTone(key: string, value: string | number | null): -1 | 0 | 1 {
  if (typeof value !== "number" || value === 0) return 0;
  const def = TOKENS[key];
  const good = def?.higherIsBetter === false ? value < 0 : value > 0;
  return good ? 1 : -1;
}

/* ───────────────────────────── Charts ───────────────────────────── */

export type ChartSeriesData = {
  kind: "series";
  x: string[];
  series: { key: string; label: string; values: (number | null)[]; isOwn?: boolean }[];
  format: ValueFormat;
};
export type ChartCategoryData = {
  kind: "categories";
  items: { label: string; value: number; isOwn?: boolean }[];
  format: ValueFormat;
};
export type ChartData = ChartSeriesData | ChartCategoryData;

export type ChartDef = {
  label: string;
  category: string;
  types: ChartType[];
  defaultType: ChartType;
  description: string;
  get: (b: DataBundle, opts: { limit?: number }) => ChartData;
};

function trendChart(field: "visibility" | "mentionRate" | "citationRate" | "sentiment" | "position", label: string, format: ValueFormat) {
  return (b: DataBundle): ChartData => ({
    kind: "series",
    x: b.ai.trend.map((p) => p.date),
    series: [{ key: field, label, values: b.ai.trend.map((p) => p[field]), isOwn: true }],
    format,
  });
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export const CHARTS: Record<string, ChartDef> = {
  "trend.visibility": {
    label: "Visibility trend",
    category: "Trends",
    types: ["area", "line", "bar"],
    defaultType: "area",
    description: "Daily visibility score over the reporting period",
    get: trendChart("visibility", "Visibility", "percent"),
  },
  "trend.mention_rate": {
    label: "Mention rate trend",
    category: "Trends",
    types: ["area", "line", "bar"],
    defaultType: "line",
    description: "Daily mention rate",
    get: trendChart("mentionRate", "Mention rate", "percent"),
  },
  "trend.citation_rate": {
    label: "Citation rate trend",
    category: "Trends",
    types: ["area", "line", "bar"],
    defaultType: "line",
    description: "Daily citation rate",
    get: trendChart("citationRate", "Citation rate", "percent"),
  },
  "trend.sentiment": {
    label: "Sentiment trend",
    category: "Trends",
    types: ["line", "area", "bar"],
    defaultType: "line",
    description: "Daily own-brand sentiment",
    get: trendChart("sentiment", "Sentiment", "score"),
  },
  "trend.position": {
    label: "Position trend",
    category: "Trends",
    types: ["line", "bar"],
    defaultType: "line",
    description: "Daily average position among named brands",
    get: trendChart("position", "Avg. position", "position"),
  },
  "trend.brands": {
    label: "Visibility vs. competitors",
    category: "Competitors",
    types: ["line", "area"],
    defaultType: "line",
    description: "Daily visibility of your brand and the strongest competitors",
    get: (b, { limit }) => {
      const brands = b.ai.brandTrend.brands.slice(0, limit ?? 4);
      return {
        kind: "series",
        x: b.ai.brandTrend.rows.map((r) => r.date),
        series: brands.map((br) => ({
          key: br.key,
          label: br.name,
          isOwn: br.isOwn,
          values: b.ai.brandTrend.rows.map((r) => r.values[br.key] ?? null),
        })),
        format: "percent",
      };
    },
  },
  "brands.visibility": {
    label: "Competitor ranking",
    category: "Competitors",
    types: ["hbar", "bar", "donut"],
    defaultType: "hbar",
    description: "Visibility by brand (you highlighted)",
    get: (b, { limit }) => ({
      kind: "categories",
      items: b.ai.brands
        .filter((r) => r.visibility !== null)
        .slice(0, limit ?? 8)
        .map((r) => ({ label: r.name, value: r.visibility ?? 0, isOwn: r.isOwn })),
      format: "percent",
    }),
  },
  "brands.mention_rate": {
    label: "Mention rate by brand",
    category: "Competitors",
    types: ["hbar", "bar"],
    defaultType: "hbar",
    description: "Share of answers naming each brand",
    get: (b, { limit }) => ({
      kind: "categories",
      items: [...b.ai.brands]
        .filter((r) => r.mentionRate !== null)
        .sort((x, y) => (y.mentionRate ?? 0) - (x.mentionRate ?? 0))
        .slice(0, limit ?? 8)
        .map((r) => ({ label: r.name, value: r.mentionRate ?? 0, isOwn: r.isOwn })),
      format: "percent",
    }),
  },
  "brands.share_of_voice": {
    label: "Share of voice",
    category: "Competitors",
    types: ["donut", "hbar", "bar"],
    defaultType: "donut",
    description: "Share of all brand mentions",
    get: (b, { limit }) => {
      const rows = [...b.ai.brands].filter((r) => r.mentions > 0).sort((x, y) => y.mentions - x.mentions);
      const top = rows.slice(0, limit ?? 6);
      const rest = rows.slice(limit ?? 6).reduce((s, r) => s + (r.shareOfVoice ?? 0), 0);
      const items = top.map((r) => ({ label: r.name, value: r.shareOfVoice ?? 0, isOwn: r.isOwn }));
      if (rest > 0) items.push({ label: "Others", value: r1(rest), isOwn: false });
      return { kind: "categories", items, format: "percent" };
    },
  },
  "engines.visibility": {
    label: "Engine split",
    category: "AI Visibility",
    types: ["bar", "hbar", "donut"],
    defaultType: "bar",
    description: "Visibility per AI engine",
    get: (b, { limit }) => ({
      kind: "categories",
      items: b.ai.engines
        .filter((e) => e.visibility !== null)
        .slice(0, limit ?? 11)
        .map((e) => ({ label: e.label, value: e.visibility ?? 0 })),
      format: "percent",
    }),
  },
  "engines.answers": {
    label: "Answers per engine",
    category: "AI Visibility",
    types: ["donut", "bar", "hbar"],
    defaultType: "donut",
    description: "How many answers each engine produced",
    get: (b, { limit }) => ({
      kind: "categories",
      items: b.ai.engines.slice(0, limit ?? 11).map((e) => ({ label: e.label, value: e.answers })),
      format: "number",
    }),
  },
  "sources.types": {
    label: "Source types",
    category: "Citations",
    types: ["donut", "hbar", "bar"],
    defaultType: "donut",
    description: "Citations by content type (listicle, UGC, article…)",
    get: (b, { limit }) => ({
      kind: "categories",
      items: [...b.ai.sourceTypes]
        .sort((x, y) => y.citations - x.citations)
        .slice(0, limit ?? 8)
        .map((s) => ({ label: s.label, value: s.citations })),
      format: "number",
    }),
  },
  "sources.top": {
    label: "Top cited sources",
    category: "Citations",
    types: ["hbar", "bar"],
    defaultType: "hbar",
    description: "Most cited domains in AI answers",
    get: (b, { limit }) => ({
      kind: "categories",
      items: b.ai.sources.slice(0, limit ?? 8).map((s) => ({ label: s.domain, value: s.citations, isOwn: s.ownership === "own" })),
      format: "number",
    }),
  },
  "sources.ownership": {
    label: "Citation ownership",
    category: "Citations",
    types: ["donut", "bar"],
    defaultType: "donut",
    description: "Own vs. competitor vs. third-party citations",
    get: (b) => {
      const sum = (o: string) => b.ai.sources.filter((s) => s.ownership === o).reduce((a, s) => a + s.citations, 0);
      return {
        kind: "categories",
        items: [
          { label: "Own", value: sum("own"), isOwn: true },
          { label: "Competitors", value: sum("competitor") },
          { label: "Third-party", value: sum("third_party") },
        ].filter((i) => i.value > 0),
        format: "number",
      };
    },
  },
  "prompts.coverage": {
    label: "Answer coverage",
    category: "Prompts",
    types: ["donut", "bar", "hbar"],
    defaultType: "donut",
    description: "Mentioned + cited, mentioned only, cited only, not visible",
    get: (b) => {
      const c = b.ai.coverage;
      return {
        kind: "categories",
        items: [
          { label: "Mentioned + cited", value: c.mentionedCited, isOwn: true },
          { label: "Mentioned only", value: c.mentionedOnly },
          { label: "Cited only", value: c.citedOnly },
          { label: "Not visible", value: c.notVisible },
        ],
        format: "number",
      };
    },
  },
  "funnel.visibility": {
    label: "Visibility by funnel stage",
    category: "Prompts",
    types: ["bar", "hbar"],
    defaultType: "bar",
    description: "TOFU / MOFU / BOFU visibility",
    get: (b) => ({
      kind: "categories",
      items: b.ai.funnel.filter((f) => f.visibility !== null).map((f) => ({ label: f.label, value: f.visibility ?? 0 })),
      format: "percent",
    }),
  },
  "topics.visibility": {
    label: "Visibility by topic",
    category: "Prompts",
    types: ["hbar", "bar"],
    defaultType: "hbar",
    description: "Visibility per prompt topic",
    get: (b, { limit }) => ({
      kind: "categories",
      items: b.ai.topics
        .filter((t) => t.visibility !== null)
        .slice(0, limit ?? 8)
        .map((t) => ({ label: t.topic, value: t.visibility ?? 0 })),
      format: "percent",
    }),
  },
  "sentiment.mix": {
    label: "Sentiment mix",
    category: "Sentiment",
    types: ["donut", "bar", "hbar"],
    defaultType: "donut",
    description: "Praise / neutral / criticism statements about you",
    get: (b) => ({
      kind: "categories",
      items: [
        { label: "Praise", value: b.ai.sentimentMix.praise, isOwn: true },
        { label: "Neutral", value: b.ai.sentimentMix.neutral },
        { label: "Criticism", value: b.ai.sentimentMix.criticism },
      ],
      format: "number",
    }),
  },
};

export function resolveChart(metric: string, bundle: DataBundle | null, opts: { limit?: number } = {}): ChartData | null {
  const def = CHARTS[metric];
  if (!def || !bundle) return null;
  try {
    return def.get(bundle, opts);
  } catch {
    return null;
  }
}

export function chartIsEmpty(data: ChartData | null): boolean {
  if (!data) return true;
  if (data.kind === "series") return !data.x.length || data.series.every((s) => s.values.every((v) => v === null));
  return !data.items.length || data.items.every((i) => !i.value);
}

/* ───────────────────────────── Lists ───────────────────────────── */

export type ListRow = {
  label: string;
  sub?: string | null;
  value?: string | null;
  /** 0..1 for bar rendering */
  ratio?: number | null;
  highlight?: boolean;
  domain?: string | null;
};

export type ListDef = {
  label: string;
  category: string;
  description: string;
  empty: string;
  get: (b: DataBundle, limit: number) => ListRow[];
};

const ratioOf = (v: number | null | undefined, max: number) => (v === null || v === undefined || !max ? 0 : Math.max(0, Math.min(1, v / max)));

export const LISTS: Record<string, ListDef> = {
  "list.competitors": {
    label: "Top competitors",
    category: "Competitors",
    description: "Brands ranked by visibility (you included)",
    empty: "No competitor data yet",
    get: (b, limit) => {
      const rows = b.ai.brands.filter((r) => r.visibility !== null).slice(0, limit);
      const max = Math.max(1, ...rows.map((r) => r.visibility ?? 0));
      return rows.map((r) => ({
        label: r.name,
        sub: r.domain,
        value: formatValue(r.visibility, "percent"),
        ratio: ratioOf(r.visibility, max),
        highlight: r.isOwn,
        domain: r.domain,
      }));
    },
  },
  "list.rivals": {
    label: "Competitors only",
    category: "Competitors",
    description: "Competitors ranked by visibility (without you)",
    empty: "No competitor data yet",
    get: (b, limit) => {
      const rows = rivals(b).filter((r) => r.visibility !== null).slice(0, limit);
      const max = Math.max(1, ...rows.map((r) => r.visibility ?? 0));
      return rows.map((r) => ({ label: r.name, sub: r.domain, value: formatValue(r.visibility, "percent"), ratio: ratioOf(r.visibility, max), domain: r.domain }));
    },
  },
  "list.sources": {
    label: "Top sources",
    category: "Citations",
    description: "Most cited domains",
    empty: "No citations yet",
    get: (b, limit) => {
      const rows = b.ai.sources.slice(0, limit);
      const max = Math.max(1, ...rows.map((r) => r.citations));
      return rows.map((r) => ({
        label: r.domain,
        sub: r.contentType,
        value: `${formatValue(r.citations, "number")}×`,
        ratio: ratioOf(r.citations, max),
        highlight: r.ownership === "own",
        domain: r.domain,
      }));
    },
  },
  "list.own_pages": {
    label: "Your cited pages",
    category: "Citations",
    description: "Own URLs cited by AI engines",
    empty: "None of your pages were cited yet",
    get: (b, limit) => {
      const rows = b.ai.ownPages.slice(0, limit);
      const max = Math.max(1, ...rows.map((r) => r.citations));
      return rows.map((r) => ({
        label: r.title || r.url.replace(/^https?:\/\/(www\.)?/, ""),
        sub: r.url.replace(/^https?:\/\/(www\.)?/, ""),
        value: `${r.citations}×`,
        ratio: ratioOf(r.citations, max),
      }));
    },
  },
  "list.top_prompts": {
    label: "Top prompts",
    category: "Prompts",
    description: "Prompts where you are most visible",
    empty: "No prompt results yet",
    get: (b, limit) =>
      [...b.ai.prompts]
        .filter((p) => p.visibility !== null && (p.visibility ?? 0) > 0)
        .sort((x, y) => (y.visibility ?? 0) - (x.visibility ?? 0))
        .slice(0, limit)
        .map((p) => ({ label: p.text, sub: p.topic, value: formatValue(p.visibility, "percent"), ratio: (p.visibility ?? 0) / 100 })),
  },
  "list.gap_prompts": {
    label: "Prompt gaps",
    category: "Prompts",
    description: "Prompts where AI never mentions or cites you",
    empty: "No gaps — you are visible on every prompt",
    get: (b, limit) =>
      b.ai.prompts
        .filter((p) => p.category === "none")
        .slice(0, limit)
        .map((p) => ({ label: p.text, sub: p.topic, value: "0%", ratio: 0 })),
  },
  "list.engines": {
    label: "AI engines",
    category: "AI Visibility",
    description: "Visibility per engine",
    empty: "No engine data yet",
    get: (b, limit) =>
      b.ai.engines.slice(0, limit).map((e) => ({ label: e.label, sub: `${e.answers} answers`, value: formatValue(e.visibility, "percent"), ratio: (e.visibility ?? 0) / 100 })),
  },
  "list.topics": {
    label: "Topics",
    category: "Prompts",
    description: "Visibility per topic",
    empty: "No topics yet",
    get: (b, limit) =>
      b.ai.topics.slice(0, limit).map((t) => ({ label: t.topic, sub: `${t.prompts} prompts`, value: formatValue(t.visibility, "percent"), ratio: (t.visibility ?? 0) / 100 })),
  },
  "list.praise": {
    label: "What AI praises",
    category: "Sentiment",
    description: "Positive statements about your brand",
    empty: "No praise extracted yet",
    get: (b, limit) => b.ai.praise.slice(0, limit).map((s) => ({ label: s.quote, sub: s.attribute ?? s.theme })),
  },
  "list.criticism": {
    label: "What AI criticises",
    category: "Sentiment",
    description: "Negative statements about your brand",
    empty: "No criticism extracted yet",
    get: (b, limit) => b.ai.criticism.slice(0, limit).map((s) => ({ label: s.quote, sub: s.attribute ?? s.theme })),
  },
  "list.fanouts": {
    label: "Query fan-outs",
    category: "Prompts",
    description: "Searches AI engines ran while answering",
    empty: "No fan-out queries yet",
    get: (b, limit) => {
      const rows = b.ai.fanouts.slice(0, limit);
      const max = Math.max(1, ...rows.map((r) => r.count));
      return rows.map((r) => ({ label: r.query, value: `${r.count}×`, ratio: ratioOf(r.count, max) }));
    },
  },
  "list.tasks": {
    label: "Open tasks",
    category: "Tasks",
    description: "Highest-priority optimization tasks",
    empty: "No open tasks",
    get: (b, limit) =>
      (b.other.tasks ?? []).slice(0, limit).map((t) => ({
        label: t.title,
        sub: t.category.replace(/_/g, " "),
        value: t.impact >= 7 ? "High impact" : t.impact >= 4 ? "Medium" : "Low",
        ratio: t.impact / 10,
      })),
  },
};

export function resolveList(source: string, bundle: DataBundle | null, limit: number): { rows: ListRow[]; empty: string } {
  const def = LISTS[source];
  if (!def) return { rows: [], empty: "Unknown list" };
  if (!bundle) return { rows: [], empty: "Loading…" };
  try {
    return { rows: def.get(bundle, limit), empty: def.empty };
  } catch {
    return { rows: [], empty: def.empty };
  }
}

/* ───────────────────────────── Live tables ───────────────────────────── */

export type TableDef = {
  label: string;
  columns: string[];
  align: ("left" | "right")[];
  get: (b: DataBundle, limit: number) => { cells: string[]; highlight?: boolean }[];
};

export const TABLES: Record<string, TableDef> = {
  "table.competitors": {
    label: "Competitor benchmark",
    columns: ["Brand", "Visibility", "Mention rate", "Position", "Sentiment"],
    align: ["left", "right", "right", "right", "right"],
    get: (b, limit) =>
      b.ai.brands.slice(0, limit).map((r) => ({
        cells: [
          r.name,
          formatValue(r.visibility, "percent"),
          formatValue(r.mentionRate, "percent"),
          formatValue(r.avgPosition, "position"),
          formatValue(r.sentiment, "score"),
        ],
        highlight: r.isOwn,
      })),
  },
  "table.engines": {
    label: "Engine breakdown",
    columns: ["Engine", "Answers", "Visibility", "Mention rate", "Citation rate"],
    align: ["left", "right", "right", "right", "right"],
    get: (b, limit) =>
      b.ai.engines.slice(0, limit).map((e) => ({
        cells: [e.label, formatValue(e.answers, "number"), formatValue(e.visibility, "percent"), formatValue(e.mentionRate, "percent"), formatValue(e.citationRate, "percent")],
      })),
  },
  "table.prompts": {
    label: "Prompt performance",
    columns: ["Prompt", "Visibility", "Mention rate", "Citation rate"],
    align: ["left", "right", "right", "right"],
    get: (b, limit) =>
      [...b.ai.prompts]
        .sort((x, y) => (y.visibility ?? -1) - (x.visibility ?? -1))
        .slice(0, limit)
        .map((p) => ({
          cells: [p.text, formatValue(p.visibility, "percent"), formatValue(p.mentionRate, "percent"), formatValue(p.citationRate, "percent")],
        })),
  },
  "table.sources": {
    label: "Source analysis",
    columns: ["Source", "Type", "Citations", "Prompts"],
    align: ["left", "left", "right", "right"],
    get: (b, limit) =>
      b.ai.sources.slice(0, limit).map((s) => ({
        cells: [s.domain, s.contentType, formatValue(s.citations, "number"), formatValue(s.prompts, "number")],
        highlight: s.ownership === "own",
      })),
  },
  "table.tasks": {
    label: "Action plan",
    columns: ["Task", "Category", "Impact", "Effort"],
    align: ["left", "left", "right", "right"],
    get: (b, limit) =>
      (b.other.tasks ?? []).slice(0, limit).map((t) => ({
        cells: [t.title, t.category.replace(/_/g, " "), `${t.impact}/10`, `${t.effort}/10`],
      })),
  },
};

/** Replaces {{token}} placeholders in a plain string. */
export function interpolate(text: string, ctx: ResolveCtx): string {
  return text.replace(/\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}/g, (_m, key: string) => resolveToken(key, ctx).text);
}

export const TOKEN_CATEGORIES = ["General", "AI Visibility", "Competitors", "Citations", "Prompts", "Sentiment", "SEO & Traffic", "Tasks"];

/* ───────────────────────────── Pre-resolved data (public shares) ───────────────────────────── */

export type ResolvedData = {
  tokens: Record<string, { value: string | number | null; text: string }>;
  charts: Record<string, ChartData | null>;
  lists: Record<string, { rows: ListRow[]; empty: string }>;
  tables: Record<string, { cells: string[]; highlight?: boolean }[]>;
  images: { agencyLogo: string | null; clientLogo: string | null };
  meta: { clientName: string; periodLabel: string };
};

const chartKey = (metric: string, limit?: number) => `${metric}|${limit ?? ""}`;
const listKey = (source: string, limit: number) => `${source}|${limit}`;

/** True when the context can resolve data (bundle or pre-resolved map). */
export function hasData(ctx: ResolveCtx): boolean {
  return !!(ctx.bundle || ctx.resolved);
}

export function chartFor(ctx: ResolveCtx, metric: string, opts: { limit?: number } = {}): ChartData | null {
  if (ctx.resolved) return ctx.resolved.charts[chartKey(metric, opts.limit)] ?? null;
  return resolveChart(metric, ctx.bundle, opts);
}

export function listFor(ctx: ResolveCtx, source: string, limit: number): { rows: ListRow[]; empty: string } {
  if (ctx.resolved) return ctx.resolved.lists[listKey(source, limit)] ?? { rows: [], empty: LISTS[source]?.empty ?? "" };
  return resolveList(source, ctx.bundle, limit);
}

export function tableFor(ctx: ResolveCtx, source: string, limit: number): { cells: string[]; highlight?: boolean }[] {
  if (ctx.resolved) return ctx.resolved.tables[listKey(source, limit)] ?? [];
  const def = TABLES[source];
  if (!def || !ctx.bundle) return [];
  try {
    return def.get(ctx.bundle, limit);
  } catch {
    return [];
  }
}

export function logoFor(ctx: ResolveCtx, token: "agency.logo" | "client.logo"): string | null {
  if (ctx.resolved) return token === "agency.logo" ? ctx.resolved.images.agencyLogo : ctx.resolved.images.clientLogo;
  return (token === "agency.logo" ? ctx.bundle?.agency.logo : ctx.bundle?.project.clientLogo) ?? null;
}

type DeckLike = {
  slides: {
    notes?: string;
    background: { image?: { kind: string; token?: string } };
    elements: import("./types").SlideElement[];
  }[];
};

const TOKEN_RE = /\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}/g;

/**
 * Resolves exactly the values a deck references (tokens, chart/list/table bindings, logos) so a
 * public share page can render without receiving the project's full data bundle.
 */
export function resolveDeckData(deck: DeckLike, ctx: ResolveCtx): ResolvedData {
  const tokens = new Set<string>(["client.name", "report.period"]);
  const charts = new Map<string, { metric: string; limit?: number }>();
  const lists = new Map<string, { source: string; limit: number }>();
  const tables = new Map<string, { source: string; limit: number }>();
  const addText = (text: string | undefined) => {
    for (const m of (text ?? "").matchAll(TOKEN_RE)) tokens.add(m[1]!);
  };
  for (const slide of deck.slides) {
    addText(slide.notes);
    for (const el of slide.elements) {
      switch (el.type) {
        case "text":
          for (const p of el.paragraphs) for (const r of p.runs) if (r.token) tokens.add(r.token);
          break;
        case "kpi":
          tokens.add(el.metric);
          if (el.deltaMetric) tokens.add(el.deltaMetric);
          addText(el.label);
          if (el.sparkline) charts.set(chartKey(el.sparkline), { metric: el.sparkline });
          break;
        case "score":
          tokens.add(el.metric);
          addText(el.label);
          break;
        case "chart":
          charts.set(chartKey(el.metric, el.options.limit), { metric: el.metric, limit: el.options.limit });
          break;
        case "list":
          lists.set(listKey(el.source, el.limit), { source: el.source, limit: el.limit });
          break;
        case "table":
          if (el.mode === "live" && el.source) tables.set(listKey(el.source, el.limit), { source: el.source, limit: el.limit });
          else for (const row of el.rows) for (const cell of row) addText(cell);
          break;
      }
    }
  }
  const out: ResolvedData = {
    tokens: {},
    charts: {},
    lists: {},
    tables: {},
    images: { agencyLogo: logoFor({ ...ctx, resolved: null }, "agency.logo"), clientLogo: logoFor({ ...ctx, resolved: null }, "client.logo") },
    meta: { clientName: ctx.bundle?.project.clientName ?? "", periodLabel: ctx.bundle?.period.label ?? "" },
  };
  const base: ResolveCtx = { ...ctx, resolved: null };
  for (const key of tokens) {
    if (!TOKENS[key]) continue;
    const r = resolveToken(key, base);
    out.tokens[key] = { value: r.value, text: r.text };
  }
  for (const [k, c] of charts) out.charts[k] = resolveChart(c.metric, ctx.bundle, { limit: c.limit });
  for (const [k, l] of lists) out.lists[k] = resolveList(l.source, ctx.bundle, l.limit);
  for (const [k, t] of tables) out.tables[k] = tableFor(base, t.source, t.limit);
  return out;
}
