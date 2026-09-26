/**
 * RFC 9309 robots.txt parser with rule provenance (which line allowed/blocked a URL).
 * Pure / isomorphic. Used by the site audit crawler (politeness) and the crawlability check
 * (per-AI-bot access matrix).
 *
 * Semantics:
 * - Groups start with one or more `User-agent` lines; rules until the next user-agent line after rules.
 * - A crawler uses every group whose user-agent matches its product token (case-insensitive,
 *   RFC 9309 §2.2.1: groups are merged); otherwise the `*` groups; otherwise everything is allowed.
 * - The most specific (longest) matching path pattern wins; on a tie `Allow` wins.
 * - `*` matches any sequence, `$` anchors the end. Empty `Disallow:` allows everything.
 * - `/robots.txt` itself is always allowed.
 */

export type RobotsRule = { type: "allow" | "disallow"; path: string; line: number };

export type RobotsGroup = {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
  /** Line number of the first user-agent line. */
  line: number;
};

export type ParsedRobots = {
  groups: RobotsGroup[];
  sitemaps: string[];
  /** Lines that could not be interpreted (for validation findings). */
  warnings: { line: number; message: string }[];
  lineCount: number;
};

export type RobotsGroupMatch = {
  source: "specific" | "wildcard" | "none";
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
};

export type RobotsVerdict = {
  allowed: boolean;
  rule: RobotsRule | null;
  source: RobotsGroupMatch["source"];
};

const KNOWN_FIELDS = new Set(["user-agent", "allow", "disallow", "sitemap", "crawl-delay", "host", "clean-param", "request-rate", "visit-time", "noindex", "content-signal"]);

export function parseRobotsTxt(text: string | null | undefined): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  const warnings: ParsedRobots["warnings"] = [];
  if (!text) return { groups, sitemaps, warnings, lineCount: 0 };

  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) return;
    const colon = line.indexOf(":");
    if (colon === -1) {
      warnings.push({ line: lineNo, message: `Unrecognized line: "${rawLine.trim().slice(0, 80)}"` });
      return;
    }
    const field = line.slice(0, colon).trim().toLowerCase().replace(/_/g, "-");
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent" || field === "useragent") {
      if (!current || !lastWasAgent) {
        current = { userAgents: [], rules: [], crawlDelay: null, line: lineNo };
        groups.push(current);
      }
      if (value) current.userAgents.push(value);
      lastWasAgent = true;
      return;
    }
    if (field === "sitemap" || field === "site-map") {
      if (value) sitemaps.push(value);
      return;
    }
    lastWasAgent = false;
    if (field === "allow" || field === "disallow") {
      if (!current) {
        warnings.push({ line: lineNo, message: `"${field}" rule before any User-agent line is ignored.` });
        return;
      }
      current.rules.push({ type: field, path: value, line: lineNo });
      return;
    }
    if (field === "crawl-delay") {
      if (!current) return;
      const n = Number(value.replace(",", "."));
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
      else warnings.push({ line: lineNo, message: `Invalid Crawl-delay "${value}".` });
      return;
    }
    if (!KNOWN_FIELDS.has(field)) warnings.push({ line: lineNo, message: `Unknown directive "${field}".` });
  });

  return { groups, sitemaps, warnings, lineCount: lines.length };
}

/** Product token of a user-agent line value ("Googlebot/2.1" → "googlebot"). */
function productToken(value: string): string {
  return value.trim().split(/[/\s]/)[0]!.toLowerCase();
}

export function matchGroup(robots: ParsedRobots, token: string): RobotsGroupMatch {
  const wanted = token.toLowerCase();
  const specific = robots.groups.filter((g) => g.userAgents.some((ua) => productToken(ua) === wanted));
  const chosen = specific.length ? specific : robots.groups.filter((g) => g.userAgents.some((ua) => ua.trim() === "*"));
  if (!chosen.length) return { source: "none", userAgents: [], rules: [], crawlDelay: null };
  const delays = chosen.map((g) => g.crawlDelay).filter((d): d is number => d !== null);
  return {
    source: specific.length ? "specific" : "wildcard",
    userAgents: [...new Set(chosen.flatMap((g) => g.userAgents))],
    rules: chosen.flatMap((g) => g.rules),
    crawlDelay: delays.length ? Math.max(...delays) : null,
  };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Normalizes for comparison: decode percent-escapes of unreserved chars consistently. */
function normalizePath(p: string): string {
  return safeDecode(p);
}

/** Does `pattern` (robots path with `*` wildcards and `$` end anchor) match `path`? */
export function patternMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const pat = normalizePath(pattern);
  const target = normalizePath(path);
  const anchored = pat.endsWith("$");
  const body = anchored ? pat.slice(0, -1) : pat;
  const parts = body.split("*");
  // Fast path: no wildcard
  if (parts.length === 1) return anchored ? target === body : target.startsWith(body);
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i === 0) {
      if (!target.startsWith(part)) return false;
      pos = part.length;
      continue;
    }
    if (i === parts.length - 1 && anchored) {
      if (part === "") return true;
      return target.length - part.length >= pos && target.endsWith(part);
    }
    const found = target.indexOf(part, pos);
    if (found === -1) return false;
    pos = found + part.length;
  }
  return true;
}

function pathOf(urlOrPath: string): string {
  if (urlOrPath.startsWith("/")) return urlOrPath;
  try {
    const u = new URL(urlOrPath);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return "/";
  }
}

export function evaluateRules(rules: RobotsRule[], urlOrPath: string): { allowed: boolean; rule: RobotsRule | null } {
  const path = pathOf(urlOrPath);
  if (path === "/robots.txt") return { allowed: true, rule: null };
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!rule.path) continue; // empty Disallow/Allow = no restriction
    if (!patternMatches(rule.path, path)) continue;
    if (
      !best ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.type === "allow" && best.type === "disallow")
    ) {
      best = rule;
    }
  }
  return { allowed: !best || best.type === "allow", rule: best };
}

export function isAllowed(robots: ParsedRobots, token: string, urlOrPath: string): RobotsVerdict {
  const group = matchGroup(robots, token);
  const { allowed, rule } = evaluateRules(group.rules, urlOrPath);
  return { allowed, rule, source: group.source };
}

/**
 * Overall access classification for a crawler token:
 * - blocked: the site root is disallowed and nothing is explicitly re-allowed
 * - partial: some paths disallowed (or root blocked with Allow exceptions)
 * - allowed: no effective Disallow rules
 */
export function classifyAccess(robots: ParsedRobots, token: string): {
  status: "allowed" | "partial" | "blocked";
  group: RobotsGroupMatch;
  rootVerdict: { allowed: boolean; rule: RobotsRule | null };
} {
  const group = matchGroup(robots, token);
  const rootVerdict = evaluateRules(group.rules, "/");
  const disallows = group.rules.filter((r) => r.type === "disallow" && r.path);
  const allows = group.rules.filter((r) => r.type === "allow" && r.path && r.path !== "/");
  let status: "allowed" | "partial" | "blocked";
  if (!rootVerdict.allowed) status = allows.length ? "partial" : "blocked";
  else status = disallows.length ? "partial" : "allowed";
  return { status, group, rootVerdict };
}

export function formatRule(rule: RobotsRule | null): string | null {
  if (!rule) return null;
  return `${rule.type === "allow" ? "Allow" : "Disallow"}: ${rule.path}`;
}
