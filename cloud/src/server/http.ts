import "server-only";
import { headers } from "next/headers";
import { env } from "@/server/env";
import { isCloudflareIp } from "@/server/cloudflare-ips";

export { safeNext } from "@/server/safe-next";

/**
 * Client IP for rate limiting. Traefik sets `X-Real-Ip` to the direct peer. autoseo.codext.de is proxied
 * by Cloudflare, but the origin is reachable directly too, so the edge's `CF-Connecting-IP` is only
 * trusted when that peer really is a Cloudflare edge address; otherwise it could be forged.
 */
export function clientIpFromHeaders(h: Headers): string | null {
  const fwd = h.get("x-forwarded-for");
  const peer = h.get("x-real-ip")?.trim() || (fwd ? fwd.split(",").pop()!.trim() : "") || null;
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf && isCloudflareIp(peer)) return cf;
  return peer;
}

export async function getRequestMeta() {
  const h = await headers();
  return { ip: clientIpFromHeaders(h), userAgent: h.get("user-agent") ?? null };
}

/**
 * CSRF guard for cookie-authenticated route handlers (server actions get this from Next.js).
 */
export function isSameOrigin(req: Request): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const o = new URL(origin);
    if (o.host === new URL(env.appUrl).host) return true;
    const reqHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return !!reqHost && o.host === reqHost;
  } catch {
    return false;
  }
}

export function appUrl(path = "/"): string {
  return `${env.appUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
