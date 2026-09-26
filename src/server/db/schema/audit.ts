// Schema for the "audit" module (Site Audit, Lighthouse, Crawlability). Owned by that module; see docs/ARCHITECTURE.md.
import {
  pgTable,
  text,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
  doublePrecision,
  primaryKey,
  bigserial,
} from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, ts } from "./_helpers";
import { projects, users } from "./core";

/* ───────────────────────────── Site audits ───────────────────────────── */

export type SiteAuditConfig = {
  maxPages: number;
  /** "auto" = sampled Lighthouse (≤10 URLs × mobile/desktop), "none" = skip. */
  lighthouseStrategy: "auto" | "none";
  /** PageSpeed Insights (free) or DataForSEO On-Page Lighthouse (billed). */
  lighthouseProvider: "psi" | "dataforseo";
  /** Max parallel fetches (from Admin → Limits at start time). */
  concurrency: number;
};

export type CrawlThrottleState = {
  intervalMs: number;
  nextRequestAt: number;
  pausedUntil: number;
  consecutiveRateLimits: number;
  cooldownMs: number;
};

export type SiteAuditIssueCounts = { critical: number; warning: number; info: number; total: number; types: number };

export const siteAudits = pgTable(
  "site_audits",
  {
    id: id("sau"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    startUrl: text().notNull(),
    status: text({ enum: ["queued", "running", "completed", "failed", "cancelled"] })
      .notNull()
      .default("queued"),
    currentPhase: text({ enum: ["queued", "discovery", "crawling", "lighthouse", "finalizing", "completed", "failed"] })
      .notNull()
      .default("queued"),
    trigger: text({ enum: ["manual", "scheduled", "api", "mcp"] })
      .notNull()
      .default("manual"),
    config: jsonb().$type<SiteAuditConfig>().notNull(),
    pagesCrawled: integer().notNull().default(0),
    pagesTotal: integer().notNull().default(0),
    lighthouseTotal: integer().notNull().default(0),
    lighthouseCompleted: integer().notNull().default(0),
    lighthouseFailed: integer().notNull().default(0),
    /** 0–100 site health score (computed at finalize). */
    score: integer(),
    issueCounts: jsonb().$type<SiteAuditIssueCounts>(),
    avgResponseMs: integer(),
    /** Frontier exhausted (gates orphan detection). */
    crawlCompleted: boolean().notNull().default(false),
    rateLimited: boolean().notNull().default(false),
    /** Raw robots.txt checkpoint (null = missing → allow all). */
    robotsTxt: text(),
    robotsFetched: boolean().notNull().default(false),
    throttleState: jsonb().$type<CrawlThrottleState>(),
    /** Last crawl-window size (carried across chunks). */
    windowHint: integer(),
    /** Chunk counter for continuation jobs. */
    chunkNo: integer().notNull().default(0),
    /** Consecutive chunks without any fetched page (frontier unservable). */
    idleChunks: integer().notNull().default(0),
    /** Runner lease: prevents two workers from driving the same audit. */
    runnerId: text(),
    heartbeatAt: ts(),
    /** How often the watchdog resumed the audit after a lost worker. */
    resumeCount: integer().notNull().default(0),
    /** User asked to stop: the runner skips the remaining crawl/Lighthouse and finalizes. */
    stopRequested: boolean().notNull().default(false),
    errorCode: text(),
    errorDetail: text(),
    failedPhase: text(),
    scheduleId: text(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    startedAt: ts().notNull().defaultNow(),
    completedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("site_audits_project_idx").on(t.projectId, t.startedAt),
    index("site_audits_status_idx").on(t.status, t.heartbeatAt),
  ],
);

/** Postgres-backed crawl frontier (replaces open-seo's per-audit Durable Object). */
export const siteAuditFrontier = pgTable(
  "site_audit_frontier",
  {
    auditId: text()
      .notNull()
      .references(() => siteAudits.id, { onDelete: "cascade" }),
    url: text().notNull(),
    /** Clicks from the start URL; null = only known from the sitemap. */
    depth: integer(),
    source: text({ enum: ["link", "sitemap"] }).notNull(),
    inSitemap: boolean().notNull().default(false),
    state: text({ enum: ["pending", "leased", "crawled"] })
      .notNull()
      .default("pending"),
    seq: bigserial({ mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.auditId, t.url] }),
    index("site_audit_frontier_claim_idx").on(t.auditId, t.state, t.source, t.seq),
  ],
);

export type AuditImage = { src: string | null; alt: string | null };

export const siteAuditPages = pgTable(
  "site_audit_pages",
  {
    /** Deterministic: sha256(auditId|url)[0:36] → idempotent upserts. */
    id: text().primaryKey(),
    auditId: text()
      .notNull()
      .references(() => siteAudits.id, { onDelete: "cascade" }),
    url: text().notNull(),
    statusCode: integer(),
    fetchClass: text({ enum: ["ok", "blocked", "rate_limited", "error"] })
      .notNull()
      .default("ok"),
    redirectUrl: text(),
    contentType: text(),
    title: text(),
    metaDescription: text(),
    canonicalUrl: text(),
    robotsMeta: text(),
    xRobotsTag: text(),
    headerCanonicalUrl: text(),
    ogTitle: text(),
    ogDescription: text(),
    ogImage: text(),
    h1Count: integer().notNull().default(0),
    h2Count: integer().notNull().default(0),
    h3Count: integer().notNull().default(0),
    h4Count: integer().notNull().default(0),
    h5Count: integer().notNull().default(0),
    h6Count: integer().notNull().default(0),
    h1s: jsonb().$type<string[]>().notNull().default([]),
    headingOrder: jsonb().$type<number[]>().notNull().default([]),
    wordCount: integer().notNull().default(0),
    contentHash: text(),
    htmlBytes: integer().notNull().default(0),
    imagesTotal: integer().notNull().default(0),
    imagesMissingAlt: integer().notNull().default(0),
    images: jsonb().$type<AuditImage[]>().notNull().default([]),
    internalLinkCount: integer().notNull().default(0),
    externalLinkCount: integer().notNull().default(0),
    /** Inbound internal links from other crawled pages (computed at finalize). */
    inlinkCount: integer(),
    hasStructuredData: boolean().notNull().default(false),
    structuredDataTypes: jsonb().$type<string[]>().notNull().default([]),
    hreflangTags: jsonb().$type<string[]>().notNull().default([]),
    lang: text(),
    isIndexable: boolean().notNull().default(false),
    crawlDepth: integer(),
    inSitemap: boolean().notNull().default(false),
    responseTimeMs: integer().notNull().default(0),
    /** Per-page health (0–100) computed at finalize. */
    score: integer(),
    issueCount: integer().notNull().default(0),
    crawledAt: ts().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("site_audit_pages_url_uq").on(t.auditId, t.url),
    index("site_audit_pages_crawled_idx").on(t.auditId, t.crawledAt),
  ],
);

export type AuditLink = {
  /** target URL (normalized) */
  u: string;
  /** anchor text */
  a: string | null;
  /** internal (same site) */
  i: boolean;
  /** rel=nofollow */
  n: boolean;
};

/** Outgoing link edges per page (capped at 500) — used for broken-link / orphan checks and page detail. */
export const siteAuditPageLinks = pgTable(
  "site_audit_page_links",
  {
    pageId: text()
      .primaryKey()
      .references(() => siteAuditPages.id, { onDelete: "cascade" }),
    auditId: text()
      .notNull()
      .references(() => siteAudits.id, { onDelete: "cascade" }),
    links: jsonb().$type<AuditLink[]>().notNull().default([]),
  },
  (t) => [index("site_audit_page_links_audit_idx").on(t.auditId)],
);

export const siteAuditIssues = pgTable(
  "site_audit_issues",
  {
    /** Deterministic: sha256(auditId|pageUrl|issueType|dedupeKey)[0:36]. */
    id: text().primaryKey(),
    auditId: text()
      .notNull()
      .references(() => siteAudits.id, { onDelete: "cascade" }),
    pageId: text(),
    pageUrl: text().notNull(),
    issueType: text().notNull(),
    severity: text({ enum: ["critical", "warning", "info"] }).notNull(),
    category: text().notNull(),
    details: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("site_audit_issues_type_idx").on(t.auditId, t.issueType),
    index("site_audit_issues_page_idx").on(t.auditId, t.pageId),
  ],
);

export const siteAuditLighthouse = pgTable(
  "site_audit_lighthouse",
  {
    /** Deterministic: sha256(auditId|url|strategy)[0:36]. */
    id: text().primaryKey(),
    auditId: text()
      .notNull()
      .references(() => siteAudits.id, { onDelete: "cascade" }),
    pageId: text(),
    url: text().notNull(),
    strategy: text({ enum: ["mobile", "desktop"] }).notNull(),
    provider: text({ enum: ["psi", "dataforseo"] }).notNull(),
    /** pending → running → done | failed. A "running" row is never re-run for billed providers. */
    status: text({ enum: ["pending", "running", "done", "failed"] })
      .notNull()
      .default("pending"),
    performanceScore: integer(),
    accessibilityScore: integer(),
    bestPracticesScore: integer(),
    seoScore: integer(),
    lcpMs: doublePrecision(),
    cls: doublePrecision(),
    inpMs: doublePrecision(),
    ttfbMs: doublePrecision(),
    errorMessage: text(),
    /** Compact stored payload (v2) — scores, metrics, issues. */
    payload: jsonb().$type<Record<string, unknown>>(),
    payloadSizeBytes: integer(),
    costUsd: doublePrecision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("site_audit_lighthouse_audit_idx").on(t.auditId, t.status)],
);

/* ───────────────────────────── Schedules ───────────────────────────── */

export type AuditScheduleConfig = {
  startUrl?: string;
  maxPages?: number;
  lighthouse?: boolean;
  lighthouseProvider?: "psi" | "dataforseo";
  /** Crawlability: extra URLs to check. */
  urls?: string[];
  /** Notify when the score drops by at least this many points (0 = off). */
  dropThreshold?: number;
  /** Extra recipients (the creator is always notified). */
  emails?: string[];
};

/** Recurring re-audits (site audit) and crawlability checks per project. */
export const auditSchedules = pgTable(
  "audit_schedules",
  {
    id: id("asc"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text({ enum: ["site_audit", "crawlability"] }).notNull(),
    enabled: boolean().notNull().default(true),
    frequency: text({ enum: ["weekly", "monthly"] })
      .notNull()
      .default("weekly"),
    config: jsonb().$type<AuditScheduleConfig>().notNull().default({}),
    nextRunAt: ts().notNull(),
    lastRunAt: ts(),
    lastRunId: text(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("audit_schedules_project_kind_uq").on(t.projectId, t.kind), index("audit_schedules_due_idx").on(t.enabled, t.nextRunAt)],
);

/* ───────────────────────────── Crawlability (AI crawler access) ───────────────────────────── */

export const crawlabilityChecks = pgTable(
  "crawlability_checks",
  {
    id: id("crw"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text({ enum: ["queued", "running", "completed", "failed"] })
      .notNull()
      .default("queued"),
    trigger: text({ enum: ["manual", "scheduled", "api", "mcp"] })
      .notNull()
      .default("manual"),
    /** Origin that was checked, e.g. https://www.example.com */
    origin: text().notNull(),
    /** Extra URLs requested by the user. */
    urls: jsonb().$type<string[]>().notNull().default([]),
    score: integer(),
    /** Per-category sub-scores. */
    scores: jsonb().$type<Record<string, number>>(),
    /** Full structured result (robots, bots matrix, pages, llms.txt, sitemap, findings…). */
    result: jsonb().$type<Record<string, unknown>>(),
    progress: jsonb().$type<{ step: string; done: number; total: number }>(),
    /** Generated llms.txt draft (deterministic or AI). */
    llmsTxtDraft: text(),
    llmsTxtDraftSource: text({ enum: ["template", "ai"] }),
    llmsTxtStatus: text({ enum: ["idle", "running", "failed"] })
      .notNull()
      .default("idle"),
    llmsTxtError: text(),
    error: text(),
    scheduleId: text(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    startedAt: ts(),
    completedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("crawlability_checks_project_idx").on(t.projectId, t.createdAt)],
);
