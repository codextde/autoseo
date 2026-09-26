// Schema for the "seo" module (keyword research, saved keywords, domain overview, backlinks,
// rank tracking, local SEO). Owned by the seo module; see docs/ARCHITECTURE.md.
// Ported from open-seo (see docs/research/open-seo-inventory.md §19).
import { sql } from "drizzle-orm";
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
} from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, ts } from "./_helpers";
import { projects, users } from "./core";

export type SeoMonthlySearch = { year: number; month: number; searchVolume: number };

/* ───────────────────────────── Keyword metrics ───────────────────────────── */

/** Latest metrics per (project, keyword, location, language). Acts as a metrics cache. */
export const seoKeywordMetrics = pgTable(
  "seo_keyword_metrics",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyword: text().notNull(),
    locationCode: integer().notNull(),
    languageCode: text().notNull().default("en"),
    searchVolume: integer(),
    cpc: doublePrecision(),
    /** 0-1 paid-search competition ratio. */
    competition: doublePrecision(),
    keywordDifficulty: integer(),
    intent: text(),
    monthlySearches: jsonb().$type<SeoMonthlySearch[]>().notNull().default([]),
    fetchedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("seo_keyword_metrics_uq").on(t.projectId, t.keyword, t.locationCode, t.languageCode),
    index("seo_keyword_metrics_fetched_idx").on(t.projectId, t.fetchedAt),
  ],
);

/* ───────────────────────────── Saved keywords ───────────────────────────── */

