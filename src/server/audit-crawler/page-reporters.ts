/**
 * Per-page issue reporters (port of open-seo `issues/page-reporters.ts`). Pure functions over one
 * crawled page record. Cross-page checks live in `multipage-checks.ts`.
 */
import type { AuditIssueType } from "./registry";
import type { CrawledPageResult, DetectedIssue } from "./types";

export const TITLE_MAX_CHARS = 60;
export const TITLE_MIN_CHARS = 10;
export const META_DESCRIPTION_MAX_CHARS = 160;
export const META_DESCRIPTION_MIN_CHARS = 70;
export const THIN_CONTENT_WORDS = 150;
export const SLOW_RESPONSE_MS = 1500;
export const DEEP_PAGE_DEPTH = 5;

export function hasHeadingLevelSkip(headingOrder: number[]): boolean {
  for (let i = 1; i < headingOrder.length; i++) {
    if (headingOrder[i]! > headingOrder[i - 1]! + 1) return true;
  }
  return false;
}

export type ReporterPage = Pick<
  CrawledPageResult,
  | "id"
  | "url"
  | "statusCode"
  | "fetchClass"
  | "responseTimeMs"
  | "isHtml"
  | "title"
  | "metaDescription"
  | "h1Count"
  | "headingOrder"
  | "isIndexable"
  | "robotsMeta"
  | "xRobotsTag"
  | "canonicalUrl"
  | "headerCanonicalUrl"
  | "wordCount"
  | "imagesMissingAlt"
  | "imagesTotal"
  | "links"
  | "crawlDepth"
>;

export function runPageReporters(page: ReporterPage): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  const report = (issueType: AuditIssueType, details?: Record<string, unknown>) =>
    issues.push({ issueType, pageId: page.id, pageUrl: page.url, details });

  // 1. Fetch class
  if (page.fetchClass === "blocked") {
    report("blocked-page", { statusCode: page.statusCode });
    return issues;
  }
  if (page.fetchClass === "rate_limited") {
    report("rate-limited-page", { statusCode: page.statusCode });
    return issues;
  }
  if (page.fetchClass === "error") return issues;

  // 2. HTTP status
  if (page.statusCode >= 500) {
    report("server-error", { statusCode: page.statusCode });
    return issues;
  }
  if (page.statusCode >= 400) {
    report("broken-page", { statusCode: page.statusCode });
    return issues;
  }
  // Redirects are normal on their own; chains/loops are flagged cross-page.
  if (page.statusCode >= 300) return issues;

  // 3. Performance (before HTML gating)
  if (page.responseTimeMs > SLOW_RESPONSE_MS) report("slow-response", { responseTimeMs: page.responseTimeMs });

  // 4. Content checks only for analyzed HTML documents.
  if (!page.isHtml) return issues;

  // Titles
  if (!page.title) report("missing-title");
  else if (page.title.length > TITLE_MAX_CHARS) report("title-too-long", { length: page.title.length });
  else if (page.title.length < TITLE_MIN_CHARS) report("title-too-short", { length: page.title.length });

  // Meta description
  if (!page.metaDescription) report("missing-meta-description");
  else if (page.metaDescription.length > META_DESCRIPTION_MAX_CHARS)
    report("meta-description-too-long", { length: page.metaDescription.length });
  else if (page.metaDescription.length < META_DESCRIPTION_MIN_CHARS)
    report("meta-description-too-short", { length: page.metaDescription.length });

  // Headings
  if (page.h1Count === 0) report("missing-h1");
  else if (page.h1Count > 1) report("multiple-h1", { h1Count: page.h1Count });
  if (hasHeadingLevelSkip(page.headingOrder)) report("heading-order-skip");

  // Indexability + canonical signals
  if (!page.isIndexable) report("noindex-page", { robotsMeta: page.robotsMeta, xRobotsTag: page.xRobotsTag });
  if (page.canonicalUrl && page.headerCanonicalUrl && page.canonicalUrl !== page.headerCanonicalUrl) {
    report("canonical-conflict", { htmlCanonical: page.canonicalUrl, headerCanonical: page.headerCanonicalUrl });
  }
  const effectiveCanonical = page.canonicalUrl ?? page.headerCanonicalUrl;
  if (effectiveCanonical && effectiveCanonical !== page.url) report("canonicalized-page", { canonicalUrl: effectiveCanonical });

  // Content quality
  if (page.isIndexable && page.wordCount < THIN_CONTENT_WORDS) report("thin-content", { wordCount: page.wordCount });
  if (page.imagesMissingAlt > 0)
    report("images-missing-alt", { imagesMissingAlt: page.imagesMissingAlt, imagesTotal: page.imagesTotal });

  // Structure
  if (page.isIndexable && page.links.length === 0) report("no-outgoing-links");
  if (page.crawlDepth !== null && page.crawlDepth >= DEEP_PAGE_DEPTH) report("deep-page", { crawlDepth: page.crawlDepth });

  return issues;
}
