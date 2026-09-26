/**
 * SSRF-safe HTTP client for crawler / crawlability fetches.
 *
 * - Every connection goes through a custom DNS `lookup` that resolves the hostname and rejects
 *   the connection when ANY resolved address is private / loopback / link-local / metadata /
 *   multicast / reserved. Because the check happens inside the connector, the address we validate
 *   is exactly the address we connect to (no DNS-rebinding window), and it applies to every
 *   redirect hop (redirects are followed manually, one validated request per hop).
 * - IP-literal hosts skip DNS, so they are validated up front with the synchronous policy.
 * - Bodies are read with a byte cap.
 */
import dns from "node:dns";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";
import { CrawlTargetBlockedError, isCrawlableUrl, isPrivateAddress } from "./url-policy";

type LookupAddress = { address: string; family: number };
type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void;

function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { all: true, family: options.family ?? 0, hints: options.hints }, (err, addresses) => {
    if (err) return callback(err);
    const list = (addresses as LookupAddress[]) ?? [];
    if (!list.length) return callback(Object.assign(new Error(`No addresses for ${hostname}`), { code: "ENOTFOUND" }));
    const blocked = list.find((a) => isPrivateAddress(a.address));
    if (blocked) {
      const e = new CrawlTargetBlockedError(`Blocked: ${hostname} resolves to a private or internal address.`) as unknown as NodeJS.ErrnoException;
      e.code = "CRAWL_TARGET_BLOCKED";
      return callback(e);
    }
    if (options.all) return callback(null, list);
    const first = list[0]!;
    return callback(null, first.address, first.family);
  });
}

declare global {
  var __autoseoSafeAgent: Agent | undefined;
}

function agent(): Agent {
  if (!globalThis.__autoseoSafeAgent) {
    globalThis.__autoseoSafeAgent = new Agent({
      connect: { lookup: safeLookup as never, timeout: 10_000 },
      connections: 64,
      keepAliveTimeout: 10_000,
      headersTimeout: 30_000,
      bodyTimeout: 30_000,
    });
  }
  return globalThis.__autoseoSafeAgent;
}

export type SafeFetchInit = {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type SafeResponse = UndiciResponse;

/** A single request (no redirect following). Throws CrawlTargetBlockedError for blocked targets. */
export async function safeFetch(url: string, init: SafeFetchInit = {}): Promise<SafeResponse> {
  if (!isCrawlableUrl(url)) throw new CrawlTargetBlockedError();
  const timeout = AbortSignal.timeout(init.timeoutMs ?? 15_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await undiciFetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      redirect: "manual",
      signal,
      dispatcher: agent(),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } })?.cause;
    if (cause?.code === "CRAWL_TARGET_BLOCKED") throw new CrawlTargetBlockedError();
    throw err;
  }
}

export type RedirectHop = { url: string; status: number; location: string | null; timeMs: number };

/**
 * Follows redirects manually (≤ maxHops), validating each hop with the same SSRF policy.
 * Returns the final response (body unread) plus the hop list.
 */
export async function safeFetchFollow(
  url: string,
  init: SafeFetchInit & { maxHops?: number } = {},
): Promise<{ response: SafeResponse; finalUrl: string; hops: RedirectHop[]; ttfbMs: number }> {
  const maxHops = init.maxHops ?? 5;
  const hops: RedirectHop[] = [];
  let current = url;
  for (let i = 0; ; i++) {
    const started = performance.now();
    const response = await safeFetch(current, init);
    const timeMs = Math.round(performance.now() - started);
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location && i < maxHops) {
      hops.push({ url: current, status: response.status, location, timeMs });
      await response.body?.cancel().catch(() => {});
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        return { response, finalUrl: current, hops, ttfbMs: timeMs };
      }
      if (!isCrawlableUrl(next)) throw new CrawlTargetBlockedError("A redirect pointed to a private or internal address.");
      current = next;
      continue;
    }
    return { response, finalUrl: current, hops, ttfbMs: timeMs };
  }
}

/** Reads up to maxBytes of a body as text; `truncated` when the cap was hit. */
export async function readTextCapped(
  response: SafeResponse | Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const body = response.body as ReadableStream<Uint8Array> | null;
  if (!body) return { text: "", bytes: 0, truncated: false };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytes;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      bytes += chunk.byteLength;
      parts.push(decoder.decode(chunk, { stream: true }));
      if (bytes >= maxBytes) {
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
  parts.push(decoder.decode());
  return { text: parts.join(""), bytes, truncated };
}

/**
 * Validates a user-supplied start URL end-to-end: sync policy, then follows up to 5 redirects
 * (each hop validated + DNS-checked on connect) so the audit anchors to the real origin
 * (apex → www, .net → .com). Probe failures fall back to the last validated URL.
 */
export async function resolveStartUrl(startUrl: string, userAgent: string): Promise<string> {
  let current = startUrl;
  for (let hop = 0; hop < 5; hop++) {
    let response: SafeResponse;
    try {
      response = await safeFetch(current, { headers: { "User-Agent": userAgent, Accept: "text/html,*/*" }, timeoutMs: 10_000 });
    } catch (err) {
      if (err instanceof CrawlTargetBlockedError) throw err;
      return current;
    }
    await response.body?.cancel().catch(() => {});
    if (response.status < 300 || response.status >= 400) return current;
    const location = response.headers.get("location");
    if (!location) return current;
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return current;
    }
    next.hash = "";
    if (!isCrawlableUrl(next.toString())) throw new CrawlTargetBlockedError("The start URL redirects to a private or internal address.");
    current = next.toString();
  }
  return current;
}
