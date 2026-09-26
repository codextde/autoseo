import "server-only";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";

/**
 * SSRF-safe HTTP(S) fetch for user-supplied URLs (sitemaps, robots.txt, product feeds).
 *
 * - only http/https, default ports (80/443) or explicit ports ≥ 1024 except well-known internals
 * - no credentials in URLs
 * - every resolved IP (incl. redirects, DNS rebinding) is checked at connect time via a custom
 *   `lookup` on the undici Agent; private, loopback, link-local, CGNAT, multicast and reserved
 *   ranges are rejected
 * - manual redirect handling (max 5 hops, each hop re-validated)
 * - hard timeout and response size cap (streamed), optional gzip decompression with a cap
 */

export class UnsafeUrlError extends Error {}
export class FetchLimitError extends Error {}

const BLOCKED_PORTS = new Set([22, 23, 25, 110, 143, 465, 587, 993, 995, 3306, 5432, 6379, 11211, 27017, 9200, 2375, 2376]);

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function inCidr4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** True when the IP must never be contacted from the server. */
export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return V4_BLOCKS.some(([base, bits]) => inCidr4(ip, base, bits));
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    // IPv4-mapped / translated addresses
    const mapped = lower.match(/^(?:::ffff:|::ffff:0:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]!);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(lower)) {
      const [, hi, lo] = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)!;
      const n = (parseInt(hi!, 16) << 16) + parseInt(lo!, 16);
      return isBlockedIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
    }
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (lower.startsWith("2001:db8")) return true; // documentation
    if (lower.startsWith("100::")) return true; // discard
    return false;
  }
  return true;
}

/** Validates the URL shape (scheme, credentials, port, host). Throws UnsafeUrlError. */
export function assertSafeUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    throw new UnsafeUrlError("Invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Only http(s) URLs are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new UnsafeUrlError("URL has no host.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
    throw new UnsafeUrlError("Local hosts are not allowed.");
  if (net.isIP(host) && isBlockedIp(host)) throw new UnsafeUrlError("Private or reserved IP addresses are not allowed.");
  if (!net.isIP(host) && !host.includes(".")) throw new UnsafeUrlError("Please use a fully qualified domain name.");
  if (url.port) {
    const port = Number(url.port);
    if (BLOCKED_PORTS.has(port) || (port < 1024 && port !== 80 && port !== 443)) throw new UnsafeUrlError(`Port ${port} is not allowed.`);
  }
  return url;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as dns.LookupAddress[];
    if (!list.length) return callback(Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }), "", 0);
    const bad = list.find((a) => isBlockedIp(a.address));
    if (bad) {
      return callback(Object.assign(new UnsafeUrlError(`${hostname} resolves to a private address (${bad.address}).`), { code: "EBLOCKED" }), "", 0);
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}

let agent: Dispatcher | null = null;
function safeAgent(): Dispatcher {
  if (!agent) {
    agent = new Agent({
      connect: { lookup: safeLookup as never, timeout: 10_000 },
      headersTimeout: 20_000,
      bodyTimeout: 30_000,
    });
  }
  return agent;
}

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  method?: "GET" | "HEAD";
  /** Decompress gzip payloads (e.g. sitemap.xml.gz) up to maxBytes. */
  gunzip?: boolean;
  userAgent?: string;
};

export type SafeFetchResult = {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  body: Buffer;
  truncated: boolean;
};

export const DEFAULT_UA = "Mozilla/5.0 (compatible; AutoSEO-Knowledge/1.0; +https://github.com/autoseo)";

/** Fetches a user-supplied URL with SSRF protection and limits. Never throws for HTTP status codes. */
export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 5;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let url = assertSafeUrl(input);
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await undiciFetch(url, {
        method: opts.method ?? "GET",
        redirect: "manual",
        dispatcher: safeAgent(),
        signal: controller.signal,
        headers: {
          "User-Agent": opts.userAgent ?? DEFAULT_UA,
          Accept: opts.accept ?? "*/*",
          "Accept-Encoding": "gzip, deflate, br",
        },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel().catch(() => {});
        if (hop === maxRedirects) throw new FetchLimitError("Too many redirects.");
        url = assertSafeUrl(new URL(res.headers.get("location")!, url));
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared && declared > maxBytes * 4) {
        await res.body?.cancel().catch(() => {});
        throw new FetchLimitError(`Response too large (${Math.round(declared / 1024 / 1024)} MB).`);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      if (res.body && opts.method !== "HEAD") {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            truncated = true;
            chunks.push(Buffer.from(value.subarray(0, value.byteLength - (size - maxBytes))));
            await reader.cancel().catch(() => {});
            break;
          }
          chunks.push(Buffer.from(value));
        }
      }
      let body = Buffer.concat(chunks);
      const isGzip = body.length > 2 && body[0] === 0x1f && body[1] === 0x8b;
      if (isGzip && opts.gunzip !== false && !truncated) {
        try {
          body = zlib.gunzipSync(body, { maxOutputLength: maxBytes });
        } catch (err) {
          if (err instanceof RangeError || (err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
            throw new FetchLimitError("Decompressed response exceeds the size limit.");
          }
          throw new Error("Could not decompress gzip response.");
        }
      }
      return { url: url.toString(), status: res.status, ok: res.ok, contentType, body, truncated };
    }
    throw new FetchLimitError("Too many redirects.");
  } catch (err) {
    if (controller.signal.aborted) throw new FetchLimitError(`Timed out after ${Math.round(timeoutMs / 1000)}s.`);
    if (err instanceof UnsafeUrlError || err instanceof FetchLimitError) throw err;
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof UnsafeUrlError) throw cause;
    throw new Error(`Fetch failed: ${err instanceof Error ? (cause instanceof Error ? cause.message : err.message) : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
