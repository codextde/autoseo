/**
 * AI platforms that send human visitors (referrals) to a website, and the classifier that maps an
 * analytics source / referrer / utm_source value to one of them.
 *
 * PURE module (no "server-only", relative imports only) — used by syncs, queries, UI and tests.
 */
import type { EngineId } from "../../lib/engines";

export type AiPlatform = {
  id: string;
  name: string;
  color: string;
  /** Engine id for `EngineIcon` (monogram fallback when absent). */
  engineId?: EngineId;
  /** Hostnames (subdomains match too). Entries with a path ("bing.com/chat") require the path prefix. */
  domains: string[];
  /** Exact source tokens (e.g. utm_source=chatgpt) — matched as whole words. */
  tokens: string[];
};

export const AI_PLATFORMS: AiPlatform[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    color: "#10a37f",
    engineId: "chatgpt",
    domains: ["chatgpt.com", "chat.openai.com", "openai.com"],
    tokens: ["chatgpt", "openai", "chat-gpt"],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    color: "#20808d",
    engineId: "perplexity",
    domains: ["perplexity.ai", "pplx.ai"],
    tokens: ["perplexity"],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    color: "#8e75ff",
    engineId: "gemini",
    domains: ["gemini.google.com", "bard.google.com", "aistudio.google.com"],
    tokens: ["gemini", "bard"],
  },
  {
    id: "claude",
    name: "Claude",
    color: "#d97757",
    engineId: "claude",
    domains: ["claude.ai", "claude.com"],
    tokens: ["claude", "anthropic"],
  },
  {
    id: "copilot",
    name: "Copilot",
    color: "#0078d4",
    engineId: "copilot",
    domains: ["copilot.microsoft.com", "copilot.cloud.microsoft", "edgeservices.bing.com", "bing.com/chat", "sydney.bing.com"],
    tokens: ["copilot", "bingchat", "bing-chat"],
  },
  {
    id: "meta_ai",
    name: "Meta AI",
    color: "#0866ff",
    domains: ["meta.ai"],
    tokens: ["metaai", "meta-ai", "meta.ai"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    color: "#4d6bfe",
    engineId: "deepseek",
    domains: ["chat.deepseek.com", "deepseek.com"],
    tokens: ["deepseek"],
  },
  {
    id: "grok",
    name: "Grok",
    color: "#111111",
    engineId: "grok",
    domains: ["grok.com", "x.ai"],
    tokens: ["grok"],
  },
  {
    id: "mistral",
    name: "Mistral Le Chat",
    color: "#fa520f",
    engineId: "mistral",
    domains: ["chat.mistral.ai", "mistral.ai"],
    tokens: ["mistral", "lechat", "le-chat"],
  },
  { id: "you", name: "You.com", color: "#6d28d9", domains: ["you.com"], tokens: ["youchat", "you.com"] },
  { id: "phind", name: "Phind", color: "#5b21b6", domains: ["phind.com"], tokens: ["phind"] },
  { id: "poe", name: "Poe", color: "#5d5cde", domains: ["poe.com"], tokens: ["poe.com"] },
  { id: "duck_ai", name: "Duck.ai", color: "#de5833", domains: ["duck.ai", "duckduckgo.com/aichat", "duckduckgo.com/chat"], tokens: ["duck.ai", "duckai"] },
  { id: "huggingchat", name: "HuggingChat", color: "#ffb000", domains: ["huggingface.co/chat", "hf.co/chat"], tokens: ["huggingchat"] },
  { id: "pi", name: "Pi", color: "#0f766e", domains: ["pi.ai", "heypi.com"], tokens: ["pi.ai", "heypi"] },
  { id: "kagi", name: "Kagi Assistant", color: "#ffb319", domains: ["kagi.com/assistant"], tokens: ["kagi-assistant"] },
  { id: "qwen", name: "Qwen", color: "#615ced", domains: ["chat.qwen.ai", "qwen.ai", "tongyi.aliyun.com"], tokens: ["qwen"] },
  { id: "kimi", name: "Kimi", color: "#111827", domains: ["kimi.com", "kimi.moonshot.cn", "kimi.ai"], tokens: ["kimi"] },
  { id: "character_ai", name: "Character.AI", color: "#1f2937", domains: ["character.ai"], tokens: ["character.ai", "characterai"] },
];

