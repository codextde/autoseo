/**
 * Shared (isomorphic) types of the ai-research module: Prompt Research, Brand Knowledge,
 * Brand Lookup and Prompt Explorer.
 */

export type FunnelStage = "tofu" | "mofu" | "bofu";
export type PromptLength = "short" | "medium" | "long";
export type VolumeSource = "dataforseo" | "estimated" | "import";

export const FUNNEL_LABELS: Record<FunnelStage, string> = {
  tofu: "TOFU · Awareness",
  mofu: "MOFU · Consideration",
  bofu: "BOFU · Decision",
};

export const LENGTH_LABELS: Record<PromptLength, string> = {
  short: "Short (≤ 8 words)",
  medium: "Medium (9–18 words)",
  long: "Long (19+ words)",
};

/* ───────────────────────────── Prompt research ───────────────────────────── */

export type ResearchList = {
  id: string;
  name: string;
  isDefault: boolean;
  source: "generated" | "import" | "manual";
  status: "idle" | "generating" | "failed";
  jobId: string | null;
  error: string | null;
  itemCount: number;
  createdAt: string;
};

export type ResearchItem = {
  id: string;
  listId: string;
  text: string;
  topic: string | null;
  funnelStage: FunnelStage | null;
  persona: string | null;
  intent: string | null;
  branded: boolean;
  competitorMentioned: string | null;
  length: PromptLength | null;
  volumeScore: number | null;
  volume: number | null;
  volumeSource: VolumeSource | null;
  keyword: string | null;
  trackedPromptId: string | null;
  addedAt: string | null;
  source: "generated" | "import" | "manual";
  details: ResearchItemDetails;
  createdAt: string;
};

export type ResearchItemDetails = {
  rationale?: string;
  keywordMetrics?: { searchVolume: number | null; cpc?: number | null; difficulty?: number | null; intent?: string | null };
  trend?: { month: string; volume: number }[];
  estimatedLabel?: string;
};

export type PromptSetConfig = {
  topics: string[];
  personas: string[];
  funnelStages: FunnelStage[];
  /** 0–100 share of prompts that name the own brand. */
  brandedShare: number;
  competitorComparisons: boolean;
  competitors: string[];
  lengths: PromptLength[];
  count: number;
  language: string;
  country: string;
  instructions?: string;
};

export type JobStatus = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: { done?: number; total?: number; step?: string; message?: string } | null;
  error: string | null;
};

/* ───────────────────────────── Brand knowledge ───────────────────────────── */

export type KnowledgeKind = "interest" | "sitemap" | "personas" | "products" | "profile";

export type KnowledgeState<T> = {
  status: "idle" | "running" | "ready" | "failed";
  data: T | null;
  error: string | null;
  jobId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
};

export type SearchIntent = "informational" | "commercial" | "transactional" | "navigational" | "mixed";

export type InterestKeyword = { keyword: string; volume: number | null; intent?: SearchIntent | null };

export type InterestCluster = {
  id: string;
  name: string;
  description?: string;
  intent: SearchIntent;
  volume: number | null;
  /** Monthly totals, oldest first ("2026-01"). */
  trend: { month: string; volume: number }[];
  trendDirection: "up" | "down" | "flat" | null;
  /** Change of the last 3 months vs the 3 months before, in percent. */
  trendPct: number | null;
  branded: boolean;
  keywords: InterestKeyword[];
};

export type InterestData = {
  clusters: InterestCluster[];
  seeds: string[];
  volumeSource: "dataforseo" | "estimated";
  totalKeywords: number;
  totalVolume: number | null;
  country: string;
  language: string;
  generatedAt: string;
};

export type PageType =
  | "home"
  | "product"
  | "category"
  | "blog"
  | "help"
  | "legal"
  | "company"
  | "contact"
  | "landing"
  | "account"
  | "other";

export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  home: "Home",
  product: "Product",
  category: "Category",
  blog: "Blog / Magazine",
  help: "Help / FAQ",
  legal: "Legal",
  company: "Company",
  contact: "Contact",
  landing: "Landing page",
  account: "Account / Cart",
  other: "Other",
};

export type SitemapNode = {
  /** Path prefix, e.g. "/blog" (root = "/"). */
  path: string;
  name: string;
  count: number;
  type: PageType;
  samples: string[];
  children: SitemapNode[];
  /** Number of child sections collapsed into "more". */
  more?: number;
};

export type SitemapData = {
  domain: string;
  origin: string;
  robots: {
    url: string;
    found: boolean;
    sitemaps: string[];
    aiBots: { bot: string; company: string; status: "allowed" | "blocked" | "partial" }[];
  };
  sitemaps: { url: string; kind: "index" | "urlset" | "text"; urls: number; error?: string }[];
  totalUrls: number;
  truncated: boolean;
  pageTypes: Partial<Record<PageType, number>>;
  languages: { code: string; count: number }[];
  lastmod: { newest: string | null; oldest: string | null; updatedLast30d: number; withDate: number };
  tree: SitemapNode;
  /** Section paths marked as important by the user. */
  important: string[];
  generatedAt: string;
};

export type Persona = {
  id: string;
  name: string;
  role: string;
  description: string;
  goals: string[];
  pains: string[];
  questions: string[];
  funnelStage: FunnelStage;
  /** Rough share of the audience in percent (optional). */
  share?: number | null;
  /** "manual" = created or edited by a user (kept when the AI analysis is re-run). */
  source?: "ai" | "manual";
};

export type PersonasData = { personas: Persona[]; generatedAt: string | null };

