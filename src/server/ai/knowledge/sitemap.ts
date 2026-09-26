import "server-only";
import { Parser } from "htmlparser2";
import { AI_BOTS } from "@/lib/engines";
import { safeFetch } from "./safe-fetch";
import type { PageType, SitemapData, SitemapNode } from "@/features/ai-research/types";

/* ───────────────────────────── robots.txt ───────────────────────────── */

type RobotsGroup = { agents: string[]; allow: string[]; disallow: string[] };

export function parseRobots(text: string): { groups: RobotsGroup[]; sitemaps: string[] } {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "disallow") current.disallow.push(value);
    else if (key === "allow") current.allow.push(value);
  }
  return { groups, sitemaps: [...new Set(sitemaps)] };
}

function botStatus(groups: RobotsGroup[], token: string): "allowed" | "blocked" | "partial" {
  const t = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && (t.includes(a) || a.includes(t))));
  const rules = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const disallow = rules.flatMap((g) => g.disallow).filter(Boolean);
  const allow = rules.flatMap((g) => g.allow).filter(Boolean);
  if (disallow.includes("/") && !allow.some((a) => a === "/" || a === "/*")) return "blocked";
  // Generic "*" rules that only hide carts/admin areas are normal; flag only bot-specific partial blocks.
  if (specific.length && disallow.length) return "partial";
  return "allowed";
}

/* ───────────────────────────── URL classification ───────────────────────────── */

const RULES: [PageType, RegExp][] = [
  ["legal", /(^|\/)(impressum|imprint|privacy|datenschutz\w*|agb|terms\w*|legal|cookie\w*|widerruf\w*|disclaimer|policies|policy|nutzungsbedingungen|versand\w*|shipping\w*|returns?|rueckgabe)(\/|$|\.|-)/i],
  ["account", /(^|\/)(cart|checkout|checkouts|account|login|register|warenkorb|kasse|konto|mein-konto|wishlist|merkzettel|orders)(\/|$)/i],
  ["contact", /(^|\/)(contact\w*|kontakt\w*|haendler\w*|dealer\w*|store-?locator|filial\w*|standorte?)(\/|$|\.)/i],
  ["help", /(^|\/)(help|hilfe\w*|faqs?|support|docs?|documentation|kb|knowledge-?base|wissensdatenbank|kundenservice|service-center|anleitung\w*|manuals?|downloads?)(\/|$|\.)/i],
  ["blog", /(^|\/)(blogs?|news|magazin|magazine|ratgeber|articles?|artikel|stories|journal|insights|press|presse|wissen|guides?|lexikon|glossar\w*|academy|posts?)(\/|$)/i],
  ["product", /(^|\/)(products?|produkte?|p|dp|item|artikel-\d+|shop\/[^/]+\/[^/]+)(\/|$)/i],
  ["category", /(^|\/)(collections?|categor(y|ies)|kategorien?|c|catalog|katalog|sortiment|kollektion\w*|range|shop)(\/|$)/i],
  ["company", /(^|\/)(about\w*|ueber-uns|uber-uns|unternehmen|company|team|karriere|careers?|jobs|mission|partner\w*|investor\w*|nachhaltigkeit|sustainability)(\/|$|\.)/i],
  ["landing", /(^|\/)(pages?|lp|landing|lösungen|loesungen|solutions?|angebote?)(\/|$)/i],
];

const LANG_SEG = /^[a-z]{2}(-[a-z]{2})?$/i;

export function classifyUrl(path: string, hint?: PageType | null): PageType {
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  const segs = clean.split("/").filter(Boolean);
  if (segs.length === 0 || (segs.length === 1 && LANG_SEG.test(segs[0]!))) return "home";
  for (const [type, re] of RULES) if (re.test(clean)) return type;
  if (hint) return hint;
  // Deep, slug-like single pages at the root are usually landing pages; nested slugs often products.
  return "other";
}

function hintFromSitemapUrl(url: string): PageType | null {
  const u = url.toLowerCase();
  if (/product/.test(u)) return "product";
  if (/collection|categor|kategor/.test(u)) return "category";
  if (/blog|post|article|news|magazin/.test(u)) return "blog";
  if (/page/.test(u)) return "landing";
  return null;
}

/* ───────────────────────────── Sitemap parsing ───────────────────────────── */

type ParsedSitemap = { kind: "index" | "urlset" | "text"; locs: { loc: string; lastmod: string | null }[] };

