/**
 * AEO (answer-engine optimization) score — pure & isomorphic so the editor can rescore live in
 * the browser while the server uses the exact same function for stored scores and URL audits.
 *
 * Six pillars (0–100 each), weighted into a 0–100 total:
 *   Extractability 20 · Fact density 20 · Structure 15 · Schema markup 15 · Depth 15 · Metadata 15
 * Bands: 87+ "Primary Source" · 70–86 "Strong" · 50–69 "Needs work" · <50 "Weak".
 */

export const AEO_PILLARS = [
  { key: "extractability", label: "Extractability", weight: 20, hint: "Can an AI lift a direct, self-contained answer?" },
  { key: "factDensity", label: "Fact density", weight: 20, hint: "Specific numbers, named entities and cited sources." },
  { key: "structure", label: "Structure", weight: 15, hint: "Clear heading hierarchy, lists and tables." },
  { key: "schema", label: "Schema markup", weight: 15, hint: "Valid JSON-LD (Article, FAQPage, HowTo…)." },
  { key: "depth", label: "Depth", weight: 15, hint: "Coverage of the topic, sub-questions and FAQs." },
  { key: "metadata", label: "Metadata", weight: 15, hint: "Meta title, description and slug aligned with the target." },
] as const;

export type AeoPillarKey = (typeof AEO_PILLARS)[number]["key"];

export type AeoInput = {
  title?: string | null;
  body: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  slug?: string | null;
  schemaJsonLd?: string | null;
  faqs?: Array<{ question: string; answer: string }> | null;
  targetKeyword?: string | null;
  targetPrompt?: string | null;
  entities?: Array<{ name: string }> | null;
  citations?: Array<{ url: string }> | null;
};

export type AeoSuggestion = {
  pillar: AeoPillarKey;
  /** Points of the total score this fix is worth (approx.) */
  impact: number;
  message: string;
};

export type AeoStats = {
  wordCount: number;
  readingMinutes: number;
  paragraphs: number;
  avgParagraphWords: number;
  headings: number;
  h2: number;
  h3: number;
  questionHeadings: number;
  lists: number;
  tables: number;
  numbers: number;
  externalLinks: number;
  citations: number;
  faqs: number;
  entities: number;
};

export type AeoOutlineItem = { level: number; text: string; line: number };

export type AeoResult = {
  score: number;
  band: AeoBand;
  pillars: Record<AeoPillarKey, number>;
  suggestions: AeoSuggestion[];
  stats: AeoStats;
  outline: AeoOutlineItem[];
};

export type AeoBand = { key: "primary" | "strong" | "needs_work" | "weak"; label: string };

export function aeoBand(score: number): AeoBand {
  if (score >= 87) return { key: "primary", label: "Primary Source" };
  if (score >= 70) return { key: "strong", label: "Strong" };
  if (score >= 50) return { key: "needs_work", label: "Needs work" };
  return { key: "weak", label: "Weak" };
}

/* ───────────────────────────── Markdown analysis ───────────────────────────── */

type Block =
  | { type: "heading"; level: number; text: string; line: number }
  | { type: "paragraph"; text: string; words: number }
  | { type: "list"; items: number; ordered: boolean }
  | { type: "table"; rows: number }
  | { type: "quote"; text: string }
  | { type: "code" };

const QUESTION_START =
  /^(how|what|why|which|when|where|who|can|is|are|does|do|should|will|best|top|vs\b|wie|was|warum|welche[rsn]?|wann|wo|wer|kann|ist|sind|lohnt|gibt|brauche|muss|comment|pourquoi|quel|qué|cómo|por qué)\b/i;

function stripInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_~]+/g, "")
    .trim();
}

