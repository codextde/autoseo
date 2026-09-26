/**
 * llms.txt validation (llmstxt.org format) and a deterministic generator from site structure.
 * Pure / isomorphic.
 *
 * Format: `# Name` (required H1) → optional `> summary` blockquote → optional free text →
 * `## Section` headings with markdown link lists `- [Title](https://url): optional notes`.
 * A section named "Optional" marks links that can be skipped for short contexts.
 */

export type LlmsLink = { title: string; url: string; notes: string | null };
export type LlmsSection = { title: string; links: LlmsLink[] };

export type LlmsValidation = {
  valid: boolean;
  title: string | null;
  summary: string | null;
  sections: LlmsSection[];
  /** Links in `- [Title](url)` list items (the llmstxt.org structure). */
  linkCount: number;
  /** Markdown links anywhere else in the text. */
  inlineLinkCount: number;
  errors: string[];
  warnings: string[];
};

const LINK_RE = /^\s*[-*+]\s*\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*(?::\s*(.*))?$/;

export function looksLikeHtml(text: string, contentType?: string | null): boolean {
  if (contentType && /text\/html/i.test(contentType)) return true;
  return /^\s*(<!doctype html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(text);
}

export function validateLlmsTxt(text: string, opts: { contentType?: string | null; origin?: string; full?: boolean } = {}): LlmsValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sections: LlmsSection[] = [];
  if (looksLikeHtml(text, opts.contentType)) {
    return { valid: false, title: null, summary: null, sections, linkCount: 0, inlineLinkCount: 0, errors: ["The file is an HTML page (probably a soft-404 or SPA fallback), not markdown."], warnings };
  }
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  let title: string | null = null;
  let summary: string | null = null;
  let current: LlmsSection | null = null;
  let seenContent = false;
  let linkCount = 0;
  let inlineLinkCount = 0;
  const relative: string[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (!seenContent) {
      seenContent = true;
      if (/^#\s+\S/.test(line)) {
        title = line.replace(/^#\s+/, "").trim();
        continue;
      }
      errors.push("The file must start with an H1 title line (`# Site name`).");
    }
    if (/^#\s+\S/.test(line)) {
      if (title) warnings.push("More than one H1 heading — use `##` for sections.");
      continue;
    }
    if (/^>\s?/.test(line) && !sections.length && summary === null) {
      summary = line.replace(/^>\s?/, "").trim();
      continue;
    }
    if (/^##\s+\S/.test(line)) {
      current = { title: line.replace(/^##\s+/, "").trim(), links: [] };
      sections.push(current);
      continue;
    }
    const m = line.match(LINK_RE);
    if (m) {
      const url = m[2]!;
      linkCount += 1;
      if (!/^https?:\/\//i.test(url)) relative.push(url);
      if (current) current.links.push({ title: m[1]!.trim(), url, notes: m[3]?.trim() || null });
      else warnings.push(`Link "${m[1]}" appears before any \`##\` section.`);
    } else {
      inlineLinkCount += (line.match(/\[[^\]]+\]\([^)\s]+\)/g) ?? []).length;
    }
  }

  if (!seenContent) errors.push("The file is empty.");
  if (!summary && !opts.full) warnings.push("Add a one-line `> summary` blockquote under the title — models use it as the site description.");
  if (!opts.full && linkCount === 0)
    warnings.push(
      inlineLinkCount
        ? `No link lists found (only ${inlineLinkCount} inline link${inlineLinkCount === 1 ? "" : "s"}). The llmstxt.org format lists key pages as \`- [Title](https://…): notes\` under \`##\` sections.`
        : "No links found. List your key pages as `- [Title](https://…): notes` under `##` sections.",
    );
  if (relative.length) warnings.push(`${relative.length} link(s) use relative URLs (e.g. "${relative[0]}") — use absolute https:// URLs.`);
  if (!opts.full && text.length > 200_000) warnings.push("llms.txt is very large; keep it concise and move full content to llms-full.txt.");
  const emptySections = sections.filter((s) => !s.links.length && !opts.full).map((s) => s.title);
  if (emptySections.length) warnings.push(`Section(s) without links: ${emptySections.slice(0, 3).join(", ")}.`);
  return { valid: errors.length === 0, title, summary, sections, linkCount, inlineLinkCount, errors, warnings };
}

export type GeneratorPage = { url: string; title?: string | null; description?: string | null };

const OPTIONAL_PATTERNS = /(impressum|imprint|datenschutz|privacy|terms|agb|cookie|legal|disclaimer|widerruf|login|signin|sign-in|register|cart|checkout|account|warenkorb|kasse)/i;

function titleCase(s: string): string {
  return s
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    return seg ? titleCase(decodeURIComponent(seg).replace(/\.(html?|php|aspx?)$/i, "")) : u.hostname;
  } catch {
    return url;
  }
}

function cleanTitle(title: string | null | undefined, siteName: string): string | null {
  if (!title) return null;
  let t = title.replace(/\s+/g, " ").trim();
  // Strip " | Brand" / " – Brand" suffixes.
  const parts = t.split(/\s+[|–—·-]\s+/);
  if (parts.length > 1 && parts[parts.length - 1]!.toLowerCase().includes(siteName.toLowerCase().split(" ")[0]!)) parts.pop();
  t = parts.join(" – ").trim();
  return t.length > 2 ? t.slice(0, 120) : null;
}

/** Deterministic llms.txt from the site's pages (sitemap/crawl), grouped by first path segment. */
export function generateLlmsTxt(input: { siteName: string; summary?: string | null; description?: string | null; origin: string; pages: GeneratorPage[] }): string {
  const seen = new Set<string>();
  const pages = input.pages.filter((p) => {
    try {
      const u = new URL(p.url);
      const key = `${u.hostname}${u.pathname.replace(/\/$/, "")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch {
      return false;
    }
  });
  const groups = new Map<string, GeneratorPage[]>();
  const optional: GeneratorPage[] = [];
  const main: GeneratorPage[] = [];
  for (const p of pages) {
    const u = new URL(p.url);
    const segs = u.pathname.split("/").filter(Boolean);
    if (OPTIONAL_PATTERNS.test(u.pathname)) {
      optional.push(p);
      continue;
    }
    // Language prefixes (/de/, /en-us/) are not sections.
    const first = segs[0] && /^[a-z]{2}(-[a-z]{2})?$/i.test(segs[0]) ? segs[1] : segs[0];
    if (!first || segs.length <= 1) {
      main.push(p);
      continue;
    }
    const key = first.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const line = (p: GeneratorPage) => {
    const t = cleanTitle(p.title, input.siteName) ?? nameFromUrl(p.url);
    const notes = p.description?.replace(/\s+/g, " ").trim().slice(0, 160);
    return `- [${t.replace(/[[\]]/g, "")}](${p.url})${notes ? `: ${notes}` : ""}`;
  };
  const out: string[] = [`# ${input.siteName}`, ""];
  const summary = (input.summary || input.description || "").replace(/\s+/g, " ").trim();
  if (summary) out.push(`> ${summary.slice(0, 300)}`, "");
  if (main.length) {
    out.push("## Main pages", "");
    for (const p of main.slice(0, 25)) out.push(line(p));
    out.push("");
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12);
  let total = main.length;
  for (const [key, list] of sorted) {
    if (total >= 150) break;
    out.push(`## ${titleCase(key)}`, "");
    for (const p of list.slice(0, 25)) {
      out.push(line(p));
      total++;
    }
    out.push("");
  }
  if (optional.length) {
    out.push("## Optional", "");
    for (const p of optional.slice(0, 15)) out.push(line(p));
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}
