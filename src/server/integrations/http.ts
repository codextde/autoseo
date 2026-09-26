import "server-only";
import dns from "node:dns";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { assertSafeUrl, isBlockedIp, UnsafeUrlError } from "@/server/ai/knowledge/safe-fetch";

/** Error thrown by integration HTTP calls; carries the upstream status for error mapping. */
export class IntegrationHttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string = "",
  ) {
    super(message);
  }
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (!list.length || bad) {
      return callback(
        Object.assign(new UnsafeUrlError(`${hostname} resolves to a private or reserved address.`), { code: "EBLOCKED" }),
        "",
        0,
      );
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}

let safeAgent: Dispatcher | null = null;
function getSafeAgent(): Dispatcher {
  if (!safeAgent) {
    safeAgent = new Agent({
      connect: { lookup: safeLookup as never, timeout: 10_000 },
      headersTimeout: 30_000,
      bodyTimeout: 60_000,
    });
  }
  return safeAgent;
}

export type HttpOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  /** Objects are JSON-encoded; URLSearchParams are form-encoded. */
  body?: unknown;
  timeoutMs?: number;
  /** User-supplied URL (Matomo, Piwik PRO…): SSRF-protected, no redirects to private hosts. */
  untrusted?: boolean;
  /** Max response size in bytes (default 50 MB). */
  maxBytes?: number;
};

/** Performs an HTTP request and returns the raw text body. Throws IntegrationHttpError on non-2xx. */
export async function httpText(url: string, opts: HttpOptions = {}): Promise<{ status: number; text: string; headers: Headers }> {
  const headers: Record<string, string> = { Accept: "application/json", ...(opts.headers ?? {}) };
  let body: string | undefined;
  if (opts.body instanceof URLSearchParams) {
    body = opts.body.toString();
    headers["Content-Type"] ??= "application/x-www-form-urlencoded";
  } else if (typeof opts.body === "string") {
    body = opts.body;
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] ??= "application/json";
  }
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
  let res: Response;
  try {
    if (opts.untrusted) {
      let target = assertSafeUrl(url);
      let hops = 0;
      for (;;) {
        const r = await undiciFetch(target, {
          method: opts.method ?? (body ? "POST" : "GET"),
          headers,
          body,
          redirect: "manual",
          dispatcher: getSafeAgent(),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const loc = r.headers.get("location");
        if (r.status >= 300 && r.status < 400 && loc && hops < 3) {
          await r.body?.cancel().catch(() => {});
          const next = assertSafeUrl(new URL(loc, target));
          // Never forward credentials (POST body / Authorization) to another origin.
          if (next.origin !== target.origin) {
            throw new IntegrationHttpError(`${safeHost(url)} redirected to another host (${next.host}) — use the final URL instead.`, r.status);
          }
          target = next;
          hops++;
          continue;
        }
        res = r as unknown as Response;
        break;
      }
    } else {
      res = await fetch(url, {
        method: opts.method ?? (body ? "POST" : "GET"),
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    }
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new IntegrationHttpError(err.message, 0);
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof UnsafeUrlError) throw new IntegrationHttpError(cause.message, 0);
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))
      throw new IntegrationHttpError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`, 0);
    throw new IntegrationHttpError(
      `Could not reach ${safeHost(url)}: ${cause instanceof Error ? cause.message : err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new IntegrationHttpError("Response too large", res.status);
  }
  // Stream with a byte counter: chunked responses carry no Content-Length.
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new IntegrationHttpError("Response too large", res.status);
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!res.ok) {
    throw new IntegrationHttpError(`${safeHost(url)} responded with HTTP ${res.status}`, res.status, text.slice(0, 2000));
  }
  return { status: res.status, text, headers: res.headers };
}

export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const { text } = await httpText(url, opts);
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new IntegrationHttpError(`${safeHost(url)} returned invalid JSON`, 200, text.slice(0, 500));
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the server";
  }
}
