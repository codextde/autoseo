/**
 * Research scope (exact_url | subfolder | domain | subdomains) shared by Domain Overview and Backlinks.
 * Port of open-seo `shared/researchScope.ts`. Pure + isomorphic.
 */
import { parse as parseTld } from "tldts";

export const RESEARCH_SCOPES = ["exact_url", "subfolder", "domain", "subdomains"] as const;
export type ResearchScope = (typeof RESEARCH_SCOPES)[number];

export const RESEARCH_SCOPE_LABELS: Record<ResearchScope, string> = {
  exact_url: "Exact URL",
  subfolder: "Subfolder",
  domain: "Domain",
  subdomains: "Subdomains",
};

export const RESEARCH_SCOPE_DESCRIPTIONS: Record<ResearchScope, string> = {
  exact_url: "One page only",
  subfolder: "The path and everything under it",
  domain: "The hostname, without subdomains",
  subdomains: "The domain plus all its subdomains",
};

export const RESEARCH_SCOPE_EXAMPLES: Record<ResearchScope, string> = {
  exact_url: "example.com/path",
  subfolder: "example.com/path/*",
  domain: "example.com/*",
  subdomains: "*.example.com/*",
};

export function isResearchScope(value: unknown): value is ResearchScope {
  return typeof value === "string" && (RESEARCH_SCOPES as readonly string[]).includes(value);
}

export type ResearchTarget = {
  scope: ResearchScope;
  /** Lowercased hostname with a leading `www.` stripped. */
  hostname: string;
  /** Hostname as entered (lowercased, `www.` preserved). */
  urlHostname: string;
  /** `""` for the root, otherwise `/like/This` (case preserved, trailing slashes/query/fragment stripped). */
  path: string;
  /** hostname, plus the path for URL-scoped research. */
  display: string;
};

export type ParseResearchTargetResult = { ok: true; target: ResearchTarget } | { ok: false; message: string };

/** Real registrable domain via the public-suffix list (rejects IPs and fake TLDs). */
export function isValidDomainHost(host: string): boolean {
  const parsed = parseTld(host, { allowPrivateDomains: true });
  return !parsed.isIp && !!parsed.publicSuffix && (parsed.isIcann === true || parsed.isPrivate === true);
}

function normalizePath(pathname: string): string {
  if (pathname === "/") return "";
  return pathname.replace(/\/+$/, "");
}

export function isScopeAllowedForInput(scope: ResearchScope, path: string): boolean {
  return scope !== "subfolder" || path !== "";
}

export function defaultScopeForPath(path: string): ResearchScope {
  return path === "" ? "subdomains" : "subfolder";
}

export function defaultScopeForInput(input: string): ResearchScope {
  const parsed = parseResearchTarget(input);
  return parsed.ok ? parsed.target.scope : "domain";
}

/** Scope as persisted in URLs/history: omitted when equal to the input's implied default. */
export function toScopeSearchParam(input: string, scope: ResearchScope): ResearchScope | undefined {
  return scope === defaultScopeForInput(input) ? undefined : scope;
}

export function parseResearchTarget(input: string, requestedScope?: ResearchScope): ParseResearchTargetResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, message: "Enter a domain or URL" };

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { ok: false, message: "Enter a valid domain like example.com" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, message: "URLs with embedded credentials are not supported" };
  }

  const urlHostname = parsed.hostname.toLowerCase();
  const hostname = urlHostname.replace(/^www\./, "");
  if (!hostname || !hostname.includes(".") || !/^[a-z\d.-]+$/.test(hostname) || !isValidDomainHost(hostname)) {
    return { ok: false, message: "Enter a valid domain like example.com" };
  }

  const path = normalizePath(parsed.pathname);
  if (requestedScope === "subfolder" && path === "") {
    return { ok: false, message: "Add a path to use Subfolder (e.g. example.com/blog)" };
  }

  const scope = requestedScope ?? defaultScopeForPath(path);
  const usesPath = scope === "exact_url" || scope === "subfolder";
  return {
    ok: true,
    target: { scope, hostname, urlHostname, path, display: usesPath ? `${hostname}${path}` : hostname },
  };
}

/** How many of DataForSEO's 8 filter conditions each scope consumes on the Labs endpoints. */
export const RESEARCH_SCOPE_FILTER_SLOTS: Record<"keywords" | "pages", Record<ResearchScope, number>> = {
  keywords: { exact_url: 4, subfolder: 4, domain: 1, subdomains: 0 },
  pages: { exact_url: 4, subfolder: 4, domain: 2, subdomains: 0 },
};

/** Conditions the backlinks subfolder url_to/url prefix group consumes. */
export const BACKLINKS_SUBFOLDER_FILTER_CONDITIONS = 4;

export const MAX_DATAFORSEO_FILTER_CONDITIONS = 8;

function hostMatches(candidateHost: string, target: ResearchTarget): boolean {
  const host = candidateHost.toLowerCase().replace(/^www\./, "");
  if (target.scope === "subdomains") return host === target.hostname || host.endsWith(`.${target.hostname}`);
  return host === target.hostname;
}

/** Post-filter for providers without scoping (subfolder `/blog` matches `/blog/x`, not `/blogging`). */
export function urlMatchesResearchTarget(url: string, target: ResearchTarget): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!hostMatches(parsed.hostname, target)) return false;
  const path = normalizePath(parsed.pathname);
  switch (target.scope) {
    case "exact_url":
      return path === target.path;
    case "subfolder":
      return path === target.path || path.startsWith(`${target.path}/`);
    default:
      return true;
  }
}

/** "https://example.com/a/b?x" → "/a/b?x" */
export function toRelativePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
}
