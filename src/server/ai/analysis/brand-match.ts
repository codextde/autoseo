/**
 * Deterministic brand matching for AI answers (no LLM involved).
 *
 * - Case-, diacritics- and ß/ss-insensitive, Unicode word-boundary aware ("Anker" does not match
 *   "Ankerplatz", "C++" and "AT&T" style names work).
 * - URL targets (markdown link targets and bare http(s) URLs) are masked so a citation link does
 *   not count as a mention.
 * - Overlapping matches are resolved longest-first, so "Anker SOLIX" (alias of one brand) wins over
 *   "Anker" (another brand) at the same position.
 *
 * Pure module (no server imports) so it can be unit tested.
 */

export type BrandDef = {
  /** Stable key: "own" or the competitor id, or "x:<name>" for untracked brands. */
  key: string;
  name: string;
  /** Names / aliases / domains that count as a mention of the brand. */
  terms: string[];
  /** Domains whose citations count as "cited" for the brand. */
  domains: string[];
  isOwn: boolean;
  competitorId: string | null;
};

export type BrandHit = {
  key: string;
  name: string;
  isOwn: boolean;
  competitorId: string | null;
  /** Offset (in the original text) of the first mention. */
  charOffset: number;
  /** charOffset ÷ text length × 100 (0 = very top of the answer). */
  depthPct: number;
  occurrences: number;
  /** Ordinal position among all brands named (1 = named first). Filled by `assignPositions`. */
  position: number;
  snippet: string;
  cited: boolean;
};

type Normalized = { text: string; map: number[] };

const COMBINING = /\p{M}/gu;

function normalizeChar(ch: string): string {
  if (ch === "ß" || ch === "ẞ") return "ss";
  if (ch === "’" || ch === "‘" || ch === "`" || ch === "´") return "'";
  if (ch === "–" || ch === "—" || ch === "‑") return "-";
  if (ch === " ") return " ";
  return ch.normalize("NFD").replace(COMBINING, "").toLowerCase();
}

/** Lowercases, strips diacritics and keeps an index map back to the original string. */
export function normalizeForMatch(input: string): Normalized {
  let text = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of input) {
    const n = normalizeChar(ch);
    for (let k = 0; k < n.length; k++) {
      text += n[k];
      map.push(i);
    }
    i += ch.length;
  }
  map.push(i);
  return { text, map };
}

/** Plain normalized form of a term/name (for comparisons and dictionary keys). */
export function normalizeName(input: string): string {
  return normalizeForMatch(input.trim()).text.replace(/\s+/g, " ");
}

/** Replaces URL targets with spaces (same length, so offsets stay valid). */
export function maskUrls(text: string): string {
  const blank = (s: string) => " ".repeat(s.length);
  return text
    .replace(/\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (m) => `](${blank(m.slice(2, -1))})`)
    .replace(/<https?:\/\/[^>\s]+>/gi, blank)
    .replace(/https?:\/\/[^\s)<>\]"']+/gi, blank);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Builds a boundary-aware regex source for a normalized term; spaces/hyphens are interchangeable. */
function termPattern(term: string): string | null {
  const t = normalizeName(term);
  if (t.length < 2) return null;
  const tokens = t.split(/[\s-]+/).filter(Boolean).map(escapeRegex);
  if (!tokens.length) return null;
  return tokens.join("[\\s-]*");
}

const BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}_])";
const BOUNDARY_AFTER = "(?![\\p{L}\\p{N}_])";

type RawMatch = { key: string; start: number; end: number };

function brandRegex(brand: BrandDef): RegExp | null {
  const patterns = [...new Set(brand.terms.map(termPattern).filter((p): p is string => !!p))].sort((a, b) => b.length - a.length);
  if (!patterns.length) return null;
  return new RegExp(`${BOUNDARY_BEFORE}(?:${patterns.join("|")})${BOUNDARY_AFTER}`, "gu");
}

