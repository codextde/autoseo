/**
 * Pure text helpers for Fact Check (no server-only / path-alias imports so they are unit-testable):
 * label section splitting, sentence splitting, claim normalization/hashing, asset mention detection,
 * fallback statement extraction and the lexical ("word-for-word") judge.
 */
import { createHash } from "node:crypto";

export type LabelSection = { id: string; heading: string; text: string };

/* ───────────────────────────── Normalization ───────────────────────────── */

export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[(\d+)\]/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+•]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|\W)[*_]([^*_\n]+)[*_](?=\W|$)/g, "$1$2")
    .replace(/\|/g, " ")
    .replace(/[ \t]+/g, " ");
}

/** Canonical form of a claim used for dedupe (case/whitespace/punctuation-insensitive). */
export function normalizeClaim(claim: string): string {
  return stripMarkdown(claim)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”„"«»]/g, "")
    .replace(/[‘’`´]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?)(]+$/g, "")
    .replace(/^[\s.,;:!?)(-]+/g, "")
    .trim();
}

export function claimHash(assetId: string, claim: string, engine: string, market: string): string {
  return createHash("sha256")
    .update([assetId, normalizeClaim(claim), engine.toLowerCase(), market.toUpperCase()].join("␟"))
    .digest("hex");
}

const STOPWORDS = new Set(
  (
    "a an the and or but if then than of in on at to for from by with without as is are was were be been being it its this that these those " +
    "there their they them he she his her we our you your i me my not no nor so such can could may might will would should must shall do does did " +
    "has have had also only very more most less least into over under about after before between during per via which who whom whose what when where why how " +
    "der die das den dem des ein eine einer einem einen eines und oder aber wenn dann als von im in am an auf aus bei mit ohne für zu zum zur ist sind war waren " +
    "sein seine ihr ihre es er sie wir ihr nicht kein keine auch nur sehr mehr noch schon so wie was wer wo wann warum dass werden wird wurde kann können soll sollte muss"
  ).split(/\s+/),
);

/** Very light stemming so "tablets"/"tablet", "reduces"/"reduce" compare equal. */
function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 4 && t.endsWith("es") && !t.endsWith("ses")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

/** Content tokens (lowercased, stopwords removed, light stemming). Numbers are kept. */
export function tokenize(text: string): string[] {
  return (text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+(?:[.,]\d+)?/gu) ?? [])
    .filter((t) => (t.length > 1 || /\d/.test(t)) && !STOPWORDS.has(t))
    .map((t) => (/\d/.test(t) ? t.replace(",", ".") : stem(t)));
}

/** Numbers mentioned in a text (normalized: "2,5" → "2.5"). */
export function extractNumbers(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".").replace(/\.0+$/, ""));
}

/* ───────────────────────────── Sentences ───────────────────────────── */

const ABBREV = /\b(?:e\.g|i\.e|z\.b|u\.a|d\.h|bzw|ca|dr|prof|mg|ml|approx|vs|etc|inc|ltd|nr|no|max|min|incl|ggf|evtl|usw)\.$/i;

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n+/)) {
    const line = block.trim();
    if (!line) continue;
    const parts = line.split(/(?<=[.!?])\s+(?=[\p{Lu}\d"“„(])/u);
    let buf = "";
    for (const p of parts) {
      buf = buf ? `${buf} ${p}` : p;
      if (ABBREV.test(buf)) continue;
      out.push(buf.trim());
      buf = "";
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.filter((s) => s.length > 1);
}

/* ───────────────────────────── Section splitter ───────────────────────────── */

function isHeading(line: string, next: string | undefined): string | null {
  const md = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
  if (md) return md[1]!.trim();
  if (line.length > 110 || line.length < 3) return null;
  // "4.1 Therapeutic indications", "4. Clinical particulars", "1 Name of the medicinal product"
  const num = line.match(/^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(\p{Lu}[^.!?]{1,100})$/u);
  if (num && !/[.;,]$/.test(line)) return line.replace(/\s+/g, " ").trim();
  // ALL CAPS headings (at least 2 letters, mostly uppercase, no sentence punctuation)
  const letters = line.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase() && !/[.!?]$/.test(line) && line.split(/\s+/).length <= 12)
    return line.trim();
  // "Warnings:" style label headings followed by content
  if (/^[\p{Lu}][\p{L}\s/&-]{2,60}:$/u.test(line) && next && next.trim().length > 0) return line.slice(0, -1).trim();
  return null;
}

/** Splits label text into sections by markdown / numbered / ALL-CAPS headings. */
export function splitSections(text: string, fallbackChunk = 1500): LabelSection[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sections: LabelSection[] = [];
  let heading = "";
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (body || heading) sections.push({ id: `s${sections.length + 1}`, heading: heading || "Introduction", text: body });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const h = line ? isHeading(line, lines[i + 1]) : null;
    if (h) {
      if (buf.some((l) => l.trim()) || heading) flush();
      heading = h;
    } else buf.push(lines[i]!);
  }
  flush();
  const withText = sections.filter((s) => s.text.length > 0);
  if (withText.length >= 2 || (withText.length === 1 && withText[0]!.heading !== "Introduction")) {
    return withText.map((s, i) => ({ ...s, id: `s${i + 1}` }));
  }
  // No usable headings: chunk by paragraphs.
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: LabelSection[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > fallbackChunk) {
      chunks.push({ id: `s${chunks.length + 1}`, heading: `Part ${chunks.length + 1}`, text: cur });
      cur = "";
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push({ id: `s${chunks.length + 1}`, heading: `Part ${chunks.length + 1}`, text: cur });
  return chunks;
}

/* ───────────────────────────── Asset mentions ───────────────────────────── */

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionRegex(names: string[]): RegExp | null {
  const clean = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  if (!clean.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${clean.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

export function mentionsAsset(text: string, names: string[]): boolean {
  const re = mentionRegex(names);
  return !!re && re.test(text);
}

const FACT_HINT =
  /\b(is|are|was|were|contains?|treats?|use[sd]?|recommends?|indicated|helps?|reduces?|increases?|causes?|costs?|has|have|can|may|should|must|recommended|approved|dose|dosage|taken?|lasts?|works?|offers?|provides?|includes?|ist|sind|enthält|wirkt|hilft|kann|können|wird|werden|hat|haben|kostet|bietet|eignet|empfohlen|zugelassen)\b/i;

/** Fallback (no AI): sentences of an answer that make a factual statement about the asset. */
export function extractCandidateStatements(answerText: string, names: string[], max = 8): { claim: string; quote: string }[] {
  const re = mentionRegex(names);
  if (!re) return [];
  const seen = new Set<string>();
  const out: { claim: string; quote: string }[] = [];
  for (const s of splitSentences(stripMarkdown(answerText))) {
    const sentence = s.replace(/\s+/g, " ").trim();
    if (sentence.length < 25 || sentence.length > 400) continue;
    if (sentence.endsWith("?")) continue;
    if (!re.test(sentence)) continue;
    if (!/\d/.test(sentence) && !FACT_HINT.test(sentence)) continue;
    const key = normalizeClaim(sentence);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ claim: sentence, quote: sentence });
    if (out.length >= max) break;
  }
  return out;
}

/* ───────────────────────────── Relevance ───────────────────────────── */

export function containment(claimTokens: string[], targetTokens: Set<string>): number {
  if (!claimTokens.length) return 0;
  let hit = 0;
  for (const t of claimTokens) if (targetTokens.has(t)) hit++;
  return hit / claimTokens.length;
}

/** Top-k sections most relevant to a set of claims (token overlap). */
export function relevantSections<T extends LabelSection>(sections: T[], claims: string[], k = 6): T[] {
  const claimTokens = new Set(claims.flatMap(tokenize));
  if (!claimTokens.size) return sections.slice(0, k);
  const scored = sections.map((s, i) => {
    const toks = new Set(tokenize(`${s.heading} ${s.text}`));
    let score = 0;
    for (const t of claimTokens) if (toks.has(t)) score++;
    return { s, score: score / Math.sqrt(Math.max(1, toks.size) / 50 + 1), i };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, k)
    .filter((x) => x.score > 0 || k >= sections.length)
    .map((x) => x.s);
}

/* ───────────────────────────── Quote validation ───────────────────────────── */

function squash(s: string) {
  return s.normalize("NFKC").toLowerCase().replace(/[“”„"«»‘’`´']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Checks that a quote occurs (verbatim modulo whitespace/punctuation/case) in the source.
 * Returns the matching sentence of the source when found fuzzily (≥ 0.9 token containment).
 */
export function findQuote(quote: string, source: string): { found: boolean; sentence: string | null } {
  const q = squash(quote);
  if (!q) return { found: false, sentence: null };
  if (squash(source).includes(q)) return { found: true, sentence: quote.trim() };
  const qt = tokenize(quote);
  let best: { score: number; sentence: string } | null = null;
  for (const s of splitSentences(source)) {
    const score = containment(qt, new Set(tokenize(s)));
    if (!best || score > best.score) best = { score, sentence: s };
  }
  if (best && best.score >= 0.9) return { found: true, sentence: best.sentence };
  return { found: false, sentence: null };
}

/* ───────────────────────────── Lexical judge ───────────────────────────── */

export type JudgeSection = LabelSection & { documentId: string; documentTitle: string; superseded?: boolean };

export type JudgeResult = {
  verdict: "matched" | "contradicted" | "outdated" | "needs_review";
  severity: "critical" | "major" | "minor" | null;
  score: number;
  labelSection: string | null;
  labelQuote: string | null;
  documentId: string | null;
  explanation: string;
};

const CRITICAL_TERMS =
  /\b(dose|dosage|dosing|mg|µg|mcg|ml|overdose|contraindicat\w*|pregnan\w*|breast-?feeding|child(ren)?|infant|interaction|fatal|death|lethal|allerg\w*|dosis|überdosis|kontraindi\w*|schwanger\w*|stillzeit|kinder|wechselwirkung\w*|tödlich)\b/i;

type Candidate = { sentence: string; score: number; section: JudgeSection };

function bestMatch(claimTokens: string[], sections: JudgeSection[], ignoreNumbers: boolean): Candidate | null {
  const ct = ignoreNumbers ? claimTokens.filter((t) => !/\d/.test(t)) : claimTokens;
  let best: Candidate | null = null;
  for (const section of sections) {
    const sentences = splitSentences(section.text);
    for (let i = 0; i < sentences.length; i++) {
      // single sentences and pairs (claims often merge two label sentences)
      const windows = [sentences[i]!, i + 1 < sentences.length ? `${sentences[i]} ${sentences[i + 1]}` : null];
      for (const w of windows) {
        if (!w) continue;
        const score = containment(ct, new Set(tokenize(w)));
        if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && w.length < best.sentence.length))
          best = { sentence: w, score, section };
      }
    }
  }
  return best;
}

/**
 * Word-for-word comparison of a claim with the label (used when no AI provider is available):
 * ≥ 0.8 token containment → matched; the same statement with different numbers → contradicted;
 * matching only a superseded label version → outdated; otherwise → needs review.
 */
export function lexicalJudge(claim: string, sections: JudgeSection[]): JudgeResult {
  const current = sections.filter((s) => !s.superseded);
  const old = sections.filter((s) => s.superseded);
  const tokens = tokenize(claim);
  const claimNums = extractNumbers(claim);
  const empty: JudgeResult = {
    verdict: "needs_review",
    severity: null,
    score: 0,
    labelSection: null,
    labelQuote: null,
    documentId: null,
    explanation: "No reference text to compare with.",
  };
  if (!tokens.length || !sections.length) return empty;

  const full = bestMatch(tokens, current, false);
  if (full && full.score >= 0.8) {
    const labelNums = new Set(extractNumbers(full.sentence));
    const numbersOk = claimNums.every((n) => labelNums.has(n));
    if (numbersOk) {
      return {
        verdict: "matched",
        severity: null,
        score: full.score,
        labelSection: full.section.heading,
        labelQuote: full.sentence,
        documentId: full.section.documentId,
        explanation: `${Math.round(full.score * 100)}% of the claim's wording appears in the label.`,
      };
    }
  }

  if (claimNums.length) {
    const textOnly = bestMatch(tokens, current, true);
    if (textOnly && textOnly.score >= 0.6) {
      const labelNums = extractNumbers(textOnly.sentence);
      const missing = claimNums.filter((n) => !labelNums.includes(n));
      if (labelNums.length && missing.length) {
        // Before calling it a contradiction, check an older label version.
        const oldMatch = old.length ? bestMatch(tokens, old, false) : null;
        if (oldMatch && oldMatch.score >= 0.8 && claimNums.every((n) => extractNumbers(oldMatch.sentence).includes(n))) {
          return {
            verdict: "outdated",
            severity: CRITICAL_TERMS.test(claim) ? "major" : "minor",
            score: oldMatch.score,
            labelSection: textOnly.section.heading,
            labelQuote: textOnly.sentence,
            documentId: textOnly.section.documentId,
            explanation: `Matches a superseded label version ("${oldMatch.section.documentTitle}"); the current label says: ${textOnly.sentence}`,
          };
        }
        return {
          verdict: "contradicted",
          severity: CRITICAL_TERMS.test(claim) ? "critical" : "major",
          score: textOnly.score,
          labelSection: textOnly.section.heading,
          labelQuote: textOnly.sentence,
          documentId: textOnly.section.documentId,
          explanation: `The label states different figures (${labelNums.join(", ")}) than the answer (${missing.join(", ")}).`,
        };
      }
    }
  }

  if (old.length) {
    const oldMatch = bestMatch(tokens, old, false);
    if (oldMatch && oldMatch.score >= 0.8 && (!full || full.score < 0.8)) {
      return {
        verdict: "outdated",
        severity: CRITICAL_TERMS.test(claim) ? "major" : "minor",
        score: oldMatch.score,
        labelSection: oldMatch.section.heading,
        labelQuote: oldMatch.sentence,
        documentId: oldMatch.section.documentId,
        explanation: `Only found in a superseded label version ("${oldMatch.section.documentTitle}").`,
      };
    }
  }

  return {
    verdict: "needs_review",
    severity: null,
    score: full?.score ?? 0,
    labelSection: full && full.score >= 0.4 ? full.section.heading : null,
    labelQuote: full && full.score >= 0.4 ? full.sentence : null,
    documentId: full && full.score >= 0.4 ? full.section.documentId : null,
    explanation: full
      ? `Closest label passage covers ${Math.round(full.score * 100)}% of the claim's wording — needs a human decision.`
      : "No comparable passage in the label.",
  };
}
