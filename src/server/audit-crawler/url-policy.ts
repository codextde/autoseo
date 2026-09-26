/**
 * SSRF policy (port of open-seo `url-policy.ts`, hardened for a self-hosted Node server).
 * Pure / synchronous parts only — DNS-level enforcement lives in `safe-fetch.ts`, which validates
 * every resolved address of every connection (so every redirect hop is covered, and DNS rebinding
 * between check and connect is impossible).
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "metadata.azure.com",
  "169.254.169.254",
  "169.254.170.2",
  "100.100.100.200",
  "fd00:ec2::254",
  "instance-data",
  "instance-data.ec2.internal",
]);

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal", ".home.arpa", ".lan", ".intranet", ".corp"];

export class CrawlTargetBlockedError extends Error {
  code = "CRAWL_TARGET_BLOCKED" as const;
  constructor(message = "This URL points to a private or internal address and cannot be crawled.") {
    super(message);
  }
}

export class InvalidUrlError extends Error {
  code = "VALIDATION_ERROR" as const;
  constructor(message = "Please enter a valid http(s) URL.") {
    super(message);
  }
}

export function normalizeHost(hostname: string): string {
  let host = hostname.toLowerCase().trim();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.includes("%")) host = host.split("%", 1)[0]!;
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

/** Parses dotted IPv4 (strict 4-part decimal). */
function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  if (nums.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return nums;
}

export function isPrivateIpv4(host: string): boolean {
  const parts = parseIpv4(normalizeHost(host));
  if (!parts) return false;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this" network
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

/** Expands an IPv6 literal into 8 hextets (null when invalid). Supports embedded IPv4. */
function expandIpv6(input: string): number[] | null {
  let host = normalizeHost(input);
  if (!host.includes(":")) return null;
  // Embedded IPv4 in the last 32 bits (::ffff:1.2.3.4, 64:ff9b::1.2.3.4)
  const lastColon = host.lastIndexOf(":");
  const tail = host.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    host = `${host.slice(0, lastColon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...Array.from({ length: missing }, () => "0"), ...rest];
  }
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function hextetsToIpv4(h: number[], hiIdx: number): string {
  const hi = h[hiIdx]!;
  const lo = h[hiIdx + 1]!;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

export function isPrivateIpv6(host: string): boolean {
  const h = expandIpv6(host);
  if (!h) return false;
  const allZeroUntil = (n: number) => h.slice(0, n).every((x) => x === 0);
  // :: (unspecified) and ::1 (loopback)
  if (allZeroUntil(7) && (h[7] === 0 || h[7] === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (allZeroUntil(5) && h[5] === 0xffff) return isPrivateIpv4(hextetsToIpv4(h, 6));
  if (allZeroUntil(6)) return isPrivateIpv4(hextetsToIpv4(h, 6));
  // NAT64 64:ff9b::/96 → check embedded v4
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return isPrivateIpv4(hextetsToIpv4(h, 6));
  const first = h[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && h[1] === 0x0db8) return true; // documentation
  // 6to4 2002::/16 embeds an IPv4 in hextets 1-2
  if (first === 0x2002) return isPrivateIpv4(hextetsToIpv4(h, 1));
  return false;
}

export function isIpLiteral(host: string): boolean {
  const normalized = normalizeHost(host);
  return parseIpv4(normalized) !== null || normalized.includes(":");
}

/** True for addresses (not hostnames) we must never connect to. */
export function isPrivateAddress(address: string): boolean {
  const normalized = normalizeHost(address);
  if (parseIpv4(normalized)) return isPrivateIpv4(normalized);
  if (normalized.includes(":")) {
    // Unparseable IPv6 → treat as blocked (fail closed).
    return expandIpv6(normalized) === null ? true : isPrivateIpv6(normalized);
  }
  return false;
}

/**
 * Hostname-level block list: internal names, metadata endpoints, private IP literals, and
 * numeric hostname tricks (decimal/hex/octal IPv4 like `2130706433` or `0x7f.1`).
 */
export function isBlockedHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (!host.includes(".") && !host.includes(":")) return true; // single-label names resolve via local search domains
  if (isIpLiteral(host)) return isPrivateAddress(host);
  // Non-canonical numeric forms (WHATWG URL parsing canonicalizes most, but be defensive)
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(host)) return true;
  return false;
}

/** Synchronous check for discovered URLs (links, sitemap entries, redirect targets). */
export function isCrawlableUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && !["80", "443", "8080", "8443"].includes(parsed.port)) return false;
  return !isBlockedHost(parsed.hostname);
}

/**
 * Normalizes user input into an absolute URL (adds https://, strips the hash) and applies the
 * synchronous host policy. DNS-level validation happens on connect (safe-fetch).
 */
export function normalizeStartUrlInput(input: string): string {
  let raw = input.trim();
  if (!raw) throw new InvalidUrlError("Please enter a URL.");
  if (!/^https?:\/\//i.test(raw)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^:]+:\d+/.test(raw)) throw new InvalidUrlError();
    raw = `https://${raw}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InvalidUrlError();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new InvalidUrlError();
  if (!isCrawlableUrl(parsed.toString())) throw new CrawlTargetBlockedError();
  parsed.hash = "";
  return parsed.toString();
}
