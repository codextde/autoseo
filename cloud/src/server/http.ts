import "server-only";
import { headers } from "next/headers";
import { env } from "@/server/env";

export { safeNext } from "@/server/safe-next";

/**
 * Client IP for rate limiting. autoseo.codext.de sits behind Cloudflare, so the edge's
 * `CF-Connecting-IP` is preferred; otherwise Traefik's `X-Real-Ip` / right-most `X-Forwarded-For`.
 * (A forged header only weakens the per-IP limit; the per-email limit still applies.)
 */
export function clientIpFromHeaders(h: Headers): string | null {
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",").pop()!.trim() || null;
  return null;
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
