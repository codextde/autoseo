import type { AuditIssueType, PageFetchClass } from "./registry";

/** One outgoing link edge, deduped by target URL within a page. */
export interface PageLink {
  targetUrl: string;
  anchor: string | null;
  isInternal: boolean;
  isNofollow: boolean;
}

/** Data extracted from a single page's HTML. */
export interface PageAnalysis {
  url: string;
  statusCode: number;
  redirectUrl: string | null;
  responseTimeMs: number;
  title: string;
  metaDescription: string;
  canonical: string | null;
  robotsMeta: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  h1s: string[];
  headingOrder: number[];
  wordCount: number;
  bodyText: string;
  images: Array<{ src: string | null; alt: string | null }>;
  links: PageLink[];
  hasStructuredData: boolean;
  structuredDataTypes: string[];
  hreflangTags: string[];
  lang: string | null;
}

/** Full result of crawling one page (persisted per sub-batch). */
export interface CrawledPageResult {
  id: string;
  url: string;
  statusCode: number;
  fetchClass: PageFetchClass;
  redirectUrl: string | null;
  contentType: string | null;
  title: string;
  metaDescription: string;
  canonicalUrl: string | null;
  robotsMeta: string | null;
  xRobotsTag: string | null;
  headerCanonicalUrl: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  h1s: string[];
  h1Count: number;
  h2Count: number;
  h3Count: number;
  h4Count: number;
  h5Count: number;
  h6Count: number;
  headingOrder: number[];
  wordCount: number;
  contentHash: string | null;
  /** True when an HTML document was fetched and analyzed (gates content checks). */
  isHtml: boolean;
  htmlBytes: number;
  /** A 429 was retried for this URL (narrows the crawl window). */
  rateLimited: boolean;
  imagesTotal: number;
  imagesMissingAlt: number;
  images: Array<{ src: string | null; alt: string | null }>;
  links: PageLink[];
  hasStructuredData: boolean;
  structuredDataTypes: string[];
  hreflangTags: string[];
  lang: string | null;
  isIndexable: boolean;
  responseTimeMs: number;
  /** null = not reached via links (sitemap-seeded). */
  crawlDepth: number | null;
  inSitemap: boolean;
}

export interface DetectedIssue {
  issueType: AuditIssueType;
  pageId: string | null;
  pageUrl: string;
  details?: Record<string, unknown>;
  /** Distinguishes multiple issues of one type on one page (part of the deterministic id). */
  dedupeKey?: string;
}

export type LighthouseStrategy = "mobile" | "desktop";
