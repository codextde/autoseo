// Schema for the "analytics" module. Owned by that module; see docs/ARCHITECTURE.md.
import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  doublePrecision,
  date,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, ts } from "./_helpers";
import { projects, users, workspaces } from "./core";

/* ───────────────────────────── Search Console (Google + Bing) ───────────────────────────── */

export type SearchSource = "google" | "bing";

/**
 * Daily totals per search source (dimension `date` only — includes anonymized queries, so these
 * are the "true" totals shown in the KPI tiles and chart). Kept for 16 months.
 */
export const scDaily = pgTable(
  "analytics_sc_daily",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: text({ enum: ["google", "bing"] }).notNull(),
    date: date({ mode: "string" }).notNull(),
    clicks: integer().notNull().default(0),
    impressions: integer().notNull().default(0),
    /** Impression-weighted average position. */
    position: doublePrecision(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.source, t.date] })],
);

/**
 * Query × country rows per day (Google: dimensions [date, query, country]; Bing: country "").
 * Rows of a day are replaced on every sync (delete + insert), so no unique key is needed.
 */
export const scQueries = pgTable(
  "analytics_sc_queries",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: text({ enum: ["google", "bing"] }).notNull(),
    date: date({ mode: "string" }).notNull(),
    query: text().notNull(),
    /** ISO 3166-1 alpha-2 (upper case), "" when the source has no country dimension. */
    country: text().notNull().default(""),
    clicks: integer().notNull().default(0),
    impressions: integer().notNull().default(0),
    position: doublePrecision(),
  },
  (t) => [index("analytics_sc_queries_idx").on(t.projectId, t.source, t.date)],
);

/** Page × query rows per day (Google: [date, page, query]; Bing: page stats with query ""). */
export const scPages = pgTable(
  "analytics_sc_pages",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: text({ enum: ["google", "bing"] }).notNull(),
    date: date({ mode: "string" }).notNull(),
    page: text().notNull(),
    query: text().notNull().default(""),
    clicks: integer().notNull().default(0),
    impressions: integer().notNull().default(0),
    position: doublePrecision(),
  },
  (t) => [index("analytics_sc_pages_idx").on(t.projectId, t.source, t.date)],
);

/** Intent labels for search queries (heuristic by default, refined by LLM on demand). */
export const scQueryIntents = pgTable(
  "analytics_sc_query_intents",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    query: text().notNull(),
    intent: text({ enum: ["recommend", "information", "comparison", "action"] }).notNull(),
    isPrompt: boolean().notNull().default(false),
    source: text({ enum: ["heuristic", "llm", "manual"] })
      .notNull()
      .default("llm"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.query] })],
);

/* ───────────────────────────── Human traffic (GA4 / Matomo / Piwik PRO) ───────────────────────────── */

export type TrafficProvider = "google_analytics" | "matomo" | "piwik_pro";

/**
 * Normalized AI-referred sessions per day × AI platform × landing page × country.
 * Only sessions classified as coming from an AI platform are stored here.
 */
export const trafficRows = pgTable(
  "analytics_traffic_rows",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: text({ enum: ["google_analytics", "matomo", "piwik_pro"] }).notNull(),
    date: date({ mode: "string" }).notNull(),
    /** AI platform id (see server/analytics/ai-platforms). */
    platform: text().notNull(),
    /** Landing page path (+ host when multiple hosts), "" when unknown. */
    page: text().notNull().default(""),
    /** ISO alpha-2 upper case, "" when unknown. */
    country: text().notNull().default(""),
    sessions: integer().notNull().default(0),
    engagedSessions: integer().notNull().default(0),
    /** Sessions with at least one conversion/key event (may be fractional when derived from rates). */
    convertedSessions: doublePrecision().notNull().default(0),
    conversions: doublePrecision().notNull().default(0),
    revenue: doublePrecision().notNull().default(0),
    /** Total engagement time in seconds (avg time = engagementSeconds / sessions). */
    engagementSeconds: doublePrecision().notNull().default(0),
    users: integer().notNull().default(0),
  },
  (t) => [index("analytics_traffic_rows_idx").on(t.projectId, t.provider, t.date)],
);

/** All-traffic daily totals (context for the AI share of sessions). */
export const trafficDaily = pgTable(
  "analytics_traffic_daily",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: text({ enum: ["google_analytics", "matomo", "piwik_pro"] }).notNull(),
    date: date({ mode: "string" }).notNull(),
    sessions: integer().notNull().default(0),
    conversions: doublePrecision().notNull().default(0),
    revenue: doublePrecision().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.provider, t.date] })],
);

/* ───────────────────────────── Bot traffic (server logs / CDN) ───────────────────────────── */

export type BotVisitSource = "upload" | "api" | "cloudflare" | "akamai";

