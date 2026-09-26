import "server-only";
import { db } from "@/server/db/client";
import { botIpRanges } from "@/server/db/schema";
import { compileCidrs, ipInCompiled, parseIp, type CompiledCidr } from "./cidr";

/** Published IP range lists of crawler operators (JSON with `prefixes[].ipv4Prefix|ipv6Prefix`). */
export const RANGE_SOURCES: { key: string; url: string; operator: string; bots: string[] }[] = [
  { key: "openai-gptbot", url: "https://openai.com/gptbot.json", operator: "OpenAI", bots: ["GPTBot"] },
  { key: "openai-searchbot", url: "https://openai.com/searchbot.json", operator: "OpenAI", bots: ["OAI-SearchBot"] },
  { key: "openai-chatgpt-user", url: "https://openai.com/chatgpt-user.json", operator: "OpenAI", bots: ["ChatGPT-User"] },
  {
    key: "anthropic",
    url: "https://claude.com/crawling/bots.json",
    operator: "Anthropic",
    bots: ["ClaudeBot", "Claude-User", "Claude-SearchBot", "Claude-Web", "anthropic-ai"],
  },
  { key: "perplexity-bot", url: "https://www.perplexity.ai/perplexitybot.json", operator: "Perplexity", bots: ["PerplexityBot"] },
  { key: "perplexity-user", url: "https://www.perplexity.ai/perplexity-user.json", operator: "Perplexity", bots: ["Perplexity-User"] },
  {
    key: "google-googlebot",
    url: "https://developers.google.com/static/search/apis/ipranges/googlebot.json",
    operator: "Google",
    bots: ["Googlebot", "Google-Extended", "GoogleOther"],
  },
  {
    key: "google-special",
    url: "https://developers.google.com/static/search/apis/ipranges/special-crawlers.json",
    operator: "Google",
    bots: ["Googlebot", "Google-Extended", "GoogleOther"],
  },
  {
    key: "google-user-fetchers",
    url: "https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers.json",
    operator: "Google",
    bots: ["Googlebot", "GoogleOther"],
  },
  {
    key: "google-user-fetchers-google",
    url: "https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers-google.json",
    operator: "Google",
    bots: ["Googlebot", "GoogleOther"],
  },
  { key: "bingbot", url: "https://www.bing.com/toolbox/bingbot.json", operator: "Microsoft", bots: ["Bingbot"] },
  { key: "applebot", url: "https://search.developer.apple.com/applebot.json", operator: "Apple", bots: ["Applebot", "Applebot-Extended"] },
];

const BOT_TO_KEYS = new Map<string, string[]>();
for (const s of RANGE_SOURCES) for (const b of s.bots) BOT_TO_KEYS.set(b.toLowerCase(), [...(BOT_TO_KEYS.get(b.toLowerCase()) ?? []), s.key]);

/** Bots whose requests can be verified against a published list. */
export function isVerifiableBot(bot: string): boolean {
  return BOT_TO_KEYS.has(bot.toLowerCase());
}

/** Extracts CIDR strings from a published list (tolerant of shape differences). */
export function extractPrefixes(json: unknown): string[] {
  const out: string[] = [];
  const list = (json as { prefixes?: unknown })?.prefixes;
  if (Array.isArray(list)) {
    for (const p of list) {
      if (typeof p === "string") out.push(p);
      else if (p && typeof p === "object") {
        const o = p as Record<string, unknown>;
        for (const k of ["ipv4Prefix", "ipv6Prefix", "ip_prefix", "ipv6_prefix", "prefix", "cidr"]) {
          if (typeof o[k] === "string") out.push(o[k] as string);
        }
      }
    }
  }
  return out.filter((c) => /^[0-9a-f:.]+\/\d{1,3}$/i.test(c.trim())).map((c) => c.trim());
}

async function fetchList(url: string): Promise<string[]> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "AutoSEO/1.0 (+bot verification)" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 5_000_000) throw new Error("List too large");
  const prefixes = extractPrefixes(JSON.parse(text));
  if (!prefixes.length) throw new Error("No prefixes in list");
  return prefixes;
}

