import type { SitemapDocResult } from "../audit-crawler/discovery";
import type { BotPurpose } from "./bots";
import type { DirectiveHit, HtmlSignals } from "./html-signals";
import type { LlmsValidation } from "./llms-txt";

export type RobotsAccess = "allowed" | "partial" | "blocked";
export type HttpVerdict = "ok" | "blocked" | "different" | "error" | "inconclusive" | "not_tested";

export type BotHttpResult = {
  url: string;
  status: number | null;
  finalUrl: string | null;
  ttfbMs: number | null;
  words: number | null;
  challenge: boolean;
  verdict: HttpVerdict;
  reason: string | null;
};

export type BotResult = {
  token: string;
  name: string;
  company: string;
  purpose: BotPurpose;
  fetches: boolean;
  robots: {
    status: RobotsAccess;
    source: "specific" | "wildcard" | "none";
    rule: string | null;
    ruleLine: number | null;
    userAgents: string[];
    crawlDelay: number | null;
    pages: Array<{ url: string; allowed: boolean; rule: string | null; line: number | null }>;
    /** Share of sampled site URLs (sitemap + key pages) this bot may not fetch. */
    blockedShare: number;
    sampleSize: number;
    /** Number of non-empty Disallow rules that apply to this bot. */
    disallowRules: number;
  };
  http: { verdict: HttpVerdict; pages: BotHttpResult[] };
  /** Worst of robots + HTTP + meta directives. */
  overall: "allowed" | "partial" | "blocked" | "unknown";
  metaBlocked: boolean;
};

export type PageCheck = {
  url: string;
  finalUrl: string | null;
  status: number | null;
  hops: Array<{ url: string; status: number }>;
  ttfbMs: number | null;
  bytes: number;
  contentEncoding: string | null;
  contentType: string | null;
  xRobotsTag: string | null;
  headerCanonical: string | null;
  signals: HtmlSignals | null;
  directives: DirectiveHit[];
  canonical: { href: string | null; resolved: string | null; self: boolean | null; conflict: boolean };
  error: string | null;
};

export type LlmsFileCheck = {
  url: string;
  present: boolean;
  status: number | null;
  contentType: string | null;
  bytes: number;
  validation: LlmsValidation | null;
  preview: string | null;
};

export type FindingSeverity = "critical" | "warning" | "info" | "pass";
export type FindingCategory = "robots" | "bots" | "llms" | "meta" | "rendering" | "sitemap" | "structured-data" | "canonical" | "performance";

export type Finding = {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  description: string;
  fix?: string;
  snippet?: { language: "robots" | "markdown" | "html" | "text" | "http"; code: string; filename?: string };
  affected?: string[];
};

export type CategoryScore = { key: FindingCategory; label: string; score: number; max: number };

export type CrawlabilityResult = {
  version: 1;
  origin: string;
  checkedAt: string;
  robots: {
    url: string;
    status: number | null;
    found: boolean;
    bytes: number;
    contentType: string | null;
    error: string | null;
    sitemaps: string[];
    groupCount: number;
    warnings: Array<{ line: number; message: string }>;
    raw: string | null;
    /** RFC 9309: 5xx → crawlers must assume full disallow. */
    unreachable: boolean;
  };
  bots: BotResult[];
  pages: PageCheck[];
  browserBlocked: boolean;
  llms: { txt: LlmsFileCheck; full: LlmsFileCheck };
  sitemap: { found: boolean; docs: SitemapDocResult[]; totalUrls: number; sampleUrls: string[] };
  categories: CategoryScore[];
  findings: Finding[];
};
