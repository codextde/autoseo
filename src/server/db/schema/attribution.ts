// Schema for the "attribution" module. Owned by that module; see docs/ARCHITECTURE.md.
// Responses ("How did you hear about us?") + Conversions (orders/leads) merged by transaction id →
// email hash → snippet visitor id. Emails are never stored in clear text (SHA-256 + masked preview).
import { pgTable, text, integer, jsonb, index, uniqueIndex, doublePrecision } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, ts } from "./_helpers";
import { projects, users } from "./core";
import type {
  ConversionKind,
  ConversionSource,
  ConversionSourceType,
  FieldMapping,
  FormsMode,
  PlatformId,
  ResponseSourceType,
  SurveyConfig,
  TrackMode,
  WebhookLogStatus,
  WorkflowKind,
  WorkflowStatus,
} from "../../attribution/types";

/** Per-project attribution configuration (setup wizard answers, survey customization, tokens). */
export const attributionSettings = pgTable(
  "attribution_settings",
  {
    projectId: text()
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Public snippet key (embedded in websites — not a secret). */
    publicKey: text().notNull(),
    trackMode: text().$type<TrackMode>().notNull().default("both"),
    platform: text().$type<PlatformId>(),
    formsMode: text().$type<FormsMode>(),
    conversionSource: text().$type<ConversionSource>(),
    survey: jsonb().$type<Partial<SurveyConfig>>().notNull().default({}),
    /** Optional allow-list of website hosts that may send snippet events (empty = any). */
    allowedDomains: jsonb().$type<string[]>().notNull().default([]),
    /** Deal values in this currency are summed in KPIs (no FX conversion). */
    reportingCurrency: text().notNull().default("EUR"),
    wizardStep: integer().notNull().default(1),
    setupCompletedAt: ts(),
    /** Project-level webhook token (SHA-256 hash; clear token shown once). */
    webhookTokenHash: text(),
    webhookTokenPrefix: text(),
    webhookTokenCreatedAt: ts(),
    snippetFirstSeenAt: ts(),
    snippetLastSeenAt: ts(),
    /** Origin (scheme + host) where the snippet last ran. */
    snippetLastOrigin: text(),
    updatedBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("attribution_settings_public_key_uq").on(t.publicKey)],
);

/** "How did you hear about us?" answers from the snippet, forms, CRMs, imports and the API. */
export const attributionResponses = pgTable(
  "attribution_responses",
  {
    id: id("atr"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceType: text().$type<ResponseSourceType>().notNull(),
    /** Provider key (website_widget, form_detect, typeform, hubspot, fairing, api…). */
    provider: text().notNull(),
    formId: text(),
    formName: text(),
    /** Canonical channel (ai_search, search, social, ads, referral, content, other). */
    channel: text().notNull(),
    /** AI assistant detail (chatgpt, perplexity, claude, gemini, copilot…). */
    channelDetail: text(),
    rawAnswer: text(),
    freetext: text(),
    emailHash: text(),
    emailMask: text(),
    externalId: text(),
    respondentName: text(),
    dealValue: doublePrecision(),
    dealCurrency: text(),
    /** Where the deal value came from (response itself or the merged conversion). */
    valueSource: text({ enum: ["response", "conversion"] }),
    transactionId: text(),
    conversionId: text(),
    matchedVia: text({ enum: ["transaction", "email", "visitor"] }),
    visitorId: text(),
    pageUrl: text(),
    workflowId: text(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: text({ enum: ["active", "dismissed"] })
      .notNull()
      .default("active"),
    dismissedAt: ts(),
    dismissedBy: text().references(() => users.id, { onDelete: "set null" }),
    dedupeKey: text(),
    respondedAt: ts().notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("attribution_responses_project_time_idx").on(t.projectId, t.respondedAt),
    index("attribution_responses_email_idx").on(t.projectId, t.emailHash),
    index("attribution_responses_tx_idx").on(t.projectId, t.transactionId),
    index("attribution_responses_visitor_idx").on(t.projectId, t.visitorId),
    uniqueIndex("attribution_responses_dedupe_uq").on(t.projectId, t.dedupeKey),
  ],
);

/** Purchases / leads with transaction id + value (Stripe, shops, pixels, webhooks, snippet). */
export const attributionConversions = pgTable(
  "attribution_conversions",
  {
    id: id("atc"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: text().$type<ConversionSourceType>().notNull(),
    kind: text().$type<ConversionKind>().notNull().default("purchase"),
    transactionId: text(),
    value: doublePrecision(),
    currency: text(),
    emailHash: text(),
    emailMask: text(),
    visitorId: text(),
    pageUrl: text(),
    items: jsonb().$type<Array<Record<string, unknown>>>(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    responseId: text(),
    occurredAt: ts().notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("attribution_conversions_tx_uq").on(t.projectId, t.transactionId),
    index("attribution_conversions_project_time_idx").on(t.projectId, t.occurredAt),
    index("attribution_conversions_email_idx").on(t.projectId, t.emailHash),
    index("attribution_conversions_visitor_idx").on(t.projectId, t.visitorId),
  ],
);

/** Field-mapping workflows: one per incoming payload shape (created on first delivery). */
export const attributionWorkflows = pgTable(
  "attribution_workflows",
  {
    id: id("awf"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    provider: text().notNull().default("custom"),
    fingerprint: text().notNull(),
    kind: text().$type<WorkflowKind>().notNull().default("auto"),
    status: text().$type<WorkflowStatus>().notNull().default("needs_mapping"),
    mapping: jsonb().$type<FieldMapping>().notNull().default({}),
    /** Redacted sample payload (emails masked, secrets removed) for the mapping UI. */
    samplePayload: jsonb().$type<unknown>(),
    sampleReceivedAt: ts(),
    lastPayloadAt: ts(),
    processedCount: integer().notNull().default(0),
    failedCount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("attribution_workflows_fingerprint_uq").on(t.projectId, t.fingerprint)],
);

/** Delivery log of every webhook call (no clear-text PII; pending payloads encrypted). */
export const attributionWebhookLogs = pgTable(
  "attribution_webhook_logs",
  {
    id: id("awl"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text().$type<WebhookLogStatus | "ignored">().notNull(),
    provider: text(),
    workflowId: text(),
    responseId: text(),
    conversionId: text(),
    message: text(),
    payloadBytes: integer().notNull().default(0),
    payloadKeys: jsonb().$type<string[]>().notNull().default([]),
    /** Encrypted payload awaiting a field mapping (reprocessed once mapped; purged after 7 days). */
    pendingPayload: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("attribution_webhook_logs_project_idx").on(t.projectId, t.createdAt),
    index("attribution_webhook_logs_workflow_idx").on(t.workflowId),
  ],
);
