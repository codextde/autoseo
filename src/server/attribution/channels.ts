/**
 * Channel catalogue + free-text normalization. Pure (no server-only) — used by the snippet builder,
 * ingestion, the UI and unit tests.
 */
import type { AiDetailId, ChannelId, SurveyChannel, SurveyConfig } from "./types";
import { AI_DETAIL_IDS, CHANNEL_IDS } from "./types";

export const CHANNELS: Record<ChannelId, { label: string; labelDe: string; color: string; description: string }> = {
  ai_search: {
    label: "AI Search",
    labelDe: "KI-Suche (ChatGPT, Perplexity …)",
    color: "var(--brand)",
    description: "ChatGPT, Perplexity, Claude, Gemini, Copilot, AI Overviews",
  },
  search: { label: "Google / Bing", labelDe: "Google / Bing", color: "var(--chart-3)", description: "Classic search engines" },
  social: { label: "Social Media", labelDe: "Social Media", color: "var(--chart-4)", description: "Instagram, LinkedIn, TikTok, YouTube …" },
  ads: { label: "Online Ads", labelDe: "Online-Werbung", color: "var(--chart-1)", description: "Paid ads on any network" },
  referral: {
    label: "Referral",
    labelDe: "Empfehlung",
    color: "var(--chart-7)",
    description: "Friends, colleagues, partners, word of mouth",
  },
  content: { label: "Content", labelDe: "Blog / Artikel / Podcast", color: "var(--chart-6)", description: "Blog posts, articles, podcasts, newsletters" },
  other: { label: "Other", labelDe: "Sonstiges", color: "var(--chart-8)", description: "Free-text answer" },
};

export const AI_DETAILS: Record<AiDetailId, { label: string; engine?: string }> = {
  chatgpt: { label: "ChatGPT", engine: "chatgpt" },
  perplexity: { label: "Perplexity", engine: "perplexity" },
  claude: { label: "Claude", engine: "claude" },
  gemini: { label: "Gemini", engine: "gemini" },
  copilot: { label: "Copilot", engine: "copilot" },
  ai_overview: { label: "Google AI Overview", engine: "ai_overview" },
  grok: { label: "Grok", engine: "grok" },
  deepseek: { label: "DeepSeek", engine: "deepseek" },
  mistral: { label: "Mistral / Le Chat", engine: "mistral" },
  other_ai: { label: "Other AI" },
};

export function channelLabel(id: string | null | undefined): string {
  if (!id) return "Unknown";
  return (CHANNELS as Record<string, { label: string }>)[id]?.label ?? id;
}

export function isChannelId(v: unknown): v is ChannelId {
  return typeof v === "string" && (CHANNEL_IDS as readonly string[]).includes(v);
}

export function isAiDetailId(v: unknown): v is AiDetailId {
  return typeof v === "string" && (AI_DETAIL_IDS as readonly string[]).includes(v);
}

export const DEFAULT_SURVEY_CHANNELS: SurveyChannel[] = CHANNEL_IDS.map((id) => ({
  id,
  label: CHANNELS[id].label,
  labelDe: CHANNELS[id].labelDe,
  enabled: true,
}));

export const DEFAULT_SURVEY: SurveyConfig = {
  enabled: true,
  questionEn: "How did you hear about us?",
  questionDe: "Wie bist du auf uns aufmerksam geworden?",
  language: "auto",
  channels: DEFAULT_SURVEY_CHANNELS,
  aiDetails: true,
  aiOptions: ["chatgpt", "perplexity", "claude", "gemini", "copilot"],
  otherPlaceholderEn: "Tell us where…",
  otherPlaceholderDe: "Erzähl uns wo …",
  thankYouEn: "Thanks for your answer!",
  thankYouDe: "Danke für deine Antwort!",
  primaryColor: "#111111",
  backgroundColor: "#ffffff",
  textColor: "#111111",
  position: "bottom-right",
  triggers: { pageLoad: false, pageLoadDelaySec: 8, formSubmit: true, purchase: true },
  askOnce: true,
  detectExistingQuestions: true,
  captureConversions: true,
  excludePaths: [],
};

