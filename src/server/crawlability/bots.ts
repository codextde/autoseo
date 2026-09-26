/**
 * AI crawler profiles for the crawlability check: the robots.txt tokens from `AI_BOTS` plus the
 * real HTTP user-agent string each crawler sends (null = robots.txt-only control token that never
 * fetches pages itself, e.g. Google-Extended).
 */
import { AI_BOTS } from "../../lib/engines";

export type BotPurpose = "training" | "search" | "user" | "seo";

export type BotProfile = {
  token: string;
  name: string;
  company: string;
  purpose: BotPurpose;
  userAgent: string | null;
};

const USER_AGENTS: Record<string, string | null> = {
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  "ChatGPT-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  "OAI-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  "Claude-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  "Claude-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)",
  "Claude-Web": null,
  "anthropic-ai": null,
  PerplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  "Perplexity-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
  "Google-Extended": null,
  Googlebot:
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  GoogleOther: "Mozilla/5.0 (compatible; GoogleOther)",
  Bingbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/140.0.0.0 Safari/537.36",
  "Applebot-Extended": null,
  Applebot:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
  "meta-externalagent": "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
  FacebookBot: "Mozilla/5.0 (compatible; FacebookBot/1.0; +https://developers.facebook.com/docs/sharing/webmasters/facebookbot/)",
  Bytespider: "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
  Amazonbot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36",
  DuckAssistBot: "DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)",
  "cohere-ai": null,
  "MistralAI-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)",
  YouBot: "Mozilla/5.0 (compatible; YouBot/1.0; +https://about.you.com/youbot/)",
  CCBot: "CCBot/2.0 (https://commoncrawl.org/faq/)",
  AhrefsBot: "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
  SemrushBot: "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)",
};

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const BOT_PROFILES: BotProfile[] = AI_BOTS.map((b) => ({
  token: b.token,
  name: b.name,
  company: b.company,
  purpose: b.purpose as BotPurpose,
  userAgent: USER_AGENTS[b.token] ?? null,
}));

/** Weight of a bot in the AI crawlability score (SEO tool crawlers are shown but not scored). */
export function botWeight(purpose: BotPurpose): number {
  if (purpose === "seo") return 0;
  if (purpose === "training") return 1;
  return 3;
}

export const PURPOSE_LABELS: Record<BotPurpose, string> = {
  search: "AI search index",
  user: "User-triggered fetch",
  training: "Model training",
  seo: "SEO tool",
};