function countWords(s: string): number {
  const m = stripInline(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’\-.,%€$]*/gu);
  return m ? m.length : 0;
}

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      const text = para.join(" ").trim();
      if (text) blocks.push({ type: "paragraph", text, words: countWords(text) });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      flush();
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!.trim())) i++;
      blocks.push({ type: "code" });
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    const h = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (h) {
      flush();
      blocks.push({ type: "heading", level: h[1]!.length, text: stripInline(h[2]!), line: i });
      continue;
    }
    if (/^\|.*\|$/.test(trimmed)) {
      flush();
      let rows = 0;
      while (i < lines.length && /^\|.*\|$/.test(lines[i]!.trim())) {
        if (!/^\|[\s:|-]+\|$/.test(lines[i]!.trim())) rows++;
        i++;
      }
      i--;
      blocks.push({ type: "table", rows });
      continue;
    }
    const li = trimmed.match(/^([-*+]|\d+[.)])\s+/);
    if (li) {
      flush();
      const ordered = /\d/.test(li[1]!);
      let items = 0;
      while (i < lines.length) {
        const t = lines[i]!.trim();
        if (/^([-*+]|\d+[.)])\s+/.test(t)) items++;
        else if (!t || !/^\s{2,}/.test(lines[i]!)) break;
        i++;
      }
      i--;
      blocks.push({ type: "list", items, ordered });
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      flush();
      const parts: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!.trim())) {
        parts.push(lines[i]!.trim().replace(/^>\s?/, ""));
        i++;
      }
      i--;
      blocks.push({ type: "quote", text: parts.join(" ") });
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return blocks;
}

export function extractOutline(md: string): AeoOutlineItem[] {
  return parseBlocks(md)
    .filter((b): b is Extract<Block, { type: "heading" }> => b.type === "heading")
    .map((b) => ({ level: b.level, text: b.text, line: b.line }));
}