/** Merges a stored (possibly partial / older) survey config with defaults. */
export function withSurveyDefaults(stored: Partial<SurveyConfig> | null | undefined): SurveyConfig {
  const s = stored ?? {};
  const channels = Array.isArray(s.channels) && s.channels.length ? s.channels.filter((c) => isChannelId(c.id)) : DEFAULT_SURVEY_CHANNELS;
  return {
    ...DEFAULT_SURVEY,
    ...s,
    channels,
    aiOptions: Array.isArray(s.aiOptions) ? s.aiOptions.filter(isAiDetailId) : DEFAULT_SURVEY.aiOptions,
    triggers: { ...DEFAULT_SURVEY.triggers, ...(s.triggers ?? {}) },
    excludePaths: Array.isArray(s.excludePaths) ? s.excludePaths : [],
  };
}

/* ───────────────────────────── Normalization ───────────────────────────── */

const AI_DETAIL_PATTERNS: Array<[AiDetailId, RegExp]> = [
  ["chatgpt", /chat\s*-?\s*gpt|openai|\bgpt[-\s]?\d|\bgpt\b|searchgpt/i],
  ["perplexity", /perplexity/i],
  ["claude", /claude|anthropic/i],
  ["gemini", /gemini|\bbard\b/i],
  ["copilot", /copilot|bing\s*chat/i],
  ["ai_overview", /ai\s*overview|ai\s*mode|sge\b|ki[-\s]?übersicht/i],
  ["grok", /\bgrok\b/i],
  ["deepseek", /deepseek/i],
  ["mistral", /mistral|le\s*chat/i],
];

/** Anything that indicates an AI assistant / AI search answer. */
const AI_PATTERN =
  /chat\s*-?\s*gpt|openai|\bgpt\b|perplexity|claude|anthropic|gemini|\bbard\b|copilot|bing\s*chat|ai[\s_-]*search|ai[\s_-]*overview|ai[\s_-]*mode|\bgrok\b|deepseek|mistral|le\s*chat|\bllm\b|\bki\b|ki[-\s]?suche|künstliche[r]?\s+intelligenz|kuenstliche|artificial\s+intelligence|\bai\b|ai[\s_-]*(assistant|chat|tool|chatbot)|chatbot/i;

const ADS_PATTERN =
  /\bads?\b|advert|werbung|anzeige|sponsored|gesponsert|\bppc\b|\bcpc\b|paid|banner|google\s*ads|adwords|meta\s*ads|facebook\s*ads|instagram\s*ads|linkedin\s*ads|tiktok\s*ads|online[\s_-]*ads/i;
const SOCIAL_PATTERN =
  /social|facebook|instagram|\binsta\b|linkedin|tiktok|youtube|twitter|\bx\.com\b|threads|pinterest|reddit|snapchat|xing|mastodon|bluesky|influencer/i;
const SEARCH_PATTERN =
  /google|bing|duckduckgo|yahoo|ecosia|startpage|brave\s*search|search\s*engine|suchmaschine|\bsearch\b|\bsuche\b|gesucht|googled|\bseo\b|organic/i;
const REFERRAL_PATTERN =
  /referr|recommend|friend|colleague|coworker|co-worker|word\s*of\s*mouth|partner|empfehl|empfohlen|freund|kolleg|bekannt|mundpropaganda|familie|family|customer\s*of|kunde/i;
const CONTENT_PATTERN =
  /blog|article|artikel|podcast|newsletter|webinar|magazin|magazine|press|presse|news|zeitung|ebook|e-book|whitepaper|guide|ratgeber|content|video/i;

const CHANNEL_SYNONYMS: Record<string, ChannelId> = {
  ai: "ai_search",
  ai_search: "ai_search",
  aisearch: "ai_search",
  "ai-search": "ai_search",
  llm: "ai_search",
  search: "search",
  google: "search",
  seo: "search",
  organic: "search",
  organic_search: "search",
  social: "social",
  social_media: "social",
  ads: "ads",
  paid: "ads",
  online_ads: "ads",
  paid_ads: "ads",
  referral: "referral",
  word_of_mouth: "referral",
  content: "content",
  other: "other",
};

