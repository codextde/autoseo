/**
 * URL normalization and scope helpers for the site audit crawler (port of open-seo `url-utils.ts`).
 * Pure / isomorphic.
 */

/**
 * Normalize a URL for deduplication:
 * - resolve relative URLs against a base
 * - only http(s) (anything else → null)
 * - strip fragments, sort query params, lowercase hostname
 * - trailing slashes are preserved (`/docs` and `/docs/` stay distinct) so CMS slash-redirects
 *   resolve normally instead of looping.
 */
export function normalizeUrl(url: string, base?: string): string | null {
  try {
    const parsed = new URL(url, base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.hash = "";
    parsed.searchParams.sort();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Canonical key for "is this effectively the same page" comparisons (homepage detection for the
 * Lighthouse sample): forces https, drops a leading `www.`, lowercases the host, sorts params and
 * strips the fragment. Trailing slashes stay intact.
 */
export function canonicalUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.protocol = "https:";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.hash = "";
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return url.toLowerCase();
  }
}

function getEffectivePort(parsed: URL): string {
  if (parsed.port) return parsed.port;
  return parsed.protocol === "https:" ? "443" : "80";
}

function areEquivalentHostnames(a: string, b: string): boolean {
  const hostA = a.toLowerCase();
  const hostB = b.toLowerCase();
  if (hostA === hostB) return true;
  return hostA === `www.${hostB}` || hostB === `www.${hostA}`;
}

/**
 * Same crawl boundary as the target: hostnames equal or differing only by a leading `www.`;
 * same protocol needs the same effective port; cross-protocol only for http:80 → https:443.
 */
export function isSameOrigin(url: string, origin: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const parsedOrigin = new URL(origin);
    if (!areEquivalentHostnames(parsedUrl.hostname, parsedOrigin.hostname)) return false;
    const originProtocol = parsedOrigin.protocol.toLowerCase();
    const urlProtocol = parsedUrl.protocol.toLowerCase();
    const originPort = getEffectivePort(parsedOrigin);
    const urlPort = getEffectivePort(parsedUrl);
    if (originProtocol === urlProtocol) return originPort === urlPort;
    return originProtocol === "http:" && urlProtocol === "https:" && originPort === "80" && urlPort === "443";
  } catch {
    return false;
  }
}

/**
 * Detect a URL template by replacing dynamic-looking path segments:
 * `/blog/my-great-post` → `/blog/:slug`, `/products/12345` → `/products/:id`.
 */
export function detectUrlTemplate(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const normalized = segments.map((segment) => {
    if (/^\d+$/.test(segment)) return ":id";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ":uuid";
    if (/^\d{4}-\d{2}-\d{2}$/.test(segment)) return ":date";
    if (segment.includes("-") && segment.split("-").length > 2) return ":slug";
    return segment;
  });
  return "/" + normalized.join("/");
}

export function getOrigin(url: string): string {
  return new URL(url).origin;
}

/** Display helper: path (+query) when on the given host, else host+path. */
export function displayUrl(url: string, predominantHost?: string | null): string {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    if (predominantHost && u.hostname === predominantHost) return path || "/";
    return `${u.hostname}${path}`;
  } catch {
    return url;
  }
}