export type ProfileExtra = {
  valueProps: string[];
  tone: string;
  categories: string[];
  audience: string;
  differentiators: string[];
  generatedAt?: string | null;
};

export type BrandProfile = {
  name: string;
  description: string;
  industry: string;
  aliases: string[];
  domains: string[];
  primaryDomain: string;
  country: string;
  language: string;
} & ProfileExtra;

export type ProductStreamConfig = {
  source: "feed" | "file" | "api" | null;
  feedUrl: string | null;
  syncDaily: boolean;
  tokenPrefix: string | null;
  lastImport: { at: string; source: "feed" | "file" | "api"; received: number; created: number; updated: number; skipped: number } | null;
  lastError: string | null;
  status: "connected" | "error" | "pending" | "disconnected" | null;
};

export type CatalogProduct = {
  id: string;
  sku: string | null;
  name: string;
  url: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  category: string | null;
  brand: string | null;
  availability: string | null;
  source: "feed" | "file" | "api" | null;
  updatedAt: string;
};

export type ContextCategory =
  | "business_overview"
  | "goal"
  | "positioning"
  | "audience"
  | "writing"
  | "competitors"
  | "key_pages"
  | "research_log"
  | "other";

export const CONTEXT_CATEGORY_LABELS: Record<ContextCategory, string> = {
  business_overview: "Business overview",
  goal: "Current goal",
  positioning: "Positioning",
  audience: "Audience",
  writing: "Writing preferences",
  competitors: "Competitors",
  key_pages: "Key pages",
  research_log: "Research log",
  other: "Other",
};

export type ContextNote = {
  id: string;
  category: ContextCategory;
  title: string;
  body: string;
  pinned: boolean;
  updatedBy: "user" | "agent" | "mcp";
  updatedAt: string;
  createdAt: string;
};

/* ───────────────────────────── Brand lookup ───────────────────────────── */

export type LookupPlatform = "chat_gpt" | "google";

export const LOOKUP_PLATFORM_LABELS: Record<LookupPlatform, string> = {
  chat_gpt: "ChatGPT",
  google: "Google AI Overview",
};

export type BrandLookupParams = {
  query: string;
  competitors: string[];
  scope: "domain" | "subdomains";
  country: string;
  locationCode: number;
  languageCode: string;
};

export type BrandLookupResult = {
  target: { type: "domain" | "keyword"; value: string };
  perPlatform: { platform: LookupPlatform; status: "ok" | "error"; mentions: number | null; aiSearchVolume: number | null; error?: string; locationNote?: string }[];
  totalMentions: number | null;
  totalAiSearchVolume: number | null;
  topPages: {
    url: string;
    domain: string;
    platform: LookupPlatform;
    mentions: number | null;
    capturedVolume: number | null;
    prompts: string[];
    isTarget: boolean;
  }[];
  topQueries: {
    question: string;
    platform: LookupPlatform;
    aiSearchVolume: number | null;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    citedSources: { url: string; domain: string; title: string | null }[];
    brandsMentioned: string[];
  }[];
  monthlyVolume: { month: string; volume: number }[];
  shareOfVoice: {
    entries: { key: string; label: string; mentions: number | null; sharePct: number | null; isTarget: boolean }[];
    platforms: LookupPlatform[];
  } | null;
  hasData: boolean;
  fetchedAt: string;
};

export type LookupHistoryItem = {
  id: string;
  kind: "brand_lookup" | "prompt_explorer";
  query: string;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  costUsd: number;
  createdAt: string;
  params: Record<string, unknown>;
  createdByName: string | null;
};

/* ───────────────────────────── Prompt explorer ───────────────────────────── */

export type ExplorerModel = "chat_gpt" | "claude" | "gemini" | "perplexity" | "autoseo";

export const EXPLORER_MODELS: { id: ExplorerModel; label: string; engine: string; accent: string; provider: "dataforseo" | "internal" }[] = [
  { id: "chat_gpt", label: "ChatGPT", engine: "chatgpt", accent: "#10a37f", provider: "dataforseo" },
  { id: "claude", label: "Claude", engine: "claude", accent: "#d97757", provider: "dataforseo" },
  { id: "gemini", label: "Gemini", engine: "gemini", accent: "#4285f4", provider: "dataforseo" },
  { id: "perplexity", label: "Perplexity", engine: "perplexity", accent: "#7c3aed", provider: "dataforseo" },
  { id: "autoseo", label: "Local agent / API", engine: "claude", accent: "#16a34a", provider: "internal" },
];

export const EXPLORER_COUNTRIES = ["US", "GB", "CA", "AU", "IE", "DE", "FR", "ES", "IT", "NL", "PT", "PL", "SE", "NO", "DK", "BR", "MX", "IN", "JP", "KR", "SG", "HK", "TW", "ZA"] as const;

export type ExplorerParams = {
  prompt: string;
  models: ExplorerModel[];
  webSearch: boolean;
  country: string;
  highlightBrand: string | null;
};

export type ExplorerCitation = { url: string; domain: string; title: string | null; matchedBrand: boolean };

export type ExplorerAnswer = {
  model: ExplorerModel;
  status: "ok" | "error";
  provider: string;
  modelName: string | null;
  text: string;
  thinking: string | null;
  citations: ExplorerCitation[];
  fanOutQueries: string[];
  outputTokens: number | null;
  webSearch: boolean;
  brandMentioned: boolean | null;
  costUsd: number;
  durationMs: number;
  error?: string;
};

export type ExplorerResult = { answers: ExplorerAnswer[]; fetchedAt: string };