export const seoSavedKeywords = pgTable(
  "seo_saved_keywords",
  {
    id: id("skw"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyword: text().notNull(),
    locationCode: integer().notNull().default(2840),
    languageCode: text().notNull().default("en"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("seo_saved_keywords_uq").on(t.projectId, t.keyword, t.locationCode, t.languageCode),
    index("seo_saved_keywords_project_idx").on(t.projectId, t.createdAt),
  ],
);

/** 8-colour palette keys: slate, rose, amber, lime, emerald, sky, violet, fuchsia (null = derived from id). */
export const seoSavedKeywordTags = pgTable(
  "seo_saved_keyword_tags",
  {
    id: id("skt"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    normalizedName: text().notNull(),
    color: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("seo_saved_keyword_tags_uq").on(t.projectId, t.normalizedName),
    index("seo_saved_keyword_tags_name_idx").on(t.projectId, t.name),
  ],
);

export const seoSavedKeywordTagAssignments = pgTable(
  "seo_kw_tag_links",
  {
    savedKeywordId: text()
      .notNull()
      .references(() => seoSavedKeywords.id, { onDelete: "cascade" }),
    tagId: text()
      .notNull()
      .references(() => seoSavedKeywordTags.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.savedKeywordId, t.tagId] }), index("seo_kw_tag_links_tag_idx").on(t.tagId)],
);

/* ───────────────────────────── Result cache (replaces R2) ───────────────────────────── */

/** DataForSEO response cache with a soft TTL. `projectId` null = instance-wide (e.g. SERP location lists). */
export const seoCache = pgTable(
  "seo_cache",
  {
    key: text().primaryKey(),
    namespace: text().notNull(),
    projectId: text().references(() => projects.id, { onDelete: "cascade" }),
    value: jsonb().$type<unknown>().notNull(),
    expiresAt: ts().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("seo_cache_expires_idx").on(t.expiresAt), index("seo_cache_project_idx").on(t.projectId, t.namespace)],
);

/* ───────────────────────────── Search history ───────────────────────────── */

/** "Recent searches" per project + user for keyword research, domain overview and backlinks. */
export const seoSearchHistory = pgTable(
  "seo_search_history",
  {
    id: id("ssh"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feature: text({ enum: ["keywords", "domain", "backlinks"] }).notNull(),
    dedupeKey: text().notNull(),
    label: text().notNull(),
    params: jsonb().$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("seo_search_history_uq").on(t.projectId, t.userId, t.feature, t.dedupeKey),
    index("seo_search_history_list_idx").on(t.projectId, t.userId, t.feature, t.createdAt),
  ],
);

/* ───────────────────────────── Rank tracking ───────────────────────────── */

export const seoRankConfigs = pgTable(
  "seo_rank_configs",
  {
    id: id("rkc"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Normalized bare host (lowercase, no protocol/path/www). */
    domain: text().notNull(),
    locationCode: integer().notNull().default(2840),
    languageCode: text().notNull().default("en"),
    /** Canonical DataForSEO location_name for local (city) targeting; null = national. */
    locationName: text(),
    devices: text({ enum: ["both", "desktop", "mobile"] })
      .notNull()
      .default("both"),
    serpDepth: integer().notNull().default(40),
    scheduleInterval: text({ enum: ["daily", "weekly", "monthly", "manual"] })
      .notNull()
      .default("weekly"),
    isActive: boolean().notNull().default(true),
    lastCheckedAt: ts(),
    nextCheckAt: ts(),
    /** no_keywords | insufficient_credits | budget_exceeded */
    lastSkipReason: text(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("seo_rank_configs_project_idx").on(t.projectId, t.isActive, t.createdAt),
    index("seo_rank_configs_due_idx").on(t.isActive, t.nextCheckAt),
    uniqueIndex("seo_rank_configs_national_uq")
      .on(t.projectId, t.domain, t.locationCode)
      .where(sql`location_name IS NULL`),
    uniqueIndex("seo_rank_configs_local_uq")
      .on(t.projectId, t.domain, t.locationCode, t.locationName)
      .where(sql`location_name IS NOT NULL`),
  ],
);

export const seoRankKeywords = pgTable(
  "seo_rank_keywords",
  {
    id: id("rkk"),
    configId: text()
      .notNull()
      .references(() => seoRankConfigs.id, { onDelete: "cascade" }),
    /** Lowercased unless matchCase. */
    keyword: text().notNull(),
    matchCase: boolean().notNull().default(false),
    searchVolume: integer(),
    keywordDifficulty: integer(),
    cpc: doublePrecision(),
    metricsFetchedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("seo_rank_keywords_uq").on(t.configId, t.keyword)],
);

export type SeoRankRunStats = {
  queueTasks?: number;
  queueCollected?: number;
  fallbackTasks?: number;
  fallbackChecked?: number;
  /** Live path: keywords already claimed (a crash never re-bills a claimed batch). */
  liveCursor?: number;
};

export const seoRankRuns = pgTable(
  "seo_rank_runs",
  {
    id: id("rkr"),
    configId: text()
      .notNull()
      .references(() => seoRankConfigs.id, { onDelete: "cascade" }),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text({ enum: ["pending", "running", "completed", "failed"] })
      .notNull()
      .default("pending"),
    trigger: text({ enum: ["manual", "scheduled"] })
      .notNull()
      .default("manual"),
    /** live = /live/advanced per keyword; queued = task_post + task_get polling. */
    method: text({ enum: ["live", "queued"] })
      .notNull()
      .default("live"),
    /** Engine phase: prepare → live | post → collect → fallback → finalize. */
    phase: text().notNull().default("prepare"),
    collectRound: integer().notNull().default(0),
    keywordsTotal: integer().notNull().default(0),
    keywordsChecked: integer().notNull().default(0),
    isSubsetRun: boolean().notNull().default(false),
    keywordIds: jsonb().$type<string[]>(),
    errorMessage: text(),
    jobId: text(),
    costUsd: doublePrecision().notNull().default(0),
    stats: jsonb().$type<SeoRankRunStats>().notNull().default({}),
    startedAt: ts().notNull().defaultNow(),
    completedAt: ts(),
  },
  (t) => [
    index("seo_rank_runs_config_idx").on(t.configId, t.startedAt),
    index("seo_rank_runs_project_idx").on(t.projectId, t.startedAt),
    uniqueIndex("seo_rank_runs_one_active_uq")
      .on(t.configId)
      .where(sql`status IN ('pending', 'running')`),
  ],
);

export const seoRankSnapshots = pgTable(
  "seo_rank_snapshots",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    runId: text()
      .notNull()
      .references(() => seoRankRuns.id, { onDelete: "cascade" }),
    /** Intentionally no FK — history survives keyword removal. */
    trackingKeywordId: text().notNull(),
    keyword: text().notNull(),
    device: text({ enum: ["desktop", "mobile"] }).notNull(),
    /** null = not found within the tracked depth. */
    position: integer(),
    url: text(),
    serpFeatures: jsonb().$type<string[]>().notNull().default([]),
    checkedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index("seo_rank_snapshots_kw_idx").on(t.trackingKeywordId, t.device, t.checkedAt),
    uniqueIndex("seo_rank_snapshots_uq").on(t.runId, t.trackingKeywordId, t.device),
  ],
);

/** Queued (task_post) SERP tasks of a scheduled run, collected via tasks_ready / task_get. */
export const seoRankTasks = pgTable(
  "seo_rank_tasks",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    runId: text()
      .notNull()
      .references(() => seoRankRuns.id, { onDelete: "cascade" }),
    trackingKeywordId: text().notNull(),
    keyword: text().notNull(),
    device: text({ enum: ["desktop", "mobile"] }).notNull(),
    /** DataForSEO task id (null when the post was rejected → live fallback). */
    taskId: text(),
    status: text({ enum: ["pending", "completed", "failed", "fallback"] })
      .notNull()
      .default("pending"),
    message: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("seo_rank_tasks_run_idx").on(t.runId, t.status),
    uniqueIndex("seo_rank_tasks_uq").on(t.runId, t.trackingKeywordId, t.device),
  ],
);

/* ───────────────────────────── Local SEO ───────────────────────────── */

export const SEO_LOCAL_TOOLS = [
  "business_search",
  "local_serp",
  "rank_grid",
  "business_profile",
  "reviews",
  "questions",
  "posts",
  "categories",
] as const;
export type SeoLocalTool = (typeof SEO_LOCAL_TOOLS)[number];

/** One execution of a Local SEO tool (history per project). Results stored as JSON. */
export const seoLocalRuns = pgTable(
  "seo_local_runs",
  {
    id: id("slr"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tool: text({ enum: SEO_LOCAL_TOOLS }).notNull(),
    label: text().notNull(),
    input: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** queued → running → (processing: waiting on a DataForSEO task) → completed | failed */
    status: text({ enum: ["queued", "running", "processing", "completed", "failed"] })
      .notNull()
      .default("queued"),
    result: jsonb().$type<unknown>(),
    error: text(),
    /** Queued DataForSEO task (reviews/posts), collected for free via task_get. */
    taskId: text(),
    taskEndpoint: text(),
    collectAttempts: integer().notNull().default(0),
    costUsd: doublePrecision().notNull().default(0),
    jobId: text(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    completedAt: ts(),
  },
  (t) => [index("seo_local_runs_project_idx").on(t.projectId, t.tool, t.createdAt)],
);