/** One row per identified bot request. Deduplicated on bot + timestamp + IP + path. */
export const botVisits = pgTable(
  "analytics_bot_visits",
  {
    id: id("bvt"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Bot token from AI_BOTS (e.g. GPTBot). */
    bot: text().notNull(),
    company: text(),
    ts: ts().notNull(),
    ip: text(),
    host: text(),
    path: text().notNull(),
    method: text(),
    status: integer(),
    userAgent: text(),
    bytes: bigint({ mode: "number" }),
    /** true = IP inside the provider's published ranges, false = outside, null = not verifiable. */
    verified: boolean(),
    source: text({ enum: ["upload", "api", "cloudflare", "akamai"] })
      .notNull()
      .default("api"),
    uploadId: text(),
    /** sha1(bot|timestamp|ip|path) */
    dedupeKey: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("analytics_bot_visits_dedupe_uq").on(t.projectId, t.dedupeKey),
    index("analytics_bot_visits_ts_idx").on(t.projectId, t.ts),
    index("analytics_bot_visits_path_idx").on(t.projectId, t.path),
  ],
);

/** Uploaded log files (chunked upload → parse inline ≤ 50 MB, otherwise as a background job). */
export const logUploads = pgTable(
  "analytics_log_uploads",
  {
    id: id("lup"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filename: text().notNull(),
    sizeBytes: bigint({ mode: "number" }).notNull().default(0),
    receivedBytes: bigint({ mode: "number" }).notNull().default(0),
    /** auto | nginx | apache | cloudflare | ndjson | custom */
    format: text().notNull().default("auto"),
    detectedFormat: text(),
    status: text({ enum: ["uploading", "queued", "processing", "completed", "failed"] })
      .notNull()
      .default("uploading"),
    totalLines: integer().notNull().default(0),
    parsedLines: integer().notNull().default(0),
    invalidLines: integer().notNull().default(0),
    botVisits: integer().notNull().default(0),
    saved: integer().notNull().default(0),
    error: text(),
    jobId: text(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: ts(),
  },
  (t) => [index("analytics_log_uploads_project_idx").on(t.projectId, t.createdAt)],
);

/** Cached published IP ranges of crawler operators (OpenAI, Google, Anthropic, Perplexity, Bing…). */
export const botIpRanges = pgTable("analytics_bot_ip_ranges", {
  /** Range list key, e.g. openai-gptbot, google-crawlers, bingbot */
  key: text().primaryKey(),
  url: text().notNull(),
  prefixes: jsonb().$type<string[]>().notNull().default([]),
  fetchedAt: ts(),
  error: text(),
  updatedAt: updatedAt(),
});

/** Per-token ingest counters (requests/lines received per day) for the Sync tab. */
export const logIngestStats = pgTable(
  "analytics_log_ingest_stats",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: text({ enum: ["upload", "api", "cloudflare", "akamai"] }).notNull(),
    date: date({ mode: "string" }).notNull(),
    requests: integer().notNull().default(0),
    lines: integer().notNull().default(0),
    botVisits: integer().notNull().default(0),
    saved: integer().notNull().default(0),
    lastReceivedAt: ts(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.source, t.date] })],
);

/* ───────────────────────────── Google accounts (workspace-level) ───────────────────────────── */

/**
 * Google accounts linked to a workspace (open-seo "Google Accounts management"). One OAuth grant per
 * (workspace, Google account); project integrations (GSC / GA4) reference an account via
 * `integrations.config.googleAccountId`. `secret` holds the encrypted refresh/access token.
 */
export const googleAccounts = pgTable(
  "analytics_google_accounts",
  {
    id: id("gac"),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Google account id (OpenID `sub`). */
    sub: text().notNull(),
    email: text(),
    name: text(),
    picture: text(),
    /** Granted OAuth scopes (union of all consents, incl. incremental ones). */
    scopes: jsonb().$type<string[]>().notNull().default([]),
    secret: text(),
    status: text({ enum: ["active", "error", "revoked"] })
      .notNull()
      .default("active"),
    lastError: text(),
    connectedBy: text().references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("analytics_google_accounts_ws_sub_uq").on(t.workspaceId, t.sub)],
);

/* ───────────────────────────── Search Console URL inspection ───────────────────────────── */

/** URL Inspection API results (history + 24 h cache + daily quota accounting per property). */
export const gscInspections = pgTable(
  "analytics_gsc_inspections",
  {
    id: id("gin"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteUrl: text().notNull(),
    url: text().notNull(),
    verdict: text(),
    coverageState: text(),
    result: jsonb().$type<Record<string, unknown>>(),
    error: text(),
    /** false for results served from cache (they do not count against the quota). */
    apiCall: boolean().notNull().default(true),
    inspectedBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("analytics_gsc_inspections_project_idx").on(t.projectId, t.createdAt),
    index("analytics_gsc_inspections_url_idx").on(t.projectId, t.url, t.createdAt),
    index("analytics_gsc_inspections_site_idx").on(t.siteUrl, t.createdAt),
  ],
);