function tokens(s: string | null | undefined): string[] {
  const STOP = new Set([
    "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "is", "are", "what", "how", "best", "with", "vs",
    "der", "die", "das", "und", "oder", "für", "von", "zu", "im", "in", "ist", "sind", "was", "wie", "ein", "eine", "mit",
  ]);
  return (s ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function coverage(text: string, target: string[]): number {
  if (!target.length) return 0;
  const hay = text.toLowerCase();
  return target.filter((t) => hay.includes(t)).length / target.length;
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const ramp = (value: number, full: number) => (full <= 0 ? 1 : Math.max(0, Math.min(1, value / full)));

type SchemaInfo = { valid: boolean; types: Set<string>; hasHeadline: boolean; hasAuthor: boolean; hasDate: boolean; faqCount: number; hasPublisher: boolean; hasAbout: boolean };

function analyzeSchema(raw: string | null | undefined): SchemaInfo {
  const info: SchemaInfo = { valid: false, types: new Set(), hasHeadline: false, hasAuthor: false, hasDate: false, faqCount: 0, hasPublisher: false, hasAbout: false };
  if (!raw || !raw.trim()) return info;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return info;
  }
  info.valid = true;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const t = o["@type"];
    for (const type of Array.isArray(t) ? t : t ? [t] : []) info.types.add(String(type));
    if (o.headline || o.name) info.hasHeadline = true;
    if (o.author) info.hasAuthor = true;
    if (o.datePublished || o.dateModified) info.hasDate = true;
    if (o.publisher) info.hasPublisher = true;
    if (o.about || o.mentions) info.hasAbout = true;
    if (Array.isArray(o.mainEntity) && (t === "FAQPage" || (Array.isArray(t) && t.includes("FAQPage")))) info.faqCount += o.mainEntity.length;
    for (const [k, v] of Object.entries(o)) if (k !== "@context" && typeof v === "object") visit(v);
  };
  visit(parsed);
  return info;
}

/* ───────────────────────────── Scoring ───────────────────────────── */

export function scoreContent(input: AeoInput): AeoResult {
  const body = input.body ?? "";
  const blocks = parseBlocks(body);
  const headings = blocks.filter((b): b is Extract<Block, { type: "heading" }> => b.type === "heading");
  const paragraphs = blocks.filter((b): b is Extract<Block, { type: "paragraph" }> => b.type === "paragraph");
  const lists = blocks.filter((b) => b.type === "list");
  const tables = blocks.filter((b) => b.type === "table");
  const quotes = blocks.filter((b) => b.type === "quote");
  const faqs = (input.faqs ?? []).filter((f) => f.question?.trim() && f.answer?.trim());

  const plain = stripInline(body.replace(/```[\s\S]*?```/g, " "));
  const wordCount = countWords(body.replace(/```[\s\S]*?```/g, " ")) + faqs.reduce((a, f) => a + countWords(f.question) + countWords(f.answer), 0);
  const per100 = (n: number) => (wordCount ? (n / wordCount) * 100 : 0);

  const numbers = (plain.match(/(?<![\p{L}])\d[\d.,]*\s?(%|€|\$|£|kwh|kw|w|mb|gb|km|kg|g|mg|ml|l|h|min|x|mio|million|billion|bn|k)?(?![\p{L}])/giu) ?? []).length;
  const years = (plain.match(/\b(19|20)\d{2}\b/g) ?? []).length;
  const links = [...body.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)[^)]*\)/g)].map((m) => m[1]!);
  const externalLinks = links.length;
  const citations = new Set([...(input.citations ?? []).map((c) => c.url), ...links]).size;
  const capEntities = new Set(
    (plain.match(/\b[A-ZÄÖÜ][\p{L}\d]+(?:\s+[A-ZÄÖÜ][\p{L}\d]+)+\b/gu) ?? []).map((s) => s.toLowerCase()),
  ).size;
  const entityCount = Math.max(capEntities, (input.entities ?? []).length);

  const target = tokens(`${input.targetKeyword ?? ""} ${input.targetPrompt ?? ""}`);
  const keyword = tokens(input.targetKeyword || input.targetPrompt || input.title || "");

  const suggestions: AeoSuggestion[] = [];
  const pillarScores = {} as Record<AeoPillarKey, number>;
  const add = (pillar: AeoPillarKey, lost: number, message: string) => {
    const weight = AEO_PILLARS.find((p) => p.key === pillar)!.weight;
    const impact = Math.round((lost * weight) / 100 * 10) / 10;
    if (impact >= 0.5) suggestions.push({ pillar, impact, message });
  };

  /* Extractability */
  {
    let s = 0;
    const first = paragraphs[0];
    const firstWords = first?.words ?? 0;
    const firstCovers = first ? coverage(first.text, target.length ? target : keyword) : 0;
    if (first && firstWords >= 20 && firstWords <= 90) {
      s += 20;
      if (firstCovers >= 0.5 || !(target.length || keyword.length)) s += 10;
      else add("extractability", 10, "Mention the target question's key terms in the opening answer so engines can match it.");
    } else if (first && firstWords > 0 && firstWords <= 140) {
      s += 12;
      add("extractability", 18, `Tighten the opening paragraph to a 40–80 word direct answer (currently ${firstWords} words).`);
    } else add("extractability", 30, "Start with a 40–80 word paragraph that answers the target question directly (answer-first).");

    const avg = paragraphs.length ? paragraphs.reduce((a, p) => a + p.words, 0) / paragraphs.length : 0;
    const long = paragraphs.filter((p) => p.words > 150).length;
    if (paragraphs.length && avg <= 80 && long === 0) s += 20;
    else if (paragraphs.length) {
      s += avg <= 110 ? 10 : 0;
      add("extractability", avg <= 110 ? 10 : 20, `Split long paragraphs (${long} over 150 words) into self-contained 2–4 sentence chunks.`);
    }

    const qh = headings.filter((h) => h.level >= 2 && (h.text.trim().endsWith("?") || QUESTION_START.test(h.text.trim()))).length;
    if (qh >= 3) s += 20;
    else {
      s += qh * 6;
      add("extractability", 20 - qh * 6, "Phrase more H2/H3 headings as the questions people ask AI (e.g. “How much does … cost?”).");
    }

    const listLike = lists.length + tables.length;
    if (lists.length && tables.length) s += 20;
    else if (listLike) {
      s += 13;
      add("extractability", 7, tables.length ? "Add a bulleted or numbered list for steps or key points." : "Add a comparison table — tables are frequently quoted by AI engines.");
    } else add("extractability", 20, "Add lists and a comparison table; engines extract structured snippets far more often.");

    const hasSummary = headings.some((h) => /(tl;?dr|summary|key takeaways|at a glance|in short|fazit|zusammenfassung|das wichtigste|auf einen blick)/i.test(h.text)) || /^\*\*(tl;?dr|summary|key takeaways|fazit)/im.test(body);
    if (hasSummary) s += 10;
    else add("extractability", 10, "Add a “Key takeaways” / TL;DR block near the top.");
    pillarScores.extractability = clamp100(s);
  }

  /* Fact density */
  {
    let s = 0;
    const numDensity = per100(numbers);
    s += 35 * ramp(numDensity, 1.5);
    if (numDensity < 1.5) add("factDensity", 35 * (1 - ramp(numDensity, 1.5)), `Add concrete numbers, prices, specs or statistics (${numbers} found; aim for ~1.5 per 100 words).`);
    s += 25 * ramp(citations, 4);
    if (citations < 4) add("factDensity", 25 * (1 - ramp(citations, 4)), `Cite authoritative sources inline (${citations} of 4+ recommended).`);
    const entDensity = per100(entityCount);
    s += 20 * ramp(entDensity, 1.2);
    if (entDensity < 1.2) add("factDensity", 20 * (1 - ramp(entDensity, 1.2)), "Name specific entities — brands, products, standards, organisations, places.");
    if (years > 0) s += 10;
    else add("factDensity", 10, "Date your facts (e.g. “as of 2026”) so engines can judge freshness.");
    if (quotes.length > 0 || /[„“"][^"„“”]{20,}["”]\s*(—|–|-)\s*\p{Lu}/u.test(body)) s += 10;
    else add("factDensity", 10, "Add an expert quote or first-hand data point with attribution.");
    pillarScores.factDensity = clamp100(s);
  }

  /* Structure */
  {
    let s = 0;
    const h2 = headings.filter((h) => h.level === 2).length;
    s += 30 * ramp(h2, 4);
    if (h2 < 4) add("structure", 30 * (1 - ramp(h2, 4)), `Break the article into at least 4 H2 sections (${h2} found).`);
    const sectionWords = headings.length ? wordCount / (headings.length + 1) : wordCount;
    if (sectionWords <= 350) s += 20;
    else {
      s += sectionWords <= 600 ? 10 : 0;
      add("structure", sectionWords <= 600 ? 10 : 20, "Add sub-headings — keep sections under ~300 words.");
    }
    let skipped = false;
    let prev = 1;
    for (const h of headings) {
      if (h.level > prev + 1) skipped = true;
      prev = h.level;
    }
    if (!skipped) s += 15;
    else add("structure", 15, "Fix the heading hierarchy (don't jump from H2 to H4).");
    const h1s = headings.filter((h) => h.level === 1).length;
    if (h1s <= 1) s += 10;
    else add("structure", 10, "Use only one H1 — demote the others to H2.");
    s += lists.length ? 15 : 0;
    if (!lists.length) add("structure", 15, "Use bulleted/numbered lists for steps, pros/cons and criteria.");
    s += tables.length ? 10 : 0;
    pillarScores.structure = clamp100(s);
  }

  /* Schema markup */
  {
    const info = analyzeSchema(input.schemaJsonLd);
    let s = 0;
    if (input.schemaJsonLd?.trim() && !info.valid) add("schema", 100, "The JSON-LD is not valid JSON — fix or regenerate it.");
    else if (!info.valid) add("schema", 100, "Add JSON-LD structured data (Article + FAQPage) — use the schema generator.");
    else {
      s += 35;
      const articleTypes = ["Article", "BlogPosting", "NewsArticle", "TechArticle", "HowTo", "Product", "Review", "WebPage", "MedicalWebPage"];
      const hasMain = [...info.types].some((t) => articleTypes.includes(t));
      if (hasMain) s += 20;
      else add("schema", 20, "Add an Article/BlogPosting (or HowTo/Product) node describing the page.");
      const props = [info.hasHeadline, info.hasAuthor, info.hasDate].filter(Boolean).length;
      s += props * 5;
      if (props < 3) add("schema", (3 - props) * 5, "Include headline, author and datePublished/dateModified in the schema.");
      if (info.types.has("FAQPage") && info.faqCount > 0) s += 20;
      else add("schema", 20, faqs.length ? "Add your FAQs as a FAQPage node in the JSON-LD." : "Add an FAQ section and mark it up as FAQPage.");
      if (info.hasPublisher || info.types.has("Organization")) s += 5;
      else add("schema", 5, "Reference your Organization as publisher.");
      if (info.hasAbout) s += 5;
      else add("schema", 5, "Add about/mentions entities to connect the page to known things.");
    }
    pillarScores.schema = clamp100(s);
  }

  /* Depth */
  {
    let s = 0;
    s += 40 * ramp(wordCount - 200, 1000);
    if (wordCount < 1200) add("depth", 40 * (1 - ramp(wordCount - 200, 1000)), `Expand coverage — ${wordCount} words; comprehensive answers usually run 1,200+.`);
    const sections = headings.filter((h) => h.level <= 3).length;
    s += 20 * ramp(sections, 6);
    if (sections < 6) add("depth", 20 * (1 - ramp(sections, 6)), "Cover more sub-topics / follow-up questions as their own sections.");
    s += 20 * ramp(faqs.length, 5);
    if (faqs.length < 5) add("depth", 20 * (1 - ramp(faqs.length, 5)), `Add FAQs for follow-up questions (${faqs.length} of 5+).`);
    const headingText = headings.map((h) => h.text).join(" ");
    if (keyword.length && coverage(headingText, keyword) >= 0.5) s += 10;
    else if (keyword.length) add("depth", 10, "Use the target topic's key terms in at least one H2.");
    else s += 10;
    s += 10 * ramp(entityCount, 8);
    if (entityCount < 8) add("depth", 10 * (1 - ramp(entityCount, 8)), "Reference more related entities (products, standards, organisations).");
    pillarScores.depth = clamp100(s);
  }

  /* Metadata */
  {
    let s = 0;
    const mt = (input.metaTitle ?? "").trim();
    const md = (input.metaDescription ?? "").trim();
    if (mt.length >= 30 && mt.length <= 60) s += 30;
    else if (mt) {
      s += 15;
      add("metadata", 15, `Meta title should be 30–60 characters (currently ${mt.length}).`);
    } else add("metadata", 30, "Add a meta title (30–60 characters).");
    if (md.length >= 120 && md.length <= 160) s += 30;
    else if (md.length >= 70 && md.length <= 200) {
      s += 15;
      add("metadata", 15, `Meta description should be 120–160 characters (currently ${md.length}).`);
    } else add("metadata", 30, md ? `Meta description is ${md.length} characters — aim for 120–160.` : "Add a meta description that answers the question in one sentence.");
    if (!keyword.length || (mt && coverage(mt, keyword) >= 0.5)) s += 15;
    else add("metadata", 15, "Include the target keyword in the meta title.");
    if (!keyword.length || (md && coverage(md, keyword) >= 0.5)) s += 10;
    else add("metadata", 10, "Include the target keyword in the meta description.");
    const slug = (input.slug ?? "").trim();
    if (slug && slug.length <= 60 && slug.split("-").length <= 8) {
      s += 10;
      if (!keyword.length || coverage(slug.replace(/-/g, " "), keyword) >= 0.34) s += 5;
      else add("metadata", 5, "Put the main keyword in the URL slug.");
    } else add("metadata", 15, slug ? "Shorten the URL slug (≤ 60 characters, ≤ 8 words)." : "Set a short, descriptive URL slug.");
    pillarScores.metadata = clamp100(s);
  }

  const score = Math.round(AEO_PILLARS.reduce((acc, p) => acc + (pillarScores[p.key] * p.weight) / 100, 0));
  suggestions.sort((a, b) => b.impact - a.impact);

  return {
    score,
    band: aeoBand(score),
    pillars: pillarScores,
    suggestions,
    stats: {
      wordCount,
      readingMinutes: Math.max(1, Math.round(wordCount / 230)),
      paragraphs: paragraphs.length,
      avgParagraphWords: paragraphs.length ? Math.round(paragraphs.reduce((a, p) => a + p.words, 0) / paragraphs.length) : 0,
      headings: headings.length,
      h2: headings.filter((h) => h.level === 2).length,
      h3: headings.filter((h) => h.level === 3).length,
      questionHeadings: headings.filter((h) => h.level >= 2 && (h.text.trim().endsWith("?") || QUESTION_START.test(h.text.trim()))).length,
      lists: lists.length,
      tables: tables.length,
      numbers,
      externalLinks,
      citations,
      faqs: faqs.length,
      entities: entityCount,
    },
    outline: headings.map((h) => ({ level: h.level, text: h.text, line: h.line })),
  };
}