export function parseSitemapXml(xml: string): ParsedSitemap {
  const trimmed = xml.trimStart();
  if (!trimmed.startsWith("<")) {
    // Plain text sitemap (one URL per line)
    const locs = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//i.test(l))
      .map((loc) => ({ loc, lastmod: null }));
    return { kind: "text", locs };
  }
  let kind: "index" | "urlset" = "urlset";
  const locs: { loc: string; lastmod: string | null }[] = [];
  let tag = "";
  let loc = "";
  let lastmod: string | null = null;
  let inEntry = false;
  // Depth inside <url>/<sitemap>: only direct children count (skips <image:loc>, <video:loc>…).
  let depth = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        const n = name.toLowerCase().replace(/^.*:/, "");
        if (n === "sitemapindex") kind = "index";
        if (!inEntry && (n === "url" || n === "sitemap")) {
          inEntry = true;
          depth = 0;
          loc = "";
          lastmod = null;
          tag = "";
          return;
        }
        if (inEntry) depth++;
        tag = inEntry && depth === 1 ? n : "";
      },
      ontext(text) {
        if (!inEntry || depth !== 1) return;
        if (tag === "loc") loc += text;
        else if (tag === "lastmod") lastmod = (lastmod ?? "") + text;
      },
      onclosetag(name) {
        const n = name.toLowerCase().replace(/^.*:/, "");
        if (inEntry && depth === 0 && (n === "url" || n === "sitemap")) {
          const l = loc.trim();
          if (l) locs.push({ loc: l, lastmod: lastmod?.trim() || null });
          inEntry = false;
          return;
        }
        if (inEntry) depth = Math.max(0, depth - 1);
        tag = "";
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(xml);
  parser.end();
  return { kind, locs };
}

/* ───────────────────────────── Tree building ───────────────────────────── */

type BuildNode = {
  path: string;
  name: string;
  count: number;
  types: Map<PageType, number>;
  samples: string[];
  children: Map<string, BuildNode>;
};

function newNode(path: string, name: string): BuildNode {
  return { path, name, count: 0, types: new Map(), samples: [], children: new Map() };
}

const MAX_DEPTH = 3;
const MAX_CHILDREN = 40;

function finalize(node: BuildNode): SitemapNode {
  const kids = [...node.children.values()].sort((a, b) => b.count - a.count);
  const shown = kids.slice(0, MAX_CHILDREN);
  let bestType: PageType = "other";
  let best = -1;
  for (const [t, c] of node.types) {
    if (c > best || (c === best && t !== "other")) {
      best = c;
      bestType = t;
    }
  }
  return {
    path: node.path,
    name: node.name,
    count: node.count,
    type: bestType,
    samples: node.samples,
    children: shown.map(finalize),
    more: kids.length > MAX_CHILDREN ? kids.length - MAX_CHILDREN : undefined,
  };
}

