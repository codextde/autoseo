/**
 * AI answer engines tracked for AI visibility (finseo parity: 11 engines).
 * Provider capabilities describe which backends can produce answers for the engine.
 */
export type EngineId =
  | "chatgpt"
  | "chatgpt_gui"
  | "perplexity"
  | "ai_overview"
  | "google_ai_mode"
  | "gemini"
  | "claude"
  | "copilot"
  | "grok"
  | "mistral"
  | "deepseek";

export type EngineProvider = "dataforseo" | "api" | "agent";

export type EngineInfo = {
  id: EngineId;
  name: string;
  shortName: string;
  vendor: string;
  color: string;
  /** Backends that can answer prompts for this engine, in "auto" preference order. */
  providers: EngineProvider[];
  /** Settings key in Admin → AI Providers that enables the direct API provider. */
  apiKeySetting?: "openaiApiKey" | "perplexityApiKey" | "geminiApiKey" | "anthropicApiKey" | "xaiApiKey" | "mistralApiKey" | "deepseekApiKey";
  /** Which local agent CLI can emulate this engine (with web search). */
  agentRuntime?: "claude" | "codex";
  description: string;
};

export const ENGINES: EngineInfo[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    shortName: "ChatGPT",
    vendor: "OpenAI",
    color: "#10a37f",
    providers: ["dataforseo", "api", "agent"],
    apiKeySetting: "openaiApiKey",
    agentRuntime: "codex",
    description: "ChatGPT with web search (search-grounded answers and citations).",
  },
  {
    id: "chatgpt_gui",
    name: "ChatGPT (App)",
    shortName: "ChatGPT App",
    vendor: "OpenAI",
    color: "#0f766e",
    providers: ["dataforseo", "agent"],
    agentRuntime: "codex",
    description: "Answers as rendered in the ChatGPT app incl. shopping cards.",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    shortName: "Perplexity",
    vendor: "Perplexity",
    color: "#20808d",
    providers: ["dataforseo", "api"],
    apiKeySetting: "perplexityApiKey",
    description: "Perplexity Sonar answers with sources.",
  },
  {
    id: "ai_overview",
    name: "Google AI Overview",
    shortName: "AI Overview",
    vendor: "Google",
    color: "#4285f4",
    providers: ["dataforseo"],
    description: "AI Overviews shown on top of Google search results.",
  },
  {
    id: "google_ai_mode",
    name: "Google AI Mode",
    shortName: "AI Mode",
    vendor: "Google",
    color: "#1a73e8",
    providers: ["dataforseo"],
    description: "Google's conversational AI Mode (where available).",
  },
  {
    id: "gemini",
    name: "Gemini",
    shortName: "Gemini",
    vendor: "Google",
    color: "#8e75ff",
    providers: ["dataforseo", "api"],
    apiKeySetting: "geminiApiKey",
    description: "Gemini with Google Search grounding.",
  },
  {
    id: "claude",
    name: "Claude",
    shortName: "Claude",
    vendor: "Anthropic",
    color: "#d97757",
    providers: ["dataforseo", "api", "agent"],
    apiKeySetting: "anthropicApiKey",
    agentRuntime: "claude",
    description: "Claude with web search.",
  },
  {
    id: "copilot",
    name: "Microsoft Copilot",
    shortName: "Copilot",
    vendor: "Microsoft",
    color: "#0078d4",
    providers: ["dataforseo"],
    description: "Microsoft Copilot (Bing-grounded).",
  },
  {
    id: "grok",
    name: "Grok",
    shortName: "Grok",
    vendor: "xAI",
    color: "#111111",
    providers: ["api"],
    apiKeySetting: "xaiApiKey",
    description: "xAI Grok with live search.",
  },
  {
    id: "mistral",
    name: "Mistral",
    shortName: "Mistral",
    vendor: "Mistral AI",
    color: "#fa520f",
    providers: ["api"],
    apiKeySetting: "mistralApiKey",
    description: "Mistral Le Chat models with web search.",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    shortName: "DeepSeek",
    vendor: "DeepSeek",
    color: "#4d6bfe",
    providers: ["api"],
    apiKeySetting: "deepseekApiKey",
    description: "DeepSeek chat models.",
  },
];

export const ENGINE_MAP = new Map(ENGINES.map((e) => [e.id, e]));
export const DEFAULT_ENGINES: EngineId[] = ["chatgpt", "perplexity", "ai_overview"];

export function getEngine(id: string): EngineInfo | undefined {
  return ENGINE_MAP.get(id as EngineId);
}

/** Well-known AI crawler / user-agent tokens (bot traffic + crawlability). */
export const AI_BOTS = [
  { token: "GPTBot", name: "GPTBot", company: "OpenAI", purpose: "training" },
  { token: "ChatGPT-User", name: "ChatGPT-User", company: "OpenAI", purpose: "user" },
  { token: "OAI-SearchBot", name: "OAI-SearchBot", company: "OpenAI", purpose: "search" },
  { token: "ClaudeBot", name: "ClaudeBot", company: "Anthropic", purpose: "training" },
  { token: "Claude-User", name: "Claude-User", company: "Anthropic", purpose: "user" },
  { token: "Claude-SearchBot", name: "Claude-SearchBot", company: "Anthropic", purpose: "search" },
  { token: "Claude-Web", name: "Claude-Web", company: "Anthropic", purpose: "user" },
  { token: "anthropic-ai", name: "anthropic-ai", company: "Anthropic", purpose: "training" },
  { token: "PerplexityBot", name: "PerplexityBot", company: "Perplexity", purpose: "search" },
  { token: "Perplexity-User", name: "Perplexity-User", company: "Perplexity", purpose: "user" },
  { token: "Google-Extended", name: "Google-Extended", company: "Google", purpose: "training" },
  { token: "Googlebot", name: "Googlebot", company: "Google", purpose: "search" },
  { token: "GoogleOther", name: "GoogleOther", company: "Google", purpose: "training" },
  { token: "Bingbot", name: "Bingbot", company: "Microsoft", purpose: "search" },
  { token: "Applebot-Extended", name: "Applebot-Extended", company: "Apple", purpose: "training" },
  { token: "Applebot", name: "Applebot", company: "Apple", purpose: "search" },
  { token: "meta-externalagent", name: "Meta-ExternalAgent", company: "Meta", purpose: "training" },
  { token: "FacebookBot", name: "FacebookBot", company: "Meta", purpose: "training" },
  { token: "Bytespider", name: "Bytespider", company: "ByteDance", purpose: "training" },
  { token: "Amazonbot", name: "Amazonbot", company: "Amazon", purpose: "search" },
  { token: "DuckAssistBot", name: "DuckAssistBot", company: "DuckDuckGo", purpose: "user" },
  { token: "cohere-ai", name: "cohere-ai", company: "Cohere", purpose: "training" },
  { token: "MistralAI-User", name: "MistralAI-User", company: "Mistral", purpose: "user" },
  { token: "YouBot", name: "YouBot", company: "You.com", purpose: "search" },
  { token: "CCBot", name: "CCBot", company: "Common Crawl", purpose: "training" },
  { token: "AhrefsBot", name: "AhrefsBot", company: "Ahrefs", purpose: "seo" },
  { token: "SemrushBot", name: "SemrushBot", company: "Semrush", purpose: "seo" },
] as const;
