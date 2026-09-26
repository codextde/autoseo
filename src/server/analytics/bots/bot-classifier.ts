/**
 * Identifies AI / search crawlers from a User-Agent string (pure).
 * Uses the shared `AI_BOTS` list; longer tokens win so e.g. "Applebot-Extended" beats "Applebot".
 */
import { AI_BOTS } from "../../../lib/engines";

export type BotInfo = (typeof AI_BOTS)[number];

const BY_LOWER = new Map<string, BotInfo>(AI_BOTS.map((b) => [b.token.toLowerCase(), b]));
const ORDERED_TOKENS = [...AI_BOTS].map((b) => b.token).sort((a, b) => b.length - a.length);

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Regex source matching any known bot token (case-insensitive) — also used by the Cloudflare Worker. */
export const BOT_UA_PATTERN = ORDERED_TOKENS.map(escapeRe).join("|");
const BOT_RE = new RegExp(BOT_UA_PATTERN, "i");

export function identifyBot(userAgent: string | null | undefined): BotInfo | null {
  if (!userAgent) return null;
  const m = BOT_RE.exec(userAgent);
  if (!m) return null;
  // The alternation is ordered longest-first, but a shorter token can still match earlier in the
  // string; prefer the longest token that occurs anywhere in the UA.
  const lower = userAgent.toLowerCase();
  for (const token of ORDERED_TOKENS) {
    if (lower.includes(token.toLowerCase())) return BY_LOWER.get(token.toLowerCase()) ?? null;
  }
  return BY_LOWER.get(m[0].toLowerCase()) ?? null;
}

export function isKnownBot(userAgent: string | null | undefined): boolean {
  return !!userAgent && BOT_RE.test(userAgent);
}

export function getBotInfo(token: string): BotInfo | undefined {
  return BY_LOWER.get(token.toLowerCase());
}

export const ALL_BOTS = AI_BOTS;