export type NormalizedChannel = { channel: ChannelId; detail: AiDetailId | null };

/** Detects which AI assistant a text refers to (null when none). */
export function detectAiDetail(text: string | null | undefined): AiDetailId | null {
  if (!text) return null;
  for (const [id, re] of AI_DETAIL_PATTERNS) if (re.test(text)) return id;
  return null;
}

/**
 * Normalizes an answer / channel id / free text to a canonical channel.
 * Text mentioning chatgpt/openai/claude/perplexity/gemini/copilot/"ai search" → `ai_search`.
 * Order matters: AI first ("Google Gemini" is AI), then ads ("Google Ads" is ads), social, search,
 * referral, content, else `other`.
 */
export function normalizeChannel(
  value: string | null | undefined,
  options: { customChannels?: Array<{ id: ChannelId; label: string; labelDe?: string }> } = {},
): NormalizedChannel {
  const raw = (value ?? "").trim();
  if (!raw) return { channel: "other", detail: null };
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  const detailFromId = isAiDetailId(key) ? key : null;
  if (detailFromId) return { channel: "ai_search", detail: detailFromId };
  if (isChannelId(key)) return { channel: key, detail: key === "ai_search" ? detectAiDetail(raw) : null };
  if (CHANNEL_SYNONYMS[key]) return { channel: CHANNEL_SYNONYMS[key], detail: null };

  // Exact label matches (EN/DE) of the configured survey options.
  const lower = raw.toLowerCase();
  for (const c of options.customChannels ?? []) {
    if (c.label.toLowerCase() === lower || c.labelDe?.toLowerCase() === lower) {
      return { channel: c.id, detail: c.id === "ai_search" ? detectAiDetail(raw) : null };
    }
  }
  for (const id of CHANNEL_IDS) {
    if (CHANNELS[id].label.toLowerCase() === lower || CHANNELS[id].labelDe.toLowerCase() === lower) {
      return { channel: id, detail: id === "ai_search" ? detectAiDetail(raw) : null };
    }
  }

  if (AI_PATTERN.test(raw)) return { channel: "ai_search", detail: detectAiDetail(raw) };
  if (ADS_PATTERN.test(raw)) return { channel: "ads", detail: null };
  if (SOCIAL_PATTERN.test(raw)) return { channel: "social", detail: null };
  if (SEARCH_PATTERN.test(raw)) return { channel: "search", detail: null };
  if (REFERRAL_PATTERN.test(raw)) return { channel: "referral", detail: null };
  if (CONTENT_PATTERN.test(raw)) return { channel: "content", detail: null };
  return { channel: "other", detail: null };
}

/**
 * Regex (source) matching "How did you hear about us?"-style questions in EN/DE. Used by the snippet
 * to detect existing questions in forms and by the mapping auto-suggest.
 */
export const HDYHAU_PATTERN_SOURCE =
  "how\\s+did\\s+you\\s+(hear|find|learn|come\\s+across|discover)|where\\s+did\\s+you\\s+(hear|find|learn)|how\\s+did\\s+you\\s+get\\s+to\\s+know|how\\s+you\\s+heard|heard\\s+about\\s+us|hdyhau|referral[\\s_-]*source|lead[\\s_-]*source|attribution|wie\\s+(bist|sind|seid)\\s+(du|sie|ihr)\\s+auf\\s+uns\\s+aufmerksam|aufmerksam\\s+geworden|wie\\s+(hast|haben)\\s+(du|sie)\\s+(von\\s+uns\\s+erfahren|uns\\s+gefunden)|wo\\s+(hast|haben)\\s+(du|sie)\\s+von\\s+uns|wie\\s+hast\\s+du\\s+uns\\s+gefunden|wie\\s+sind\\s+sie\\s+auf\\s+uns\\s+gestoßen|how_did_you_hear|heard_about";

export const HDYHAU_PATTERN = new RegExp(HDYHAU_PATTERN_SOURCE, "i");