/** All non-overlapping matches (longest match wins on overlap). */
function findMatches(norm: string, brands: BrandDef[]): RawMatch[] {
  const all: RawMatch[] = [];
  for (const b of brands) {
    const re = brandRegex(b);
    if (!re) continue;
    for (const m of norm.matchAll(re)) {
      if (m.index === undefined || !m[0].length) continue;
      all.push({ key: b.key, start: m.index, end: m.index + m[0].length });
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: RawMatch[] = [];
  let cursor = -1;
  for (const m of all) {
    if (m.start < cursor) continue;
    kept.push(m);
    cursor = m.end;
  }
  return kept;
}

/** Cleans a sentence for display: strips markdown decoration and collapses whitespace. */
function cleanSnippet(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentence (≤ 280 chars) around an offset in the original text. */
export function snippetAt(text: string, offset: number, max = 280): string {
  const stops = /[.!?\n]/;
  let start = offset;
  while (start > 0 && offset - start < max / 2 && !stops.test(text[start - 1]!)) start--;
  let end = offset;
  while (end < text.length && end - offset < max && !stops.test(text[end]!)) end++;
  if (end < text.length && text[end] !== "\n") end++;
  const raw = cleanSnippet(text.slice(start, end));
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}

export function domainMatches(domain: string, brandDomain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  const b = brandDomain.toLowerCase().replace(/^www\./, "");
  if (!d || !b) return false;
  return d === b || d.endsWith(`.${b}`);
}

/**
 * Finds every brand named in `text`. Returns hits ordered by first mention with ordinal
 * positions assigned (1 = named first). `citedDomains` marks brands whose domain was cited.
 */
export function matchBrands(text: string, brands: BrandDef[], citedDomains: string[] = []): BrandHit[] {
  const masked = maskUrls(text);
  const { text: norm, map } = normalizeForMatch(masked);
  const matches = findMatches(norm, brands);
  const byKey = new Map<string, { first: number; count: number }>();
  for (const m of matches) {
    const cur = byKey.get(m.key);
    if (cur) cur.count++;
    else byKey.set(m.key, { first: map[m.start] ?? 0, count: 1 });
  }
  const len = Math.max(1, text.length);
  const hits: BrandHit[] = [];
  for (const b of brands) {
    const m = byKey.get(b.key);
    if (!m) continue;
    hits.push({
      key: b.key,
      name: b.name,
      isOwn: b.isOwn,
      competitorId: b.competitorId,
      charOffset: m.first,
      depthPct: Math.round((m.first / len) * 1000) / 10,
      occurrences: m.count,
      position: 0,
      snippet: snippetAt(text, m.first),
      cited: citedDomains.some((d) => b.domains.some((bd) => domainMatches(d, bd))),
    });
  }
  return assignPositions(hits);
}

/** Sorts hits by first mention and assigns ordinal positions. */
export function assignPositions(hits: BrandHit[]): BrandHit[] {
  const sorted = [...hits].sort((a, b) => a.charOffset - b.charOffset || a.name.localeCompare(b.name));
  sorted.forEach((h, i) => (h.position = i + 1));
  return sorted;
}

/** Resolves a free-text brand name (e.g. from the LLM pass) to a known brand definition. */
export function resolveBrand(name: string, brands: BrandDef[]): BrandDef | null {
  const n = normalizeName(name);
  if (!n) return null;
  for (const b of brands) {
    if (normalizeName(b.name) === n) return b;
  }
  for (const b of brands) {
    if (b.terms.some((t) => normalizeName(t) === n)) return b;
  }
  // Loose: the LLM wrote "Solakon GmbH" or "Anker SOLIX 2" — a known term as a whole word inside it.
  for (const b of brands) {
    const re = brandRegex(b);
    if (re && re.test(n)) return b;
  }
  return null;
}

/** Terms that should count for the own brand (name, aliases, domains, domain stem). */
export function ownBrandTerms(project: { name: string; domain: string; brand?: { aliases?: string[]; domains?: string[] } | null }): string[] {
  const terms = new Set<string>();
  const add = (t: string | null | undefined) => {
    const v = t?.trim();
    if (v && v.length >= 2) terms.add(v);
  };
  add(project.name);
  for (const a of project.brand?.aliases ?? []) add(a);
  for (const d of [project.domain, ...(project.brand?.domains ?? [])]) add(d);
  return [...terms];
}
