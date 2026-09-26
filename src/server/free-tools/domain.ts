/**
 * Input normalization for the free tools (port of open-seo `normalizeDomain`). Pure — safe for unit tests.
 */

const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** URL or bare host → lowercase hostname without `www.`; null when it isn't a valid multi-label hostname. */
export function normalizeDomain(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let hostname: string;
  try {
    hostname = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  const domain = hostname.replace(/^www\./, "").toLowerCase();
  if (!HOSTNAME_RE.test(domain)) return null;
  // IP literals (127.0.0.1, 169.254.169.254, 2130706433 → 0.0.0.0-style) are not domains: the TLD is never numeric.
  if (/^\d+$/.test(domain.slice(domain.lastIndexOf(".") + 1))) return null;
  return domain;
}

/** Keyword generator seed: lowercased, whitespace-collapsed (open-seo `core-v2` cache key rule). */
export function normalizeKeywordSeed(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Rate-limit / visitor identity for an IP: IPv4 as-is, IPv6 grouped by its /64 (one subscriber usually owns a whole
 * /64, so rotating addresses inside it must not reset the allowance).
 */
export function ipIdentity(ip: string): string {
  if (!ip.includes(":")) return ip;
  // IPv4-mapped IPv6 (Node sockets report "::ffff:203.0.113.7") is an IPv4 client.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1]!;
  const [head = "", tail] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/** Current UTC day, `YYYY-MM-DD`. */
export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