function prettySegment(seg: string) {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/* ───────────────────────────── Analysis ───────────────────────────── */

export type SitemapProgress = (p: { step: string; done?: number; total?: number; message?: string }) => Promise<void>;

export async function analyzeSitemap(opts: {
  domain: string;
  previousImportant?: string[];
  maxUrls?: number;
  maxSitemaps?: number;
  onProgress?: SitemapProgress;
  isCancelled?: () => Promise<boolean>;
}): Promise<SitemapData> {
  const maxUrls = opts.maxUrls ?? 25_000;
  const maxSitemaps = opts.maxSitemaps ?? 60;
  const progress = opts.onProgress ?? (async () => {});
  const baseDomain = opts.domain.replace(/^www\./, "");

  await progress({ step: "robots", message: "Reading robots.txt" });
  let origin = `https://${opts.domain}`;
  let robotsText = "";
  let robotsFound = false;
  let robotsUrl = `${origin}/robots.txt`;
  try {
    const r = await safeFetch(robotsUrl, { maxBytes: 512 * 1024, timeoutMs: 15_000, accept: "text/plain,*/*" });
    const finalUrl = new URL(r.url);
    origin = finalUrl.origin;
    robotsUrl = r.url;
    if (r.ok && !/html/i.test(r.contentType)) {
      robotsText = r.body.toString("utf8");
      robotsFound = true;
    }
  } catch (err) {
    // http fallback (some sites have no TLS)
    try {
      const r = await safeFetch(`http://${opts.domain}/robots.txt`, { maxBytes: 512 * 1024, timeoutMs: 15_000 });
      origin = new URL(r.url).origin;
      robotsUrl = r.url;
      if (r.ok && !/html/i.test(r.contentType)) {
        robotsText = r.body.toString("utf8");
        robotsFound = true;
      }
    } catch {
      throw new Error(`Could not reach ${opts.domain}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const robots = parseRobots(robotsText);
  const seen = new Set<string>();
  const aiBots = AI_BOTS.filter((b) => b.purpose !== "seo")
    .filter((b) => (seen.has(b.token) ? false : (seen.add(b.token), true)))
    .map((b) => ({ bot: b.name, company: b.company, status: botStatus(robots.groups, b.token) }));

  // Sitemap discovery
  const queue: { url: string; hint: PageType | null; depth: number }[] = [];
  const candidates = robots.sitemaps.length
    ? robots.sitemaps
    : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-index.xml`, `${origin}/wp-sitemap.xml`];
  for (const url of candidates) queue.push({ url, hint: hintFromSitemapUrl(url), depth: 0 });

  const sitemaps: SitemapData["sitemaps"] = [];
  const visited = new Set<string>();
  const urls = new Map<string, { lastmod: string | null; hint: PageType | null }>();
  let truncated = false;
  let fetched = 0;

  const sameSite = (u: string) => {
    try {
      const h = new URL(u).hostname.replace(/^www\./, "");
      return h === baseDomain || h.endsWith(`.${baseDomain}`);
    } catch {
      return false;
    }
  };

  while (queue.length && fetched < maxSitemaps && urls.size < maxUrls) {
    if (opts.isCancelled && (await opts.isCancelled())) throw new Error("Cancelled");
    const item = queue.shift()!;
    if (visited.has(item.url)) continue;
    visited.add(item.url);
    fetched++;
    await progress({ step: "sitemaps", done: fetched, total: fetched + queue.length, message: `Reading ${item.url}` });
    try {
      const r = await safeFetch(item.url, { maxBytes: 25 * 1024 * 1024, timeoutMs: 45_000, accept: "application/xml,text/xml,*/*" });
      if (!r.ok) {
        // Discovery fallbacks that 404 are not errors worth showing.
        if (robots.sitemaps.length || item.depth > 0) sitemaps.push({ url: item.url, kind: "urlset", urls: 0, error: `HTTP ${r.status}` });
        continue;
      }
      const text = r.body.toString("utf8");
      if (/^\s*<!doctype html|^\s*<html/i.test(text)) {
        if (robots.sitemaps.length || item.depth > 0) sitemaps.push({ url: item.url, kind: "urlset", urls: 0, error: "Not a sitemap (HTML page)" });
        continue;
      }
      const parsed = parseSitemapXml(text);
      sitemaps.push({ url: item.url, kind: parsed.kind, urls: parsed.locs.length, error: r.truncated ? "Truncated (file too large)" : undefined });
      if (parsed.kind === "index") {
        if (item.depth < 3) {
          for (const l of parsed.locs) {
            if (!visited.has(l.loc) && sameSite(l.loc)) queue.push({ url: l.loc, hint: hintFromSitemapUrl(l.loc), depth: item.depth + 1 });
          }
        }
      } else {
        for (const l of parsed.locs) {
          if (urls.size >= maxUrls) {
            truncated = true;
            break;
          }
          if (!sameSite(l.loc)) continue;
          if (!urls.has(l.loc)) urls.set(l.loc, { lastmod: l.lastmod, hint: item.hint });
        }
      }
      // A sitemap was found via fallback — stop probing the remaining fallbacks.
      if (!robots.sitemaps.length && item.depth === 0 && parsed.locs.length) {
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.depth === 0) queue.splice(i, 1);
      }
    } catch (err) {
      sitemaps.push({ url: item.url, kind: "urlset", urls: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (queue.length && urls.size < maxUrls) truncated = truncated || fetched >= maxSitemaps;

  await progress({ step: "tree", message: `Building page tree for ${urls.size.toLocaleString("en-US")} URLs` });

  const root = newNode("/", new URL(origin).hostname);
  const pageTypes: Partial<Record<PageType, number>> = {};
  const langs = new Map<string, number>();
  let newest: string | null = null;
  let oldest: string | null = null;
  let updatedLast30d = 0;
  let withDate = 0;
  const now = Date.now();

  for (const [u, meta] of urls) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      continue;
    }
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const type = classifyUrl(path, meta.hint);
    pageTypes[type] = (pageTypes[type] ?? 0) + 1;
    const segs = path.split("/").filter(Boolean);
    if (segs[0] && LANG_SEG.test(segs[0])) langs.set(segs[0].toLowerCase(), (langs.get(segs[0].toLowerCase()) ?? 0) + 1);
    if (meta.lastmod) {
      const t = Date.parse(meta.lastmod);
      if (!Number.isNaN(t)) {
        withDate++;
        const iso = new Date(t).toISOString();
        if (!newest || iso > newest) newest = iso;
        if (!oldest || iso < oldest) oldest = iso;
        if (now - t < 30 * 86400000) updatedLast30d++;
      }
    }
    // Walk the tree
    let node = root;
    node.count++;
    node.types.set(type, (node.types.get(type) ?? 0) + 1);
    if (node.samples.length < 5 && segs.length === 0) node.samples.push(u);
    let prefix = "";
    for (let i = 0; i < Math.min(segs.length, MAX_DEPTH); i++) {
      prefix += `/${segs[i]}`;
      let child = node.children.get(segs[i]!);
      if (!child) {
        child = newNode(prefix, prettySegment(segs[i]!));
        node.children.set(segs[i]!, child);
      }
      child.count++;
      child.types.set(type, (child.types.get(type) ?? 0) + 1);
      if (child.samples.length < 5) child.samples.push(u);
      node = child;
    }
  }

  const tree = finalize(root);
  const existingPaths = new Set<string>();
  const collect = (n: SitemapNode) => {
    existingPaths.add(n.path);
    n.children.forEach(collect);
  };
  collect(tree);

  return {
    domain: opts.domain,
    origin,
    robots: { url: robotsUrl, found: robotsFound, sitemaps: robots.sitemaps, aiBots },
    sitemaps,
    totalUrls: urls.size,
    truncated,
    pageTypes,
    languages: [...langs.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count).slice(0, 12),
    lastmod: { newest, oldest, updatedLast30d, withDate },
    tree,
    important: (opts.previousImportant ?? []).filter((p) => existingPaths.has(p)),
    generatedAt: new Date().toISOString(),
  };
}
