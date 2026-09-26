import "server-only";
import { env } from "@/server/env";

/**
 * Trusted client IP. Reverse proxies (Coolify's Traefik, nginx) overwrite `X-Real-Ip` and append
 * the peer address as the right-most `X-Forwarded-For` hop, so those can't be forged by the client.
 * `CF-Connecting-IP` is only honoured when the instance is explicitly behind Cloudflare
 * (Admin → Authentication → Security), because without Cloudflare anyone can send that header.
 */
export function clientIpFromHeaders(headers: Headers, opts: { trustCloudflare?: boolean } = {}): string | null {
  if (opts.trustCloudflare) {
    const cf = headers.get("cf-connecting-ip");
    if (cf) return cf.trim();
  }
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",").pop()!.trim() || null;
  return null;
}

let trustCloudflareCache: { value: boolean; at: number } | null = null;

/** Reads the "behind Cloudflare" security setting (cached for 30 s). */
export async function trustCloudflareHeaders(): Promise<boolean> {
  if (trustCloudflareCache && Date.now() - trustCloudflareCache.at < 30_000) return trustCloudflareCache.value;
  try {
    const { getSetting } = await import("@/server/settings");
    const value = (await getSetting("security")).behindCloudflare;
    trustCloudflareCache = { value, at: Date.now() };
    return value;
  } catch {
    return false;
  }
}

/** Synchronous variant (uses the cached Cloudflare setting, refreshed in the background). */
export function clientIpSync(headers: Headers): string | null {
  void trustCloudflareHeaders();
  return clientIpFromHeaders(headers, { trustCloudflare: trustCloudflareCache?.value ?? false });
}

export async function clientIp(headers: Headers): Promise<string | null> {
  return clientIpFromHeaders(headers, { trustCloudflare: await trustCloudflareHeaders() });
}

/**
 * CSRF guard for cookie-authenticated route handlers: the request must come from our own origin.
 * (Server actions get this check from Next.js automatically; route handlers do not.)
 */
export function isSameOrigin(req: Request): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin") return true;
  const origin = req.headers.get("origin");
  if (!origin) return fetchSite === null && req.method === "GET";
  try {
    const o = new URL(origin);
    const app = new URL(env.appUrl);
    if (o.host === app.host) return true;
    const reqHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return !!reqHost && o.host === reqHost;
  } catch {
    return false;
  }
}

/** Returns a 403 response when the request is cross-site, otherwise null. */
export function rejectCrossSite(req: Request): Response | null {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return null;
  return isSameOrigin(req) ? null : Response.json({ error: "Cross-site request blocked" }, { status: 403 });
}

/** Exact media type check (e.g. rejects "text/plain; x=application/json"). */
export function hasContentType(req: Request, type: string): boolean {
  const ct = req.headers.get("content-type") ?? "";
  return ct.split(";")[0]!.trim().toLowerCase() === type;
}
