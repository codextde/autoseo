/**
 * Pure cross-page checks (port of open-seo `issues/multipage-checks.ts` + the scratchpad DO's
 * broken-link / orphan SQL, re-expressed as pure functions over slim rows).
 */
import type { PageFetchClass } from "./registry";
import type { DetectedIssue } from "./types";

const DUPLICATE_GROUP_SAMPLE = 3;
export const BROKEN_LINK_ISSUE_CAP = 2_000;

export interface SlimPage {
  id: string;
  url: string;
  statusCode: number | null;
  fetchClass: PageFetchClass;
  title: string | null;
  metaDescription: string | null;
  contentHash: string | null;
  redirectUrl: string | null;
  wordCount: number;
  isIndexable: boolean;
  canonicalUrl: string | null;
  headerCanonicalUrl: string | null;
}

function isOkHtmlPage(page: SlimPage): boolean {
  return page.fetchClass === "ok" && page.statusCode !== null && page.statusCode >= 200 && page.statusCode < 300;
}

/** Pages already de-duplicated by the owner (noindex / canonicalized elsewhere) are excluded. */
export function isDuplicateCandidate(page: SlimPage): boolean {
  if (!isOkHtmlPage(page) || !page.isIndexable) return false;
  const effectiveCanonical = page.canonicalUrl ?? page.headerCanonicalUrl;
  return !effectiveCanonical || effectiveCanonical === page.url;
}

export function findDuplicates(pages: SlimPage[]): DetectedIssue[] {
  const okPages = pages.filter(isDuplicateCandidate);
  const groupBy = (keyOf: (page: SlimPage) => string | null): Map<string, SlimPage[]> => {
    const groups = new Map<string, SlimPage[]>();
    for (const page of okPages) {
      const key = keyOf(page);
      if (!key) continue;
      const group = groups.get(key);
      if (group) group.push(page);
      else groups.set(key, [page]);
    }
    return groups;
  };
  const issues: DetectedIssue[] = [];
  const emitGroups = (groups: Map<string, SlimPage[]>, issueType: DetectedIssue["issueType"]) => {
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const page of group) {
        issues.push({
          issueType,
          pageId: page.id,
          pageUrl: page.url,
          details: {
            groupSize: group.length,
            otherUrls: group
              .filter((other) => other.id !== page.id)
              .slice(0, DUPLICATE_GROUP_SAMPLE)
              .map((other) => other.url),
          },
        });
      }
    }
  };
  emitGroups(groupBy((page) => page.title || null), "duplicate-title");
  emitGroups(groupBy((page) => page.metaDescription || null), "duplicate-meta-description");
  emitGroups(groupBy((page) => (page.wordCount > 0 ? page.contentHash : null)), "duplicate-content");
  return issues;
}

export function findRedirectChainsAndLoops(pages: SlimPage[]): DetectedIssue[] {
  const redirects = new Map<string, SlimPage>();
  for (const page of pages) {
    const isRedirect = page.statusCode !== null && page.statusCode >= 300 && page.statusCode < 400 && page.redirectUrl;
    if (isRedirect) redirects.set(page.url, page);
  }
  const redirectTargets = new Set(Array.from(redirects.values(), (page) => page.redirectUrl!));
  const issues: DetectedIssue[] = [];
  const walked = new Set<string>();

  // Walk from chain heads (redirects nothing else redirects to): a 5-hop chain yields one issue.
  for (const [url, head] of redirects) {
    if (redirectTargets.has(url)) continue;
    const hops: string[] = [url];
    const seen = new Set(hops);
    walked.add(url);
    let current = head.redirectUrl;
    let isLoop = false;
    while (current) {
      if (seen.has(current)) {
        isLoop = true;
        hops.push(current);
        break;
      }
      hops.push(current);
      seen.add(current);
      if (redirects.has(current)) walked.add(current);
      current = redirects.get(current)?.redirectUrl ?? null;
    }
    if (isLoop) {
      issues.push({ issueType: "redirect-loop", pageId: head.id, pageUrl: url, details: { hops } });
    } else if (hops.length > 2) {
      issues.push({ issueType: "redirect-chain", pageId: head.id, pageUrl: url, details: { hops, finalUrl: hops[hops.length - 1] } });
    }
  }

  // Headless cycles (every member is also a target, e.g. a↔b or a→a): one loop per cycle.
  for (const [url, page] of redirects) {
    if (walked.has(url)) continue;
    const cycle: string[] = [];
    let current: string | null = url;
    while (current && !walked.has(current)) {
      walked.add(current);
      cycle.push(current);
      current = redirects.get(current)?.redirectUrl ?? null;
    }
    issues.push({ issueType: "redirect-loop", pageId: page.id, pageUrl: url, details: { hops: [...cycle, url] } });
  }
  return issues;
}

export type LinkGraphPage = {
  id: string;
  url: string;
  statusCode: number | null;
  fetchClass: PageFetchClass;
  redirectUrl: string | null;
  /** Internal link targets of this page (normalized URLs). */
  internalTargets: string[];
};

/**
 * Broken internal links: an internal link whose target was crawled with status ≥ 400 and
 * fetch class "ok" (blocked/rate-limited targets are excluded). One issue per (source, target),
 * capped at 2,000 rows, ordered by source page id then target URL (open-seo parity).
 */
export function findBrokenInternalLinks(pages: LinkGraphPage[]): DetectedIssue[] {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const issues: DetectedIssue[] = [];
  const sorted = [...pages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const source of sorted) {
    const targets = [...new Set(source.internalTargets)].sort();
    for (const target of targets) {
      const t = byUrl.get(target);
      if (!t || t.fetchClass !== "ok" || t.statusCode === null || t.statusCode < 400) continue;
      issues.push({
        issueType: "broken-internal-link",
        pageId: source.id,
        pageUrl: source.url,
        details: { targetUrl: target, targetStatus: t.statusCode },
        dedupeKey: target,
      });
      if (issues.length >= BROKEN_LINK_ISSUE_CAP) return issues;
    }
  }
  return issues;
}

/**
 * Orphans: live pages (fetch ok, 2xx), not the start URL, with no inbound link from any OTHER
 * crawled page and not the target of any crawled redirect. Only meaningful when the crawl completed.
 */
export function findOrphanPages(pages: LinkGraphPage[], startUrl: string): DetectedIssue[] {
  const inbound = new Set<string>();
  for (const p of pages) {
    for (const t of p.internalTargets) if (t !== p.url) inbound.add(t);
  }
  const redirectTargets = new Set(pages.map((p) => p.redirectUrl).filter((u): u is string => !!u));
  const issues: DetectedIssue[] = [];
  for (const p of pages) {
    if (p.url === startUrl) continue;
    if (p.fetchClass !== "ok" || p.statusCode === null || p.statusCode < 200 || p.statusCode >= 300) continue;
    if (inbound.has(p.url) || redirectTargets.has(p.url)) continue;
    issues.push({ issueType: "orphan-page", pageId: p.id, pageUrl: p.url });
  }
  return issues;
}

/** Inbound internal link counts per URL (from other pages). */
export function countInlinks(pages: LinkGraphPage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of pages) {
    for (const t of new Set(p.internalTargets)) {
      if (t === p.url) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return counts;
}
