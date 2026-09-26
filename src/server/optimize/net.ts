import "server-only";
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

/**
 * SSRF-safe outbound HTTP for user-supplied URLs (page fetches, webhooks, CMS/PM endpoints on
 * custom domains). Blocks loopback/private/link-local/reserved targets — validated at connect
 * time (no DNS-rebinding window) and again for every redirect hop.
 */

export class UnsafeUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
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

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(lower)) return true;
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (lower.startsWith("64:ff9b:")) return true; // NAT64
    if (lower.startsWith("2001:db8:") || lower.startsWith("2001:0db8:")) return true; // docs
    if (lower.startsWith("100::") || lower.startsWith("0100:")) return true; // discard
    return false;
  }
  return true;
}

/** Ports reachable without an explicit admin allowlist entry ("" = scheme default). */
export const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

/** Validates scheme/host/port of a user-supplied URL (does not resolve DNS). */
export function parsePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("Invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Only http(s) URLs are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
    throw new UnsafeUrlError("Local addresses are not allowed.");
  if (net.isIP(host) && isPrivateIp(host)) throw new UnsafeUrlError("Private network addresses are not allowed.");
  if (!ALLOWED_PORTS.has(url.port)) throw new UnsafeUrlError(`Port ${url.port} is not allowed (use 80, 443, 8080 or 8443).`);
  return url;
}

/** Headers that may be forwarded when a redirect leaves the original origin (everything else — auth, cookies, API keys — is dropped). */
const CROSS_ORIGIN_SAFE_HEADERS = new Set(["user-agent", "accept", "accept-language"]);

export function headersForHop(headers: Record<string, string>, sameOrigin: boolean): Record<string, string> {
  if (sameOrigin) return headers;
  return Object.fromEntries(Object.entries(headers).filter(([k]) => CROSS_ORIGIN_SAFE_HEADERS.has(k.toLowerCase())));
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isPrivateIp(a.address));
    if (!list.length || bad) {
      const e = new UnsafeUrlError(`Blocked request to a private address (${hostname}).`) as unknown as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return callback(e, "", 0);
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}

let agent: Agent | null = null;
function getAgent() {
  agent ??= new Agent({
    connect: { lookup: safeLookup as unknown as typeof dns.lookup, timeout: 10_000 },
    headersTimeout: 30_000,
    bodyTimeout: 60_000,
  });
  return agent;
}

export type SafeResponse = {
  ok: boolean;
  status: number;
  url: string;
  headers: Headers;
  body: Buffer;
  text: () => string;
  json: <T = unknown>() => T;
};

export type SafeFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | null;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /**
   * "content" (default): fetches whose response is shown to users (page optimization, reference
   * documents, crawl checks) — always public-internet only.
   * "integration": calls to a connected integration's API — hosts in the admin allowlist
   * (Admin → Authentication → internal hosts) may resolve to private addresses / any port.
   */
  purpose?: "content" | "integration";
};

export const DEFAULT_UA = "Mozilla/5.0 (compatible; AutoSEO/1.0; +https://github.com/autoseo)";

let lanAgent: Agent | null = null;

/** Hosts an admin explicitly allowed to resolve to private addresses (Admin → Authentication). */
async function privateAllowlist(): Promise<string[]> {
  try {
    const { getSetting } = await import("@/server/settings");
    return (await getSetting("security")).privateNetworkAllowlist.map((h) => h.toLowerCase());
  } catch {
    return [];
  }
}

/** Fetch a user-supplied URL with SSRF protection, size and time limits. */
export async function safeFetch(rawUrl: string, init: SafeFetchInit = {}): Promise<SafeResponse> {
  const maxBytes = init.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = init.maxRedirects ?? 5;
  const allow = init.purpose === "integration" ? await privateAllowlist() : [];
  const isAllowed = (u: URL) => allow.includes(u.hostname.toLowerCase());
  const parse = (u: string): URL => {
    let url: URL;
    try {
      url = new URL(u);
    } catch {
      throw new UnsafeUrlError("Invalid URL.");
    }
    if (!isAllowed(url)) return parsePublicUrl(u);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Only http(s) URLs are allowed.");
    if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed.");
    return url;
  };
  let url = parse(rawUrl);
  const origin = url.origin;
  let method = init.method ?? "GET";
  let body = init.body ?? undefined;
  let reqHeaders: Record<string, string> = { "user-agent": DEFAULT_UA, ...(init.headers ?? {}) };
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await undiciFetch(url.toString(), {
      method,
      headers: reqHeaders,
      body: body as UndiciRequestInit["body"],
      redirect: "manual",
      dispatcher: isAllowed(url) ? (lanAgent ??= new Agent({ headersTimeout: 30_000, bodyTimeout: 60_000 })) : getAgent(),
      signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
    }).catch((err: unknown) => {
      const cause = (err as { cause?: unknown })?.cause;
      if (cause instanceof UnsafeUrlError) throw cause;
      throw err;
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= maxRedirects) {
        await res.body?.cancel().catch(() => {});
        throw new Error(maxRedirects === 0 ? `The URL redirects (HTTP ${res.status}) — use the final URL.` : "Too many redirects.");
      }
      const next = parse(new URL(res.headers.get("location")!, url).toString());
      await res.body?.cancel().catch(() => {});
      const sameOrigin = next.origin === origin;
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      } else if (body != null && !sameOrigin) {
        // 307/308 would re-send the body — never forward a request body to another origin.
        throw new UnsafeUrlError(`Refusing to re-send the request body to another origin (${next.host}).`);
      }
      // Credentials (Authorization, Cookie, API-key headers) never follow a redirect to another origin.
      reqHeaders = headersForHop(reqHeaders, sameOrigin);
      if (!body) reqHeaders = Object.fromEntries(Object.entries(reqHeaders).filter(([k]) => k.toLowerCase() !== "content-type"));
      url = next;
      continue;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    if (res.body) {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > maxBytes) {
          await res.body.cancel().catch(() => {});
          throw new Error(`Response larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
        }
        chunks.push(Buffer.from(chunk));
      }
    }
    const buf = Buffer.concat(chunks);
    const headers = new Headers();
    res.headers.forEach((v, k) => headers.set(k, v));
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      url: url.toString(),
      headers,
      body: buf,
      text: () => buf.toString("utf8"),
      json: <T,>() => JSON.parse(buf.toString("utf8")) as T,
    };
  }
  throw new Error("Too many redirects.");
}

/** JSON request helper for connected integrations' APIs (errors include the provider's message). */
export async function fetchJson<T = unknown>(
  url: string,
  init: SafeFetchInit & { json?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...(init.headers ?? {}) };
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await safeFetch(url, { purpose: "integration", ...init, headers, body });
  const text = res.text();
  if (!res.ok) {
    let message = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const m =
        (parsed.message as string) ??
        (typeof parsed.err === "string" ? parsed.err : null) ??
        (parsed.error as { message?: string })?.message ??
        (typeof parsed.error === "string" ? parsed.error : null) ??
        (parsed.errors as Array<{ message?: string }>)?.[0]?.message ??
        (parsed.errorMessages as string[])?.[0];
      if (m) message = m;
    } catch {
      // keep raw text
    }
    throw new HttpError(res.status, `HTTP ${res.status}: ${message || "request failed"}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
