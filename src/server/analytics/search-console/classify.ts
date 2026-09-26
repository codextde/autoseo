/**
 * Pure helpers for search-query classification (no server-only / alias imports so vitest can run them).
 *
 * - `isAiPrompt`: flags conversational / question-like / long queries (the kind of text people type
 *   into ChatGPT & co.) — finseo "AI Prompts" toggle.
 * - `classifyIntent`: Recommend / Information / Comparison / Action (finseo intent types).
 */

export type QueryIntent = "recommend" | "information" | "comparison" | "action";

export const QUERY_INTENTS: QueryIntent[] = ["recommend", "information", "comparison", "action"];

export const INTENT_LABELS: Record<QueryIntent, string> = {
  recommend: "Recommend",
  information: "Information",
  comparison: "Comparison",
  action: "Action",
};

export type WordBucket = "1-2" | "3-4" | "5-7" | "8+";
export const WORD_BUCKETS: WordBucket[] = ["1-2", "3-4", "5-7", "8+"];

/** Splits on whitespace; ignores punctuation-only tokens. */
export function wordCount(query: string): number {
  return query
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function wordBucket(count: number): WordBucket {
  if (count <= 2) return "1-2";
  if (count <= 4) return "3-4";
  if (count <= 7) return "5-7";
  return "8+";
}

export function matchesWordBucket(count: number, bucket: string | null | undefined): boolean {
  if (!bucket) return true;
  return wordBucket(count) === bucket;
}

function normalize(query: string): string {
  return ` ${query.toLowerCase().normalize("NFKC").replace(/[“”„"'’`´]/g, "").replace(/\s+/g, " ").trim()} `;
}

/** True when any phrase occurs as a whole word / phrase inside the normalized query. */
function hasAny(q: string, phrases: string[]): boolean {
  return phrases.some((p) => {
    const needle = ` ${p} `;
    if (q.includes(needle)) return true;
    // allow trailing punctuation (e.g. "vs." / "why?")
    return new RegExp(`\\s${escapeRe(p)}[?!.,:;]`, "u").test(q);
  });
}

function startsWithAny(q: string, phrases: string[]): boolean {
  const t = q.trimStart();
  return phrases.some((p) => t.startsWith(`${p} `) || t === p || t.startsWith(`${p}?`));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Question words that start conversational queries (EN, DE, FR, ES, IT, NL). */
const QUESTION_STARTERS = [
  // EN
  "how", "what", "why", "which", "who", "whom", "whose", "where", "when", "can", "could", "should", "would", "is", "are",
  "does", "do", "did", "will", "was", "were", "has", "have", "tell me", "explain", "give me", "help me", "recommend",
  "suggest", "list", "compare",
  // DE
  "wie", "was", "warum", "wieso", "weshalb", "welche", "welcher", "welches", "welchen", "wer", "wo", "wann", "woher",
  "wohin", "kann", "können", "könnte", "sollte", "soll", "ist", "sind", "gibt es", "lohnt sich", "brauche ich",
  "hilf mir", "erkläre", "empfiehl", "nenne",
  // FR
  "comment", "pourquoi", "quel", "quelle", "quels", "quelles", "qui", "où", "quand", "est-ce que", "est ce que", "peut-on",
  "combien", "faut-il",
  // ES
  "cómo", "como", "qué", "que", "por qué", "porque", "cuál", "cual", "cuáles", "quién", "dónde", "donde", "cuándo",
  "cuánto", "cuanto", "puedo", "debo", "es mejor",
  // IT
  "come", "perché", "perche", "quale", "quali", "chi", "dove", "quando", "quanto", "posso", "devo",
  // NL
  "hoe", "wat", "waarom", "welke", "wie", "waar", "wanneer", "kan", "moet", "is het",
];

/** Conversational fragments anywhere in the query. */
const CONVERSATIONAL = [
  "how to", "how do i", "how can i", "what is the best", "should i", "is it worth", "is it better", "do i need",
  "best way to", "difference between", "pros and cons", "for beginners", "step by step", "explain", "recommend",
  "alternatives to", "alternative to", "vs", "versus", "compared to", "better than",
  "wie kann ich", "was ist der beste", "was ist die beste", "lohnt sich", "unterschied zwischen", "vor- und nachteile",
  "vorteile und nachteile", "für anfänger", "schritt für schritt", "brauche ich", "sollte ich", "besser als",
  "im vergleich zu", "alternative zu", "alternativen zu", "was bringt",
  "comment faire", "quelle est la meilleure", "quel est le meilleur", "différence entre",
  "cómo hacer", "cuál es el mejor", "cuál es la mejor", "diferencia entre",
  "come fare", "qual è il migliore", "differenza tra",
  "hoe kan ik", "wat is de beste", "verschil tussen",
];

/**
 * Flags conversational / question-like / long queries. Heuristic, tuned to prefer precision on short
 * head terms ("running shoes" → false) and recall on natural-language questions.
 */
export function isAiPrompt(query: string): boolean {
  const raw = query.trim();
  if (!raw) return false;
  const words = wordCount(raw);
  if (words >= 6) return true;
  if (raw.includes("?")) return words >= 2;
  const q = normalize(raw);
  if (words >= 3 && startsWithAny(q, QUESTION_STARTERS)) return true;
  if (words >= 3 && hasAny(q, CONVERSATIONAL)) return true;
  // "best X for Y" / "beste X für Y"
  if (words >= 4 && /\s(best|beste[nrs]?|top|meilleur[es]?|mejor(es)?|migliori?)\s.+\s(for|für|pour|para|per|voor)\s/u.test(q)) return true;
  return false;
}

const COMPARISON = [
  "vs", "vs.", "versus", "compare", "compared", "comparison", "difference", "differences", "alternative", "alternatives",
  "or", "better than", "cheaper than",
  "vergleich", "vergleichen", "im vergleich", "unterschied", "unterschiede", "oder", "alternative zu", "besser als",
  "gegenüber",
  "comparaison", "comparer", "différence", "ou",
  "comparación", "comparar", "diferencia", "o",
  "confronto", "differenza",
  "vergelijken", "verschil", "of",
];

const RECOMMEND = [
  "best", "top", "recommend", "recommended", "recommendation", "recommendations", "which should", "should i buy",
  "worth it", "worth buying", "good", "ideal", "most popular", "top rated", "top-rated", "review", "reviews", "ranking",
  "beste", "besten", "bester", "bestes", "empfehlung", "empfehlungen", "empfehlenswert", "testsieger", "test", "welche soll",
  "lohnt sich", "gut", "gute", "guter", "erfahrungen", "bewertung",
  "meilleur", "meilleure", "meilleurs", "recommandé", "avis",
  "mejor", "mejores", "recomendado", "recomendación", "opiniones",
  "migliore", "migliori", "consigliato", "recensioni",
  "beste", "aanrader", "aanbevolen",
];

/** Strong transactional signals — always "action". */
const ACTION = [
  "buy", "purchase", "order", "price", "prices", "pricing", "cost", "costs", "cheap", "cheapest", "deal", "deals",
  "discount", "coupon", "promo", "sale", "shop", "store", "near me", "quote", "hire", "free trial",
  "kaufen", "bestellen", "preis", "preise", "kosten", "kostet", "günstig", "billig", "angebot", "angebote", "rabatt",
  "gutschein", "gutscheincode", "in der nähe", "online shop", "mieten",
  "acheter", "prix", "commander",
  "comprar", "precio", "precios",
  "comprare", "prezzo", "prezzi",
  "kopen", "prijs",
];

/** Task verbs — "action" unless the query is phrased as a question ("how do i install …" = information). */
const SOFT_ACTION = [
  "download", "install", "sign up", "signup", "register", "login", "log in", "subscribe", "book", "booking", "trial",
  "apply", "contact", "herunterladen", "installieren", "anmelden", "registrieren", "buchen", "abonnieren", "kontakt",
  "télécharger", "réserver", "descargar", "reservar", "scaricare", "prenotare", "downloaden", "boeken",
];

const HOW_WHAT = [
  "how", "what", "why", "when", "where", "wie", "was", "warum", "wieso", "wann", "wo", "comment", "pourquoi",
  "cómo", "como", "qué", "por qué", "come", "perché", "hoe", "wat", "waarom",
];

const INFORMATION = [
  "how", "what", "why", "when", "where", "who", "guide", "tutorial", "meaning", "definition", "explained", "examples",
  "wie", "was", "warum", "wieso", "anleitung", "bedeutung", "erklärung", "definition", "beispiel",
];

/** Recommend / Information / Comparison / Action (multilingual keyword heuristic). */
export function classifyIntent(query: string): QueryIntent {
  const q = normalize(query);
  const words = wordCount(query);
  // Comparison first: "a vs b", "a oder b" (only when both sides exist), "difference between"
  const hasVs = /\s(vs\.?|versus)\s/u.test(q);
  if (hasVs) return "comparison";
  const orLike = hasAny(q, ["or", "oder", "ou", "o", "of"]) && words >= 3 && !startsWithAny(q, ["or", "oder", "ou", "o", "of"]);
  const comparisonWords = hasAny(
    q,
    COMPARISON.filter((w) => !["or", "oder", "ou", "o", "of"].includes(w)),
  );
  if (comparisonWords || (orLike && !hasAny(q, ["how", "wie", "what", "was"]))) return "comparison";
  if (hasAny(q, ACTION)) return "action";
  if (hasAny(q, SOFT_ACTION) && !startsWithAny(q, HOW_WHAT)) return "action";
  if (hasAny(q, RECOMMEND) || /\s(which|welche[rsn]?)\s.+\s(should|soll(te)?|best|beste)/u.test(q)) return "recommend";
  if (hasAny(q, INFORMATION)) return "information";
  return "information";
}

/** Tokens that can start a spreadsheet formula; prefixed with a quote on export (CSV injection). */
export function sanitizeForSpreadsheet(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** RFC 4180 CSV line. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = cell == null ? "" : sanitizeForSpreadsheet(String(cell));
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}

export type PagePosRow = { query: string; page: string; impressions: number; clicks: number; position: number | null };

/**
 * open-seo `buildStrikingDistanceRows`: collapse query×page rows to each query's best page (lowest
 * position; ties → more impressions); keep best position ∈ [5, 20]; sort by impressions desc; limit.
 */
export function buildStrikingDistanceRows(rows: PagePosRow[], limit = 100): PagePosRow[] {
  const best = new Map<string, PagePosRow>();
  for (const r of rows) {
    if (!r.query || r.position == null) continue;
    const cur = best.get(r.query);
    if (!cur || r.position! < cur.position! || (r.position === cur.position && r.impressions > cur.impressions)) best.set(r.query, r);
  }
  return [...best.values()]
    .filter((r) => r.position! >= 5 && r.position! <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

/**
 * open-seo `normalizePageKey`: trim; reject empty/"(not set)"; parse as URL (prefix https:// when no
 * scheme); lower-case host; keep non-default port; path default "/", strip trailing slashes except root;
 * ignore scheme, query, fragment; keep path case and subdomains.
 */
export function normalizePageKey(input: string | null | undefined): string | null {
  const v = (input ?? "").trim();
  if (!v || v === "(not set)") return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v.replace(/^\/+/, "")}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!host) return null;
  const port = url.port && !["80", "443"].includes(url.port) ? `:${url.port}` : "";
  let path = url.pathname || "/";
  if (path.length > 1) path = path.replace(/\/+$/, "") || "/";
  return `${host}${port}${path}`;
}

/** Percentile rank per open-seo: count(values < v) / (n − 1); single value → 1; ties share rank. */
export function percentileRanks(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const sorted = [...values].sort((a, b) => a - b);
  const lessThan = (v: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return values.map((v) => lessThan(v) / (n - 1));
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export type OpportunityInput = {
  impressions: number;
  position: number;
  sessionKeyEventRate: number | null;
  engagementRate: number | null;
  keyEvents: number | null;
};

export type OpportunityScore = {
  score: number;
  components: { demand: number; businessValue: number; reachability: number };
};

/** open-seo search-opportunity scoring over joined rows (0.5 demand + 0.3 business value + 0.2 reachability). */
export function scoreOpportunities(rows: OpportunityInput[]): { scores: OpportunityScore[]; engagementFallback: boolean } {
  const engagementFallback = rows.length > 0 && rows.every((r) => !r.keyEvents);
  const demand = percentileRanks(rows.map((r) => Math.log1p(Math.max(0, r.impressions))));
  const business = percentileRanks(
    rows.map((r) => (engagementFallback ? (r.engagementRate ?? 0) : (r.sessionKeyEventRate ?? 0))),
  );
  const reach = percentileRanks(rows.map((r) => 20 - r.position));
  const scores = rows.map((_, i) => {
    const components = { demand: round4(demand[i]!), businessValue: round4(business[i]!), reachability: round4(reach[i]!) };
    return {
      score: Math.round(100 * (0.5 * components.demand + 0.3 * components.businessValue + 0.2 * components.reachability)),
      components,
    };
  });
  return { scores, engagementFallback };
}