/** Fetches every list and stores it (lists that fail keep their previous prefixes). */
export async function refreshBotIpRanges(): Promise<{ updated: string[]; failed: { key: string; error: string }[] }> {
  const updated: string[] = [];
  const failed: { key: string; error: string }[] = [];
  await Promise.all(
    RANGE_SOURCES.map(async (s) => {
      try {
        const prefixes = await fetchList(s.url);
        await db
          .insert(botIpRanges)
          .values({ key: s.key, url: s.url, prefixes, fetchedAt: new Date(), error: null })
          .onConflictDoUpdate({ target: botIpRanges.key, set: { url: s.url, prefixes, fetchedAt: new Date(), error: null, updatedAt: new Date() } });
        updated.push(s.key);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        failed.push({ key: s.key, error });
        await db
          .insert(botIpRanges)
          .values({ key: s.key, url: s.url, prefixes: [], error })
          .onConflictDoUpdate({ target: botIpRanges.key, set: { error, updatedAt: new Date() } });
      }
    }),
  );
  cache = null;
  return { updated, failed };
}

type Loaded = { at: number; byKey: Map<string, CompiledCidr[]>; fetchedAt: Map<string, Date | null> };
let cache: Loaded | null = null;
let loading: Promise<Loaded> | null = null;
const CACHE_MS = 10 * 60_000;
const STALE_MS = 36 * 60 * 60_000;

async function load(): Promise<Loaded> {
  let rows = await db.select().from(botIpRanges);
  const newest = rows.reduce((m, r) => Math.max(m, r.fetchedAt?.getTime() ?? 0), 0);
  // First use (or lists far out of date): fetch inline once so verification works immediately.
  if (!rows.some((r) => r.prefixes.length) || Date.now() - newest > STALE_MS * 4) {
    await refreshBotIpRanges().catch((err) => console.error("[bots] ip range refresh failed", err));
    rows = await db.select().from(botIpRanges);
  }
  const byKey = new Map<string, CompiledCidr[]>();
  const fetchedAt = new Map<string, Date | null>();
  for (const r of rows) {
    byKey.set(r.key, compileCidrs(r.prefixes));
    fetchedAt.set(r.key, r.fetchedAt);
  }
  return { at: Date.now(), byKey, fetchedAt };
}

async function getLoaded(): Promise<Loaded> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  if (!loading) {
    loading = load()
      .then((l) => (cache = l))
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export type BotVerifier = (bot: string, ip: string | null) => boolean | null;

/**
 * Returns a synchronous verifier: true = IP inside the operator's published ranges, false =
 * outside (likely spoofed UA), null = no published list for this bot / no IP / lists unavailable.
 */
export async function getBotVerifier(): Promise<BotVerifier> {
  const loaded = await getLoaded();
  const memo = new Map<string, boolean | null>();
  return (bot, ip) => {
    if (!ip) return null;
    const keys = BOT_TO_KEYS.get(bot.toLowerCase());
    if (!keys) return null;
    const memoKey = `${bot}|${ip}`;
    const hit = memo.get(memoKey);
    if (hit !== undefined) return hit;
    const parsed = parseIp(ip);
    let result: boolean | null = null;
    if (parsed) {
      const lists = keys.map((k) => loaded.byKey.get(k)).filter((l): l is CompiledCidr[] => !!l && l.length > 0);
      result = lists.length ? lists.some((l) => ipInCompiled(parsed, l)) : null;
    }
    if (memo.size < 50_000) memo.set(memoKey, result);
    return result;
  };
}

/** Status of the cached lists (for the Sync tab). */
export async function getIpRangeStatus() {
  const rows = await db.select().from(botIpRanges);
  return RANGE_SOURCES.map((s) => {
    const r = rows.find((x) => x.key === s.key);
    return {
      key: s.key,
      operator: s.operator,
      bots: s.bots,
      url: s.url,
      prefixes: r?.prefixes.length ?? 0,
      fetchedAt: r?.fetchedAt?.toISOString() ?? null,
      error: r?.error ?? null,
    };
  });
}