export const AI_PLATFORM_MAP = new Map(AI_PLATFORMS.map((p) => [p.id, p]));

export function getAiPlatform(id: string): AiPlatform | undefined {
  return AI_PLATFORM_MAP.get(id);
}

type DomainRule = { host: string; path: string; platform: string };
const DOMAIN_RULES: DomainRule[] = AI_PLATFORMS.flatMap((p) =>
  p.domains.map((d) => {
    const [host, ...rest] = d.split("/");
    return { host: host!.toLowerCase(), path: rest.length ? `/${rest.join("/")}`.toLowerCase() : "", platform: p.id };
  }),
)
  // Longer hosts first so "chat.deepseek.com" wins over generic matches.
  .sort((a, b) => b.host.length + b.path.length - (a.host.length + a.path.length));

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TOKEN_RULES = AI_PLATFORMS.flatMap((p) =>
  p.tokens.map((t) => ({ re: new RegExp(`(^|[^a-z0-9])${escapeRegex(t.toLowerCase())}($|[^a-z0-9])`), platform: p.id })),
);

/** Splits "host/path" (with or without protocol) into lowercase host and path. */
function parseHostPath(value: string): { host: string; path: string } | null {
  let v = value.trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const m = v.match(/^([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?(\/[^?#\s]*)?/);
  if (!m) return null;
  return { host: m[1]!.replace(/^www\./, ""), path: m[2] ?? "" };
}

function matchDomain(value: string): string | null {
  const hp = parseHostPath(value);
  if (!hp) return null;
  for (const r of DOMAIN_RULES) {
    if (hp.host === r.host || hp.host.endsWith(`.${r.host}`)) {
      if (!r.path || hp.path.startsWith(r.path)) return r.platform;
    }
  }
  return null;
}

function matchToken(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  for (const r of TOKEN_RULES) if (r.re.test(v)) return r.platform;
  return null;
}

/**
 * Maps an analytics source value (GA4 sessionSource, "source / medium", utm_source, Matomo
 * referrer name) and/or a referrer URL to an AI platform id. Returns null for non-AI traffic.
 */
export function classifyAiSource(source: string | null | undefined, referrer?: string | null): string | null {
  const candidates: string[] = [];
  if (referrer) candidates.push(referrer);
  if (source) {
    // "chatgpt.com / referral" → "chatgpt.com"
    const s = source.split(" / ")[0] ?? source;
    candidates.push(s);
  }
  for (const c of candidates) {
    const byDomain = matchDomain(c);
    if (byDomain) return byDomain;
  }
  for (const c of candidates) {
    // Word tokens only apply to non-hostname values (utm_source=chatgpt, "Perplexity"); hostnames
    // of other sites (e.g. gemini.com, the crypto exchange) must never match by token.
    if (parseHostPath(c)) continue;
    const byToken = matchToken(c);
    if (byToken) return byToken;
  }
  return null;
}

/** RE2 alternation of every domain/token (GA4 PARTIAL_REGEXP, Piwik `matches`). Case-insensitive usage required. */
export function aiSourcePattern(): string {
  const parts = new Set<string>();
  for (const p of AI_PLATFORMS) {
    for (const d of p.domains) parts.add(escapeRegex(d.split("/")[0]!.toLowerCase()));
    for (const t of p.tokens) parts.add(escapeRegex(t.toLowerCase()));
  }
  return [...parts].sort((a, b) => b.length - a.length).join("|");
}

/** GA4 `stringFilter` value for sessionSource (matchType PARTIAL_REGEXP, caseSensitive false). */
export const GA4_AI_SOURCE_REGEX = aiSourcePattern();

/** Piwik PRO re2 regex (`matches` operator) with inline case-insensitivity. */
export const PIWIK_AI_SOURCE_REGEX = `(?i)(${aiSourcePattern()})`;

/** Domains used for Matomo segments (`referrerUrl=@domain` OR-ed). */
export function aiReferrerDomains(): string[] {
  const out = new Set<string>();
  for (const p of AI_PLATFORMS) for (const d of p.domains) out.add(d.split("/")[0]!.toLowerCase());
  return [...out];
}

/** Monogram letters for platforms without an engine icon. */
export function platformMonogram(id: string): string {
  const p = getAiPlatform(id);
  const name = p?.name ?? id;
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : name.slice(0, 2)).toUpperCase();
}
