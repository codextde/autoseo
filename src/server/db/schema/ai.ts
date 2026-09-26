// Schema for the "ai" (AI visibility / GEO) module. See docs/ARCHITECTURE.md.
import {
  pgTable,
  text,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
  doublePrecision,
  date,
  primaryKey,
} from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, ts } from "./_helpers";
import { projects, users } from "./core";

/* ─────────────────────────── Brands & competitors ─────────────────────────── */

/** Competitor brands tracked for a project (the own brand lives on `projects.brand`). */
export const competitors = pgTable(
  "competitors",
  {
    id: id("cmp"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    domain: text(),
    /** Alternative spellings / product lines that count as this brand. */
    aliases: jsonb().$type<string[]>().notNull().default([]),
    logoUrl: text(),
    color: text(),
    /** Part of "My List" (finseo) — false for auto-discovered brands not yet confirmed. */
    tracked: boolean().notNull().default(true),
    source: text({ enum: ["manual", "auto", "import"] })
      .notNull()
      .default("manual"),
    createdAt: createdAt(),
  },
  (t) => [index("competitors_project_idx").on(t.projectId), uniqueIndex("competitors_project_name_uq").on(t.projectId, t.name)],
);

/* ───────────────────────────────── Prompts ───────────────────────────────── */

export const promptTags = pgTable(
  "prompt_tags",
  {
    id: id("tag"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("prompt_tags_project_name_uq").on(t.projectId, t.name)],
);

export type FunnelStage = "tofu" | "mofu" | "bofu";

/** A tracked prompt (question asked to AI engines on a schedule). */
export const prompts = pgTable(
  "prompts",
  {
    id: id("prm"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    text: text().notNull(),
    /** Market (ISO country, "UK" style) the prompt is asked from. */
    country: text().notNull().default("US"),
    language: text().notNull().default("en"),
    status: text({ enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    topic: text(),
    funnelStage: text({ enum: ["tofu", "mofu", "bofu"] }),
    intent: text(),
    persona: text(),
    branded: boolean().notNull().default(false),
    /** Estimated monthly volume of the topic (from prompt research), optional. */
    volume: integer(),
    source: text({ enum: ["manual", "research", "gsc", "import", "generated", "api"] })
      .notNull()
      .default("manual"),
    /** null = use the project's enabled engines */
    engines: jsonb().$type<string[] | null>(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    lastRunAt: ts(),
    archivedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("prompts_project_idx").on(t.projectId, t.status)],
);

export const promptTagLinks = pgTable(
  "prompt_tag_links",
  {
    promptId: text()
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    tagId: text()
      .notNull()
      .references(() => promptTags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.promptId, t.tagId] }), index("prompt_tag_links_tag_idx").on(t.tagId)],
);

/* ───────────────────────────── Runs & answers ───────────────────────────── */

/** One tracking cycle for a project (scheduled daily/weekly or manual). */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: id("run"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    trigger: text({ enum: ["schedule", "manual", "prompt_added", "api"] })
      .notNull()
      .default("schedule"),
    status: text({ enum: ["queued", "running", "completed", "failed", "partial"] })
      .notNull()
      .default("queued"),
    totalTasks: integer().notNull().default(0),
    doneTasks: integer().notNull().default(0),
    failedTasks: integer().notNull().default(0),
    costUsd: doublePrecision().notNull().default(0),
    /** true = all active prompts of the project (counts for the schedule); false = scoped run (single prompt / new prompts). */
    fullRun: boolean().notNull().default(true),
    /** Scope & diagnostics: { promptIds?, engines?, skipped?: [{engine, reason}] } */
    meta: jsonb()
      .$type<{ promptIds?: string[]; engines?: string[]; skipped?: { engine: string; reason: string }[] }>()
      .notNull()
      .default({}),
    /** Last task error (for the run status tooltip). */
    error: text(),
    createdBy: text(),
    startedAt: ts(),
    finishedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_runs_project_idx").on(t.projectId, t.createdAt)],
);

/** One answer from one engine for one prompt on one day. */
export const aiAnswers = pgTable(
  "ai_answers",
  {
    id: id("ans"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    promptId: text()
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    runId: text().references(() => aiRuns.id, { onDelete: "set null" }),
    engine: text().notNull(),
    /** dataforseo | api | agent */
    provider: text().notNull(),
    model: text(),
    country: text().notNull(),
    language: text().notNull(),
    /** Day bucket the answer counts for (UTC). */
    answerDate: date({ mode: "string" }).notNull(),
    status: text({ enum: ["ok", "error"] })
      .notNull()
      .default("ok"),
    error: text(),
    /** Answer text (markdown). */
    text: text().notNull().default(""),
    /** Trimmed provider payload (shopping cards, ads, fan-out queries, search results). */
    raw: jsonb().$type<Record<string, unknown>>(),
    durationMs: integer(),
    costUsd: doublePrecision().notNull().default(0),
    /* ── Own-brand metrics (denormalized for fast KPIs) ── */
    brandMentioned: boolean().notNull().default(false),
    brandCited: boolean().notNull().default(false),
    /** Ordinal position of the own brand among all brands named (1 = first). */
    brandPosition: integer(),
    /** Char offset of the first own-brand mention ÷ answer length × 100 (0 = top). */
    mentionDepth: doublePrecision(),
    /** Own-brand sentiment 0–100 (null when not mentioned / not analyzed). */
    sentiment: doublePrecision(),
    /** Number of brands (own + competitors) named in the answer. */
    brandCount: integer().notNull().default(0),
    /** Number of cited sources in the answer / how many of them are own-domain pages. */
    citationCount: integer().notNull().default(0),
    ownCitationCount: integer().notNull().default(0),
    analysisStatus: text({ enum: ["pending", "done", "failed", "skipped"] })
      .notNull()
      .default("pending"),
    /** Why the LLM analysis pass failed / was skipped (deterministic results are kept). */
    analysisError: text(),
    analyzedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ai_answers_project_date_idx").on(t.projectId, t.answerDate),
    index("ai_answers_prompt_idx").on(t.promptId, t.answerDate),
    uniqueIndex("ai_answers_unique_day_uq").on(t.promptId, t.engine, t.answerDate),
  ],
);

/** Every brand (own or competitor) named in an answer. */
export const aiMentions = pgTable(
  "ai_mentions",
  {
    id: id("men"),
    answerId: text()
      .notNull()
      .references(() => aiAnswers.id, { onDelete: "cascade" }),
    projectId: text().notNull(),
    promptId: text().notNull(),
    engine: text().notNull(),
    answerDate: date({ mode: "string" }).notNull(),
    /** competitor id, or null for the own brand */
    competitorId: text().references(() => competitors.id, { onDelete: "cascade" }),
    isOwn: boolean().notNull().default(false),
    brandName: text().notNull(),
    position: integer().notNull(),
    charOffset: integer().notNull().default(0),
    depthPct: doublePrecision().notNull().default(0),
    occurrences: integer().notNull().default(1),
    /** Brand domain cited in the same answer */
    cited: boolean().notNull().default(false),
    sentiment: doublePrecision(),
    /** Named as the pick/winner in the answer */
    recommended: boolean().notNull().default(false),
    snippet: text(),
  },
  (t) => [
    index("ai_mentions_project_date_idx").on(t.projectId, t.answerDate),
    index("ai_mentions_answer_idx").on(t.answerId),
    index("ai_mentions_competitor_idx").on(t.competitorId, t.answerDate),
  ],
);

export type SourceContentType =
  | "listicle"
  | "buying-guide"
  | "test"
  | "ugc"
  | "article"
  | "reference"
  | "video"
  | "retail"
  | "news"
  | "forum"
  | "brand"
  | "docs"
  | "other";

/** Distinct cited pages per project. */
export const aiSources = pgTable(
  "ai_sources",
  {
    id: id("src"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text().notNull(),
    domain: text().notNull(),
    title: text(),
    contentType: text().$type<SourceContentType>().notNull().default("other"),
    /** own | competitor | third_party */
    ownership: text({ enum: ["own", "competitor", "third_party"] })
      .notNull()
      .default("third_party"),
    competitorId: text().references(() => competitors.id, { onDelete: "set null" }),
    firstSeenAt: ts().notNull().defaultNow(),
    lastSeenAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_sources_project_url_uq").on(t.projectId, t.url), index("ai_sources_domain_idx").on(t.projectId, t.domain)],
);

/** A citation of a source within an answer. */
export const aiCitations = pgTable(
  "ai_citations",
  {
    id: id("cit"),
    answerId: text()
      .notNull()
      .references(() => aiAnswers.id, { onDelete: "cascade" }),
    sourceId: text()
      .notNull()
      .references(() => aiSources.id, { onDelete: "cascade" }),
    projectId: text().notNull(),
    promptId: text().notNull(),
    engine: text().notNull(),
    answerDate: date({ mode: "string" }).notNull(),
    position: integer().notNull().default(1),
  },
  (t) => [
    index("ai_citations_project_date_idx").on(t.projectId, t.answerDate),
    index("ai_citations_source_idx").on(t.sourceId),
    // FK cascade from ai_answers (project deletion) needs an index on answer_id.
    index("ai_citations_answer_idx").on(t.answerId),
  ],
);

/** Sub-queries the engine searched for while answering (query fan-out). */
export const aiFanouts = pgTable(
  "ai_fanouts",
  {
    id: id("fan"),
    answerId: text()
      .notNull()
      .references(() => aiAnswers.id, { onDelete: "cascade" }),
    projectId: text().notNull(),
    promptId: text().notNull(),
    engine: text().notNull(),
    answerDate: date({ mode: "string" }).notNull(),
    query: text().notNull(),
  },
  (t) => [index("ai_fanouts_project_idx").on(t.projectId, t.answerDate), index("ai_fanouts_answer_idx").on(t.answerId)],
);

/**
 * Sentiment statements (praise / criticism) extracted from answers, with the aspect they
 * are about. Themes group attributes (e.g. theme "Comfort & Fit" → attribute "Wide fit").
 */
export const aiStatements = pgTable(
  "ai_statements",
  {
    id: id("stm"),
    answerId: text()
      .notNull()
      .references(() => aiAnswers.id, { onDelete: "cascade" }),
    projectId: text().notNull(),
    promptId: text().notNull(),
    engine: text().notNull(),
    answerDate: date({ mode: "string" }).notNull(),
    competitorId: text().references(() => competitors.id, { onDelete: "cascade" }),
    isOwn: boolean().notNull().default(false),
    brandName: text().notNull(),
    polarity: text({ enum: ["praise", "neutral", "criticism"] }).notNull(),
    theme: text(),
    attribute: text(),
    quote: text().notNull(),
    /** 0–100: how strongly positive/negative */
    severity: doublePrecision().notNull().default(50),
  },
  (t) => [index("ai_statements_project_idx").on(t.projectId, t.answerDate, t.polarity), index("ai_statements_answer_idx").on(t.answerId)],
);

/** "Best for …" picks and head-to-head claims judged from answers. */
export const aiRecommendations = pgTable(
  "ai_recommendations",
  {
    id: id("rec"),
    answerId: text()
      .notNull()
      .references(() => aiAnswers.id, { onDelete: "cascade" }),
    projectId: text().notNull(),
    promptId: text().notNull(),
    engine: text().notNull(),
    answerDate: date({ mode: "string" }).notNull(),
    kind: text({ enum: ["best_for", "head_to_head"] }).notNull(),
    /** best_for: the situation ("Best for beginners"); head_to_head: the claim text */
    label: text().notNull(),
    competitorId: text().references(() => competitors.id, { onDelete: "cascade" }),
    isOwn: boolean().notNull().default(false),
    brandName: text().notNull(),
    /** head_to_head: the other brand and who won */
    opponentCompetitorId: text(),
    opponentIsOwn: boolean(),
    opponentName: text(),
    winner: text({ enum: ["brand", "opponent", "tie"] }),
  },
  (t) => [index("ai_recommendations_project_idx").on(t.projectId, t.answerDate, t.kind), index("ai_recommendations_answer_idx").on(t.answerId)],
);

/* ───────────────────────────── Products & ads ───────────────────────────── */

export const aiProducts = pgTable(
  "ai_products",
  {
    id: id("apr"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    normalizedName: text().notNull(),
    brandName: text(),
    competitorId: text().references(() => competitors.id, { onDelete: "set null" }),
    isOwn: boolean().notNull().default(false),
    category: text(),
    imageUrl: text(),
    attributes: jsonb().$type<Record<string, string>>().notNull().default({}),
    firstSeenAt: ts().notNull().defaultNow(),
    lastSeenAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_products_project_name_uq").on(t.projectId, t.normalizedName)],
);

export const aiProductAppearances = pgTable(
  "ai_product_appearances",
  {
    id: id("apa"),
    productId: text()
      .notNull()
      .references(() => aiProducts.id, { onDelete: "cascade" }),
    answerId: text()
      .notNull()
      .references(() => aiAnswers.id, { onDelete: "cascade" }),
    projectId: text().notNull(),
    promptId: text().notNull(),
    engine: text().notNull(),
    answerDate: date({ mode: "string" }).notNull(),
    /** llm = named in text, shopping = rendered product card, both */
    source: text({ enum: ["llm", "shopping", "both"] }).notNull().default("llm"),
    position: integer(),
    price: doublePrecision(),
    oldPrice: doublePrecision(),
    currency: text(),
    rating: doublePrecision(),
    reviews: integer(),
    store: text(),
    storeDomain: text(),
    url: text(),
  },
  (t) => [
    index("ai_product_appearances_project_idx").on(t.projectId, t.answerDate),
    index("ai_product_appearances_product_idx").on(t.productId),
    index("ai_product_appearances_answer_idx").on(t.answerId),
  ],
);

export const aiAds = pgTable(
  "ai_ads",
  {
    id: id("aad"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    advertiser: text().notNull(),
    advertiserDomain: text(),
    competitorId: text().references(() => competitors.id, { onDelete: "set null" }),
    isOwn: boolean().notNull().default(false),
    headline: text().notNull(),
    description: text(),
    imageUrl: text(),
    landingUrl: text(),
    fingerprint: text().notNull(),
    firstSeenAt: ts().notNull().defaultNow(),
    lastSeenAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_ads_project_fp_uq").on(t.projectId, t.fingerprint)],
);

export const aiAdAppearances = pgTable(
  "ai_ad_appearances",
  {
    id: id("aap"),
    adId: text()
      .notNull()
      .references(() => aiAds.id, { onDelete: "cascade" }),
    answerId: text()
      .notNull()
      .references(() => aiAnswers.id, { onDelete: "cascade" }),
    projectId: text().notNull(),
    promptId: text().notNull(),
    engine: text().notNull(),
    answerDate: date({ mode: "string" }).notNull(),
    position: integer(),
    rating: doublePrecision(),
  },
  (t) => [index("ai_ad_appearances_project_idx").on(t.projectId, t.answerDate), index("ai_ad_appearances_answer_idx").on(t.answerId)],
);

/* ───────────────────────────── Prompt research ───────────────────────────── */

export const promptResearchLists = pgTable(
  "prompt_research_lists",
  {
    id: id("prl"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    isDefault: boolean().notNull().default(false),
    source: text({ enum: ["generated", "import", "manual"] })
      .notNull()
      .default("generated"),
    /* ── ai-research additions ── */
    /** Generation state of the list (Prompt Set Helper / auto-generation). */
    status: text({ enum: ["idle", "generating", "failed"] })
      .notNull()
      .default("idle"),
    /** Background job currently generating items for this list. */
    jobId: text(),
    error: text(),
    /** Last Prompt Set Helper configuration used for this list. */
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("prompt_research_lists_project_idx").on(t.projectId)],
);

/** Researched prompts (what people ask AI) — can be added to the tracker. */
export const promptResearchItems = pgTable(
  "prompt_research_items",
  {
    id: id("pri"),
    listId: text()
      .notNull()
      .references(() => promptResearchLists.id, { onDelete: "cascade" }),
    projectId: text().notNull(),
    text: text().notNull(),
    topic: text(),
    funnelStage: text({ enum: ["tofu", "mofu", "bofu"] }),
    persona: text(),
    intent: text(),
    branded: boolean().notNull().default(false),
    competitorMentioned: text(),
    length: text({ enum: ["short", "medium", "long"] }),
    /** 0..1 relative volume score for the bar meter, plus absolute estimate if known */
    volumeScore: doublePrecision(),
    volume: integer(),
    /** Id of the tracked prompt once added */
    trackedPromptId: text(),
    addedAt: ts(),
    /* ── ai-research additions ── */
    /** Where the volume came from: DataForSEO search volume, LLM estimate, or imported file. */
    volumeSource: text({ enum: ["dataforseo", "estimated", "import"] }),
    /** Short search keyword representing the prompt's topic (used for volume lookups). */
    keyword: text(),
    source: text({ enum: ["generated", "import", "manual"] })
      .notNull()
      .default("generated"),
    /** Extra details for the "Data" popover (rationale, monthly trend, keyword metrics…). */
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("prompt_research_items_list_idx").on(t.listId),
    index("prompt_research_items_project_idx").on(t.projectId),
  ],
);

/** Brand knowledge analyses (interest clusters, sitemap, personas, product catalog). */
export const brandKnowledge = pgTable(
  "brand_knowledge",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text({ enum: ["interest", "sitemap", "personas", "products", "profile"] }).notNull(),
    status: text({ enum: ["idle", "running", "ready", "failed"] })
      .notNull()
      .default("idle"),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    error: text(),
    /* ── ai-research additions ── */
    /** Background job running the analysis. */
    jobId: text(),
    /** User who requested the latest analysis (gets the "ready" email + notification). */
    requestedBy: text().references(() => users.id, { onDelete: "set null" }),
    startedAt: ts(),
    finishedAt: ts(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.kind] })],
);

/** Product catalog imported via "Connect product stream" (feed, file or API). */
export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: id("cat"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sku: text(),
    name: text().notNull(),
    url: text(),
    imageUrl: text(),
    price: doublePrecision(),
    currency: text(),
    category: text(),
    brand: text(),
    description: text(),
    /* ── ai-research additions ── */
    /** Dedupe key within the project: sku, else URL, else normalized name. */
    productKey: text(),
    gtin: text(),
    availability: text(),
    /** How the product arrived: feed URL, file upload or push API. */
    source: text({ enum: ["feed", "file", "api"] }),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => [
    index("catalog_products_project_idx").on(t.projectId),
    uniqueIndex("catalog_products_project_key_uq").on(t.projectId, t.productKey),
  ],
);

/* ───────────────────── open-seo: brand lookup & prompt explorer ───────────────────── */

export const aiLookups = pgTable(
  "ai_lookups",
  {
    id: id("alk"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text({ enum: ["brand_lookup", "prompt_explorer"] }).notNull(),
    query: text().notNull(),
    params: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    costUsd: doublePrecision().notNull().default(0),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    /* ── ai-research additions ── */
    status: text({ enum: ["queued", "running", "done", "failed"] })
      .notNull()
      .default("done"),
    error: text(),
    jobId: text(),
    finishedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_lookups_project_idx").on(t.projectId, t.kind, t.createdAt)],
);

/* ───────────────────── ai-research: project context (open-seo "context") ───────────────────── */

/**
 * Structured, project-scoped notes shared by humans and agents (business overview, goals,
 * positioning, writing preferences, key pages, research log…). Agents read them as context
 * and may append/update entries (`updatedBy` = "agent" | "mcp").
 */
export const projectContextNotes = pgTable(
  "project_context_notes",
  {
    id: id("pcn"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    category: text({
      enum: ["business_overview", "goal", "positioning", "audience", "writing", "competitors", "key_pages", "research_log", "other"],
    })
      .notNull()
      .default("other"),
    title: text().notNull(),
    body: text().notNull().default(""),
    pinned: boolean().notNull().default(false),
    updatedBy: text({ enum: ["user", "agent", "mcp"] })
      .notNull()
      .default("user"),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("project_context_notes_project_idx").on(t.projectId, t.category)],
);
