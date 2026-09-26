/**
 * Pure builders for the "AI Model → Page → Outcome" flow and page-intent classification.
 * No server-only / alias imports (unit-tested with vitest).
 */
import { getAiPlatform } from "../ai-platforms";

export type PageIntent = "product" | "pricing" | "blog" | "comparison" | "support" | "home" | "other";

export const PAGE_INTENTS: { key: PageIntent; label: string; color: string }[] = [
  { key: "product", label: "Product / Transactional", color: "var(--chart-2)" },
  { key: "pricing", label: "Pricing", color: "var(--chart-6)" },
  { key: "blog", label: "Blog / Informational", color: "var(--chart-3)" },
  { key: "comparison", label: "Comparison", color: "var(--chart-4)" },
  { key: "support", label: "Support / Docs", color: "var(--chart-7)" },
  { key: "home", label: "Home / Brand", color: "var(--chart-1)" },
  { key: "other", label: "Other", color: "var(--chart-8)" },
];

const INTENT_LABEL = new Map(PAGE_INTENTS.map((i) => [i.key, i]));

const RULES: { intent: PageIntent; re: RegExp }[] = [
  { intent: "comparison", re: /(^|[/_-])(vs|versus|compare|comparison|vergleich|alternatives?|alternativen?|best|beste[nr]?|top)([/_-]|$)/ },
  { intent: "pricing", re: /(^|\/)(pricing|prices?|preise?|plans?|tarife?|kosten|abo|subscription)(\/|$|[?#.-])/ },
  { intent: "support", re: /(^|\/)(docs?|documentation|help|hilfe|support|faq|faqs|kb|knowledge-?base|manual|anleitung|service)(\/|$|[?#.-])/ },
  {
    intent: "blog",
    re: /(^|\/)(blog|news|magazin|magazine|ratgeber|guides?|articles?|artikel|wissen|learn|resources|insights|academy|stories|journal|posts?)(\/|$|[?#.-])/,
  },
  {
    intent: "product",
    re: /(^|\/)(products?|produkte?|shop|store|p|item|items|collections?|kategorie|categories|category|cart|checkout|buy|kaufen|warenkorb|solutions?|features?|l[oö]sungen|angebot|order|bestellen)(\/|$|[?#.-])/,
  },
  {
    intent: "home",
    re: /^\/(about|about-us|ueber-uns|uber-uns|company|unternehmen|team|contact|kontakt|impressum|imprint|careers|jobs|karriere)(\/|$)/,
  },
];

/** Heuristic page-type classification from a URL path (or full URL). */
export function classifyPageIntent(pageOrUrl: string): PageIntent {
  let path = pageOrUrl.trim().toLowerCase();
  path = path.replace(/^[a-z]+:\/\/[^/]+/, "");
  path = path.split(/[?#]/)[0] ?? "";
  if (!path.startsWith("/")) path = `/${path}`;
  // Home pages incl. language roots ("/", "/de", "/en-us/")
  if (/^\/([a-z]{2}(-[a-z]{2})?)?\/?$/.test(path)) return "home";
  const stripped = path.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/)/, "");
  for (const r of RULES) if (r.re.test(stripped)) return r.intent;
  return "other";
}

export function pageIntentLabel(intent: string): string {
  return INTENT_LABEL.get(intent as PageIntent)?.label ?? intent;
}

export type FlowMetric = "sessions" | "conversions" | "conversion_rate" | "intent";

export type FlowInputRow = {
  platform: string;
  page: string;
  sessions: number;
  engagedSessions: number;
  convertedSessions: number;
  conversions: number;
  revenue: number;
};

export type FlowNode = { id: string; label: string; color?: string };
export type FlowLink = { source: string; target: string; value: number };

export type FlowResult = {
  nodes: FlowNode[];
  links: FlowLink[];
  totals: { sessions: number; conversions: number; convertedSessions: number; revenue: number };
  /** Number of distinct middle-column entries before grouping into "Other pages". */
  middleCount: number;
  valueFormat: "number";
};

const OUTCOMES = {
  converted: { label: "Converted", color: "var(--chart-2)" },
  engaged: { label: "Engaged", color: "var(--chart-3)" },
  bounced: { label: "Bounced", color: "var(--chart-8)" },
  revenue: { label: "Revenue conversions", color: "var(--chart-2)" },
  other_conv: { label: "Other conversions", color: "var(--chart-6)" },
} as const;

const round = (n: number) => Math.round(n * 100) / 100;

/** Splits a row's sessions into converted / engaged / bounced so the parts always sum to `sessions`. */
export function splitOutcomes(r: Pick<FlowInputRow, "sessions" | "engagedSessions" | "convertedSessions">) {
  const s = Math.max(0, r.sessions);
  const c = Math.min(Math.max(0, r.convertedSessions), s);
  const engagedAll = Math.max(Math.min(Math.max(0, r.engagedSessions), s), c);
  return { converted: c, engaged: engagedAll - c, bounced: s - engagedAll };
}

/**
 * Builds the three-column flow. Link values are sessions (or conversions in "conversions" mode);
 * "conversion_rate" keeps session flows but picks/labels the pages with the best conversion rate;
 * "intent" groups pages into page-intent categories.
 */
export function buildTrafficFlow(
  input: FlowInputRow[],
  opts: { metric: FlowMetric; url?: string | null; maxPages?: number } = { metric: "sessions" },
): FlowResult {
  const maxPages = opts.maxPages ?? 8;
  const needle = opts.url?.trim().toLowerCase();
  const rows = needle ? input.filter((r) => r.page.toLowerCase().includes(needle)) : input;
  const totals = rows.reduce(
    (a, r) => ({
      sessions: a.sessions + r.sessions,
      conversions: a.conversions + r.conversions,
      convertedSessions: a.convertedSessions + r.convertedSessions,
      revenue: a.revenue + r.revenue,
    }),
    { sessions: 0, conversions: 0, convertedSessions: 0, revenue: 0 },
  );
  const value = (r: FlowInputRow) => (opts.metric === "conversions" ? r.conversions : r.sessions);
  const middleKey = (r: FlowInputRow) => (opts.metric === "intent" ? classifyPageIntent(r.page) : r.page || "(unknown page)");

  // Rank middle entries.
  const mid = new Map<string, { value: number; sessions: number; converted: number }>();
  for (const r of rows) {
    const k = middleKey(r);
    const m = mid.get(k) ?? { value: 0, sessions: 0, converted: 0 };
    m.value += value(r);
    m.sessions += r.sessions;
    m.converted += r.convertedSessions;
    mid.set(k, m);
  }
  let ranked = [...mid.entries()].filter(([, m]) => m.value > 0);
  if (opts.metric === "conversion_rate") {
    const minSessions = Math.max(3, totals.sessions * 0.01);
    ranked.sort((a, b) => {
      const ea = a[1].sessions >= minSessions ? 1 : 0;
      const eb = b[1].sessions >= minSessions ? 1 : 0;
      if (ea !== eb) return eb - ea;
      const ra = a[1].sessions ? a[1].converted / a[1].sessions : 0;
      const rb = b[1].sessions ? b[1].converted / b[1].sessions : 0;
      return rb - ra || b[1].sessions - a[1].sessions;
    });
  } else {
    ranked.sort((a, b) => b[1].value - a[1].value);
  }
  const middleCount = ranked.length;
  const limit = opts.metric === "intent" ? Infinity : maxPages;
  const keep = new Set(ranked.slice(0, limit).map(([k]) => k));
  ranked = ranked.filter(([k]) => keep.has(k));
  const OTHER = "__other__";

  const linkMap = new Map<string, number>();
  const add = (s: string, t: string, v: number) => {
    if (!(v > 0)) return;
    const key = `${s}\u0000${t}`;
    linkMap.set(key, (linkMap.get(key) ?? 0) + v);
  };
  for (const r of rows) {
    const k = middleKey(r);
    const m = keep.has(k) ? k : OTHER;
    const v = value(r);
    if (!(v > 0)) continue;
    add(`p:${r.platform}`, `m:${m}`, v);
    if (opts.metric === "conversions") {
      add(`m:${m}`, r.revenue > 0 ? "o:revenue" : "o:other_conv", v);
    } else {
      const o = splitOutcomes(r);
      add(`m:${m}`, "o:converted", o.converted);
      add(`m:${m}`, "o:engaged", o.engaged);
      add(`m:${m}`, "o:bounced", o.bounced);
    }
  }

  const links: FlowLink[] = [...linkMap.entries()]
    .map(([k, v]) => {
      const [source, target] = k.split("\u0000") as [string, string];
      return { source, target, value: round(v) };
    })
    .filter((l) => l.value > 0);
  const used = new Set(links.flatMap((l) => [l.source, l.target]));

  const nodes: FlowNode[] = [];
  const platforms = [...new Set(rows.map((r) => r.platform))];
  for (const p of platforms) {
    const id = `p:${p}`;
    if (!used.has(id)) continue;
    const info = getAiPlatform(p);
    nodes.push({ id, label: info?.name ?? p, color: info?.color });
  }
  for (const [k, m] of ranked) {
    const id = `m:${k}`;
    if (!used.has(id)) continue;
    const intent = opts.metric === "intent" ? PAGE_INTENTS.find((i) => i.key === k) : undefined;
    let label = intent ? intent.label : k;
    if (opts.metric === "conversion_rate" && m.sessions > 0) label = `${label} · ${((m.converted / m.sessions) * 100).toFixed(1)}%`;
    nodes.push({ id, label, color: intent?.color ?? "var(--chart-8)" });
  }
  if (used.has(`m:${OTHER}`)) nodes.push({ id: `m:${OTHER}`, label: "Other pages", color: "var(--muted-foreground)" });
  for (const [k, o] of Object.entries(OUTCOMES)) {
    const id = `o:${k}`;
    if (used.has(id)) nodes.push({ id, label: o.label, color: o.color });
  }
  return { nodes, links, totals, middleCount, valueFormat: "number" };
}
