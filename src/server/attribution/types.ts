/**
 * Shared, isomorphic types for the attribution module. Kept free of `server-only` so the DB schema,
 * pure helpers (tests) and client components can import them.
 */

/** Canonical attribution channels (finseo parity). */
export const CHANNEL_IDS = ["ai_search", "search", "social", "ads", "referral", "content", "other"] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

/** Detailed AI answers ("Which AI assistant?"). */
export const AI_DETAIL_IDS = [
  "chatgpt",
  "perplexity",
  "claude",
  "gemini",
  "copilot",
  "ai_overview",
  "grok",
  "deepseek",
  "mistral",
  "other_ai",
] as const;
export type AiDetailId = (typeof AI_DETAIL_IDS)[number];

export type TrackMode = "purchases" | "leads" | "both";

export const PLATFORM_IDS = [
  "shopify",
  "woocommerce",
  "shopware",
  "wordpress",
  "webflow",
  "framer",
  "wix",
  "squarespace",
  "hubspot_cms",
  "custom",
] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export const FORMS_MODES = ["existing_question", "popup", "form_tool", "crm", "checkout_only"] as const;
export type FormsMode = (typeof FORMS_MODES)[number];

export const CONVERSION_SOURCES = [
  "snippet",
  "stripe",
  "shopify",
  "woocommerce",
  "shopware",
  "webhook",
  "none",
] as const;
export type ConversionSource = (typeof CONVERSION_SOURCES)[number];

export type SurveyChannel = {
  /** Canonical channel the option maps to. */
  id: ChannelId;
  label: string;
  labelDe: string;
  enabled: boolean;
};

export type SurveyPosition = "bottom-right" | "bottom-left" | "center";

export type SurveyConfig = {
  /** Show the popup survey when no existing question was detected. */
  enabled: boolean;
  questionEn: string;
  questionDe: string;
  /** "auto" picks DE for German browsers, EN otherwise. */
  language: "auto" | "en" | "de";
  channels: SurveyChannel[];
  /** Ask "Which AI assistant?" after "AI Search". */
  aiDetails: boolean;
  aiOptions: AiDetailId[];
  otherPlaceholderEn: string;
  otherPlaceholderDe: string;
  thankYouEn: string;
  thankYouDe: string;
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  position: SurveyPosition;
  triggers: {
    pageLoad: boolean;
    pageLoadDelaySec: number;
    formSubmit: boolean;
    purchase: boolean;
  };
  /** Only ask each visitor once (localStorage, no cookies). */
  askOnce: boolean;
  /** Capture answers of existing "How did you hear about us?" form fields instead of showing a popup. */
  detectExistingQuestions: boolean;
  /** Passively capture GA/Ads (`purchase`, `generate_lead`) and Meta Pixel (`Purchase`, `Lead`) conversions. */
  captureConversions: boolean;
  /** Path prefixes where the popup never shows (e.g. /account). */
  excludePaths: string[];
};

/** Attribution schema fields that incoming payloads can be mapped to. */
export const MAPPING_TARGETS = [
  "channel",
  "channelDetail",
  "freetext",
  "email",
  "externalId",
  "name",
  "dealValue",
  "dealCurrency",
  "transactionId",
  "formId",
  "formName",
  "pageUrl",
  "occurredAt",
] as const;
export type MappingTarget = (typeof MAPPING_TARGETS)[number];

/** A mapping rule: read a (nested) path from the payload, or use a constant. */
export type FieldRule = { path?: string; constant?: string };
export type FieldMapping = Partial<Record<MappingTarget, FieldRule>> & {
  /** Extra payload paths copied into the response metadata. */
  metadata?: string[];
};

export type WorkflowKind = "auto" | "response" | "conversion";
export type WorkflowStatus = "needs_mapping" | "active" | "paused";

export const WEBHOOK_LOG_STATUSES = [
  "stored",
  "stored_conversion",
  "parse_failed",
  "invalid_token",
  "error",
] as const;
export type WebhookLogStatus = (typeof WEBHOOK_LOG_STATUSES)[number];

export type ConversionKind = "purchase" | "lead" | "trial" | "renewal";

export type ResponseSourceType = "snippet" | "form" | "webhook" | "integration" | "import" | "api" | "manual";

export type ConversionSourceType =
  | "snippet_ga"
  | "snippet_meta"
  | "snippet_api"
  | "shopify"
  | "stripe"
  | "woocommerce"
  | "shopware"
  | "webhook"
  | "import"
  | "api";

/** Normalized, validated input for a response (after parsing / mapping). */
export type ResponseInput = {
  channel?: string | null;
  channelDetail?: string | null;
  rawAnswer?: string | null;
  freetext?: string | null;
  email?: string | null;
  emailHash?: string | null;
  emailMask?: string | null;
  externalId?: string | null;
  name?: string | null;
  dealValue?: number | null;
  dealCurrency?: string | null;
  transactionId?: string | null;
  formId?: string | null;
  formName?: string | null;
  pageUrl?: string | null;
  visitorId?: string | null;
  occurredAt?: Date | null;
  metadata?: Record<string, unknown> | null;
  /** Idempotency key (e.g. provider + submission id). */
  dedupeKey?: string | null;
};

/** Normalized, validated input for a conversion. */
export type ConversionInput = {
  transactionId?: string | null;
  kind?: ConversionKind;
  value?: number | null;
  currency?: string | null;
  email?: string | null;
  emailHash?: string | null;
  emailMask?: string | null;
  visitorId?: string | null;
  pageUrl?: string | null;
  items?: Array<Record<string, unknown>> | null;
  occurredAt?: Date | null;
  metadata?: Record<string, unknown> | null;
};
