// Schema for the "optimize" module (Tasks, Content, Fact Check). Owned by that module; see docs/ARCHITECTURE.md.
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
  date,
} from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, ts } from "./_helpers";
import { projects, users } from "./core";

/* ─────────────────────────────── Shared ─────────────────────────────── */

export const TASK_CATEGORIES = [
  "technical",
  "content",
  "visibility",
  "competitor",
  "offsite",
  "reputation",
  "setup",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_STATUSES = ["open", "in_progress", "done", "dismissed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Generator / fact-check runs (for "last analyzed" and history). */
export const optimizeRuns = pgTable(
  "optimize_runs",
  {
    id: id("opr"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text({ enum: ["tasks", "fact_check"] }).notNull(),
    trigger: text({ enum: ["schedule", "manual", "tracking", "api"] })
      .notNull()
      .default("manual"),
    status: text({ enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    stats: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    error: text(),
    startedAt: ts().notNull().defaultNow(),
    finishedAt: ts(),
  },
  (t) => [index("optimize_runs_project_idx").on(t.projectId, t.kind, t.startedAt)],
);

/** Per-project settings for the optimize module (routing by category, automation). */
export type TaskRoutingRule = { assigneeId?: string | null; provider?: string | null; autoPush?: boolean };
export const optimizeSettings = pgTable("optimize_settings", {
  projectId: text()
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** category → default assignee / PM tool */
  routing: jsonb().$type<Partial<Record<TaskCategory, TaskRoutingRule>>>().notNull().default({}),
  autoResolve: boolean().notNull().default(true),
  /** Send webhook events for task changes (when the webhook integration is connected). */
  webhookEvents: boolean().notNull().default(true),
  updatedAt: updatedAt(),
});

/* ─────────────────────────────── Tasks ─────────────────────────────── */

export type TaskEvidence = {
  /** Visual kind for the detail page */
  kind: "metric" | "engines" | "prompts" | "sources" | "quotes" | "pages" | "competitors" | "issues" | "queries" | "note";
  label: string;
  /** Short value e.g. "0 / 12 answers" */
  value?: string;
  description?: string;
  items?: Array<{
    label: string;
    value?: string | number | null;
    href?: string | null;
    engine?: string | null;
    detail?: string | null;
    good?: boolean | null;
  }>;
  /** Simple series for mini charts */
  chart?: Array<{ label: string; value: number; compare?: number | null }>;
};

export type TaskStep = { id: string; text: string; done: boolean };

export type TaskContentPlan = {
  format?: string;
  workingTitle?: string;
  targetPrompt?: string;
  targetKeyword?: string;
  wordCount?: number;
  outline?: string[];
  questions?: string[];
  entities?: string[];
  schemaTypes?: string[];
  notes?: string;
};

export type TaskExternalLink = {
  provider: string;
  externalId: string;
  url?: string | null;
  status?: string | null;
  pushedAt: string;
  syncedAt?: string | null;
};

export const optimizeTasks = pgTable(
  "optimize_tasks",
  {
    id: id("tsk"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Stable hash of (signal, subject) so re-analysis updates instead of duplicating. */
    fingerprint: text().notNull(),
    /** Signal provider key that produced the task (or "manual"). */
    signal: text().notNull(),
    category: text({ enum: TASK_CATEGORIES }).notNull(),
    title: text().notNull(),
    summary: text().notNull().default(""),
    /** Markdown */
    description: text().notNull().default(""),
    steps: jsonb().$type<TaskStep[]>().notNull().default([]),
    acceptanceCriteria: jsonb().$type<string[]>().notNull().default([]),
    contentPlan: jsonb().$type<TaskContentPlan | null>(),
    targetUrls: jsonb().$type<string[]>().notNull().default([]),
    targetPrompts: jsonb().$type<string[]>().notNull().default([]),
    evidence: jsonb().$type<TaskEvidence[]>().notNull().default([]),
    /** Raw signal data (input for the writer + change detection). */
    signalData: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    signalHash: text(),
    /** Hash of signal data the current texts were written from (skip re-writing). */
    writtenHash: text(),
    writtenBy: text({ enum: ["ai", "template", "user"] })
      .notNull()
      .default("template"),
    impact: integer().notNull().default(5),
    effort: integer().notNull().default(5),
    priority: doublePrecision().notNull().default(0),
    status: text({ enum: TASK_STATUSES }).notNull().default("open"),
    resolution: text({ enum: ["manual", "auto"] }),
    autoResolvable: boolean().notNull().default(true),
    /** Signal still present at the last analysis */
    signalActive: boolean().notNull().default(true),
    assigneeId: text().references(() => users.id, { onDelete: "set null" }),
    dueDate: date({ mode: "string" }),
    external: jsonb().$type<TaskExternalLink[]>().notNull().default([]),
    source: text({ enum: ["generator", "manual"] })
      .notNull()
      .default("generator"),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    firstDetectedAt: ts().notNull().defaultNow(),
    lastDetectedAt: ts().notNull().defaultNow(),
    resolvedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("optimize_tasks_project_fp_uq").on(t.projectId, t.fingerprint),
    index("optimize_tasks_project_status_idx").on(t.projectId, t.status, t.priority),
  ],
);

export const optimizeTaskActivity = pgTable(
  "optimize_task_activity",
  {
    id: id("tac"),
    taskId: text()
      .notNull()
      .references(() => optimizeTasks.id, { onDelete: "cascade" }),
    projectId: text().notNull(),
    userId: text().references(() => users.id, { onDelete: "set null" }),
    kind: text({
      enum: [
        "created",
        "status",
        "assigned",
        "comment",
        "evidence",
        "auto_resolved",
        "reopened",
        "pushed",
        "synced",
        "step",
        "edited",
        "priority",
      ],
    }).notNull(),
    body: text(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("optimize_task_activity_task_idx").on(t.taskId, t.createdAt)],
);

/* ─────────────────────────────── Content ─────────────────────────────── */

export const CONTENT_STATUSES = ["draft", "generating", "in_review", "published", "failed"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export type ContentFaq = { question: string; answer: string };
export type ContentEntity = { name: string; type?: string; sameAs?: string | null; mentions?: number };
export type ContentCitation = { url: string; title?: string | null; note?: string | null };
export type ContentBrief = {
  audience?: string;
  intent?: string;
  angle?: string;
  keyTakeaways?: string[];
  outline?: string[];
  questions?: string[];
  entities?: string[];
  sources?: ContentCitation[];
  wordCount?: number;
  notes?: string;
};
export type PillarScores = Record<string, number>;

export const contentPieces = pgTable(
  "content_pieces",
  {
    id: id("cnt"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text({ enum: ["article", "rewrite"] })
      .notNull()
      .default("article"),
    title: text().notNull(),
    slug: text(),
    status: text({ enum: CONTENT_STATUSES }).notNull().default("draft"),
    targetPrompt: text(),
    targetKeyword: text(),
    topic: text(),
    language: text().notNull().default("en"),
    /** For rewrites: the existing page that was analyzed */
    sourceUrl: text(),
    sourceSnapshot: jsonb().$type<Record<string, unknown> | null>(),
    personaId: text(),
    taskId: text(),
    brief: jsonb().$type<ContentBrief | null>(),
    /** Markdown body */
    body: text().notNull().default(""),
    metaTitle: text(),
    metaDescription: text(),
    /** JSON-LD (stringified, pretty) */
    schemaJsonLd: text(),
    faqs: jsonb().$type<ContentFaq[]>().notNull().default([]),
    entities: jsonb().$type<ContentEntity[]>().notNull().default([]),
    citations: jsonb().$type<ContentCitation[]>().notNull().default([]),
    aeoScore: integer(),
    pillarScores: jsonb().$type<PillarScores>().notNull().default({}),
    /** Score of the original page (rewrites) or first draft — baseline for "improving" */
    baselineScore: integer(),
    wordCount: integer().notNull().default(0),
    publishedUrl: text(),
    publishedAt: ts(),
    publishProvider: text(),
    externalId: text(),
    generationStage: text(),
    error: text(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    updatedBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("content_pieces_project_idx").on(t.projectId, t.updatedAt)],
);

/** Score history for "top improving pages" and trend charts. */
export const contentScoreSnapshots = pgTable(
  "content_score_snapshots",
  {
    id: id("css"),
    contentId: text()
      .notNull()
      .references(() => contentPieces.id, { onDelete: "cascade" }),
    projectId: text().notNull(),
    score: integer().notNull(),
    pillars: jsonb().$type<PillarScores>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("content_score_snapshots_content_idx").on(t.contentId, t.createdAt)],
);

/** Expert persona library (12+ per topic) used to ground drafts in a credible voice. */
export const contentPersonas = pgTable(
  "content_personas",
  {
    id: id("per"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    topic: text().notNull(),
    name: text().notNull(),
    role: text().notNull(),
    expertise: jsonb().$type<string[]>().notNull().default([]),
    bio: text().notNull().default(""),
    voice: text().notNull().default(""),
    credentials: text(),
    source: text({ enum: ["ai", "library", "manual"] })
      .notNull()
      .default("library"),
    createdAt: createdAt(),
  },
  (t) => [index("content_personas_project_topic_idx").on(t.projectId, t.topic)],
);

/* ────────────────────────────── Fact Check ────────────────────────────── */

export type FcMarket = { country: string; regulator: string };

export const fcAssets = pgTable(
  "fc_assets",
  {
    id: id("fca"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    aliases: jsonb().$type<string[]>().notNull().default([]),
    markets: jsonb().$type<FcMarket[]>().notNull().default([]),
    activeIngredient: text(),
    description: text(),
    sourceUrl: text(),
    status: text({ enum: ["active", "paused"] })
      .notNull()
      .default("active"),
    lastCheckedAt: ts(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("fc_assets_project_name_uq").on(t.projectId, t.name)],
);

export type FcSection = { id: string; heading: string; text: string };

/** Reference documents ("the label") statements are compared against. */
export const fcDocuments = pgTable(
  "fc_documents",
  {
    id: id("fcd"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: text()
      .notNull()
      .references(() => fcAssets.id, { onDelete: "cascade" }),
    title: text().notNull(),
    kind: text({ enum: ["pdf", "text", "url"] }).notNull(),
    sourceUrl: text(),
    fileName: text(),
    /** Market the document applies to (null = all markets of the asset) */
    market: text(),
    version: text(),
    effectiveDate: date({ mode: "string" }),
    /** Older label version — statements matching only this document are "outdated". */
    superseded: boolean().notNull().default(false),
    /** Stored upload (relative to DATA_DIR) for PDFs */
    filePath: text(),
    text: text().notNull().default(""),
    sections: jsonb().$type<FcSection[]>().notNull().default([]),
    charCount: integer().notNull().default(0),
    status: text({ enum: ["processing", "ready", "failed"] })
      .notNull()
      .default("processing"),
    error: text(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("fc_documents_asset_idx").on(t.assetId)],
);

export const FC_VERDICTS = [
  "pending",
  "matched",
  "contradicted",
  "unsupported",
  "outdated",
  "off_label",
  "needs_review",
] as const;
export type FcVerdict = (typeof FC_VERDICTS)[number];
export const FC_DEVIATIONS = ["off_label", "contradicted", "unsupported", "outdated"] as const;

/** A statement about an asset extracted from AI answers and judged against the label. */
export const fcStatements = pgTable(
  "fc_statements",
  {
    id: id("fcs"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: text()
      .notNull()
      .references(() => fcAssets.id, { onDelete: "cascade" }),
    /** sha256(assetId + normalized claim + engine + market) — repeated sightings increment seenCount */
    hash: text().notNull(),
    claim: text().notNull(),
    engine: text().notNull(),
    market: text().notNull(),
    promptId: text(),
    /** Latest answer the statement was seen in */
    answerId: text(),
    answerQuote: text(),
    verdict: text({ enum: FC_VERDICTS }).notNull().default("pending"),
    severity: text({ enum: ["critical", "major", "minor"] }),
    labelSection: text(),
    labelQuote: text(),
    documentId: text(),
    explanation: text(),
    matchScore: doublePrecision(),
    judgedBy: text({ enum: ["ai", "lexical", "user"] }),
    status: text({ enum: ["open", "resolved", "ignored"] })
      .notNull()
      .default("open"),
    seenCount: integer().notNull().default(1),
    firstSeenAt: ts().notNull().defaultNow(),
    lastSeenAt: ts().notNull().defaultNow(),
    checkedAt: ts(),
    resolvedAt: ts(),
    resolvedBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("fc_statements_hash_uq").on(t.projectId, t.hash),
    index("fc_statements_asset_idx").on(t.assetId, t.verdict),
    index("fc_statements_project_seen_idx").on(t.projectId, t.lastSeenAt),
  ],
);

/** Which answers were already scanned for which asset. */
export const fcAnswerChecks = pgTable(
  "fc_answer_checks",
  {
    assetId: text()
      .notNull()
      .references(() => fcAssets.id, { onDelete: "cascade" }),
    answerId: text().notNull(),
    projectId: text().notNull(),
    statements: integer().notNull().default(0),
    checkedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.answerId] })],
);
