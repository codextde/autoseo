/**
 * AI-crawlability signals from raw (non-rendered) HTML — exactly what most AI crawlers see, since
 * they do not execute JavaScript. Pure / isomorphic.
 */
import { Parser } from "htmlparser2";
import { analyzeHtml, collectJsonLdTypes } from "../audit-crawler/page-analyzer";

export type RenderingVerdict = "ssr" | "partial" | "csr";

export type HtmlSignals = {
  title: string;
  metaDescription: string;
  h1Count: number;
  wordCount: number;
  linkCount: number;
  internalLinkCount: number;
  lang: string | null;
  canonical: string | null;
  /** All robots-like meta tags: robots, googlebot, gptbot, … */
  metaRobots: Array<{ name: string; content: string }>;
  jsonLd: { count: number; invalid: number; types: string[] };
  microdataItems: number;
  rendering: {
    verdict: RenderingVerdict;
    frameworks: string[];
    spaMarkers: string[];
    scriptCount: number;
    inlineScriptBytes: number;
    textBytes: number;
    htmlBytes: number;
  };
};

const ROBOTS_META_NAMES = /^(robots|googlebot|googlebot-news|google-extended|bingbot|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-user|claude-searchbot|anthropic-ai|perplexitybot|ccbot|applebot|applebot-extended|bytespider|amazonbot|meta-externalagent|cohere-ai|slurp|yandex|duckassistbot|mistralai-user)$/i;

const FRAMEWORK_PATTERNS: Array<[string, RegExp]> = [
  ["Next.js", /__NEXT_DATA__|self\.__next_f|\/_next\/static\//],
  ["Nuxt", /__NUXT__|__NUXT_DATA__|\/_nuxt\//],
  ["Gatsby", /id="___gatsby"/],
  ["Remix / React Router", /__remixContext|__reactRouterContext/],
  ["Astro", /<astro-island|astro-[a-z0-9]{8}/i],
  ["SvelteKit", /\/_app\/immutable\/|data-sveltekit/],
  ["Angular", /ng-version=|<app-root/],
  ["Vue", /data-v-app|data-server-rendered|id="app"/],
  ["React", /data-reactroot|id="root"/],
  ["WordPress", /\/wp-content\/|\/wp-includes\//],
  ["Shopify", /cdn\.shopify\.com|Shopify\.theme/],
  ["Webflow", /data-wf-page|webflow\.com/i],
  ["Wix", /static\.wixstatic\.com|wix-bolt/i],
  ["Squarespace", /static1\.squarespace\.com/],
  ["Framer", /framerusercontent\.com|data-framer-/],
];

const SPA_MARKERS: Array<[string, RegExp]> = [
  ["Empty #root container", /<div[^>]*\bid=["']root["'][^>]*>\s*<\/div>/i],
  ["Empty #app container", /<div[^>]*\bid=["']app["'][^>]*>\s*<\/div>/i],
  ["Empty #__next container", /<div[^>]*\bid=["']__next["'][^>]*>\s*<\/div>/i],
  ["Empty #__nuxt container", /<div[^>]*\bid=["']__nuxt["'][^>]*>\s*<\/div>/i],
  ["Empty <app-root>", /<app-root[^>]*>\s*<\/app-root>/i],
  ['"Enable JavaScript" notice', /<noscript[^>]*>[^<]*(enable javascript|javascript (is )?(required|disabled)|javascript aktivieren)/i],
];

export function extractHtmlSignals(html: string, url: string): HtmlSignals {
  const analysis = analyzeHtml(html, url, 200, 0);
  const metaRobots: HtmlSignals["metaRobots"] = [];
  let scriptCount = 0;
  let inlineScriptBytes = 0;
  let inScript = false;
  let jsonLdCount = 0;
  let jsonLdInvalid = 0;
  let jsonLdBuf: string[] | null = null;
  let microdataItems = 0;
  const jsonLdTypes = new Set<string>();

  const parser = new Parser({
    onopentag(name, attribs) {
      if (name === "meta") {
        const metaName = (attribs["name"] ?? "").trim().toLowerCase();
        if (metaName && ROBOTS_META_NAMES.test(metaName) && attribs["content"] !== undefined) {
          metaRobots.push({ name: metaName, content: attribs["content"]!.trim() });
        }
      }
      if ("itemscope" in attribs && attribs["itemtype"]) microdataItems += 1;
      if (name === "script") {
        scriptCount += 1;
        const type = (attribs["type"] ?? "").toLowerCase().trim();
        if (type === "application/ld+json") {
          jsonLdCount += 1;
          jsonLdBuf = [];
        } else if (!attribs["src"]) {
          inScript = true;
        }
      }
    },
    ontext(text) {
      if (jsonLdBuf) jsonLdBuf.push(text);
      else if (inScript) inlineScriptBytes += text.length;
    },
    onclosetag(name) {
      if (name === "script") {
        if (jsonLdBuf) {
          try {
            collectJsonLdTypes(JSON.parse(jsonLdBuf.join("")), jsonLdTypes);
          } catch {
            jsonLdInvalid += 1;
          }
          jsonLdBuf = null;
        }
        inScript = false;
      }
    },
  });
  parser.write(html);
  parser.end();

  const frameworks = FRAMEWORK_PATTERNS.filter(([, re]) => re.test(html)).map(([n]) => n);
  // "React"/"Vue" markers are generic; drop them when a meta-framework was detected.
  const meta = frameworks.filter((f) => !["React", "Vue"].includes(f));
  const finalFrameworks = meta.length ? meta : frameworks;
  const spaMarkers = SPA_MARKERS.filter(([, re]) => re.test(html)).map(([n]) => n);
  const textBytes = analysis.bodyText.length;
  const htmlBytes = html.length;
  const internalLinkCount = analysis.links.filter((l) => l.isInternal).length;
  const h1Count = analysis.h1s.filter((h) => h.length > 0).length;

  let verdict: RenderingVerdict;
  if (analysis.wordCount >= 150 || (analysis.wordCount >= 60 && h1Count > 0 && analysis.links.length >= 5)) verdict = "ssr";
  else if (analysis.wordCount < 40 && (spaMarkers.length > 0 || inlineScriptBytes > textBytes * 5 || analysis.links.length < 3)) verdict = "csr";
  else verdict = "partial";

  return {
    title: analysis.title,
    metaDescription: analysis.metaDescription,
    h1Count,
    wordCount: analysis.wordCount,
    linkCount: analysis.links.length,
    internalLinkCount,
    lang: analysis.lang,
    canonical: analysis.canonical,
    metaRobots,
    jsonLd: { count: jsonLdCount, invalid: jsonLdInvalid, types: [...jsonLdTypes].slice(0, 40) },
    microdataItems,
    rendering: { verdict, frameworks: finalFrameworks, spaMarkers, scriptCount, inlineScriptBytes, textBytes, htmlBytes },
  };
}

/** Directives relevant for AI usage, from meta robots tags + X-Robots-Tag. */
export const AI_DIRECTIVES = ["noindex", "nofollow", "noai", "noimageai", "nosnippet", "max-snippet:0", "noarchive", "none"] as const;

export type DirectiveHit = { directive: string; source: string; scope: string };

/**
 * Parses directives. `scope` = "all" for robots/generic X-Robots-Tag, else the bot name
 * (meta name="gptbot" or "X-Robots-Tag: googlebot: noindex").
 */
export function parseDirectives(metaRobots: Array<{ name: string; content: string }>, xRobotsTag: string | null): DirectiveHit[] {
  const hits: DirectiveHit[] = [];
  const add = (content: string, source: string, scope: string) => {
    for (const raw of content.toLowerCase().split(/\s*,\s*/)) {
      const d = raw.trim().replace(/\s+/g, "");
      if (!d) continue;
      if (d === "none") {
        hits.push({ directive: "noindex", source, scope }, { directive: "nofollow", source, scope });
        continue;
      }
      if (d.startsWith("max-snippet:")) {
        if (d === "max-snippet:0") hits.push({ directive: "max-snippet:0", source, scope });
        continue;
      }
      if ((AI_DIRECTIVES as readonly string[]).includes(d)) hits.push({ directive: d, source, scope });
    }
  };
  for (const m of metaRobots) add(m.content, `<meta name="${m.name}">`, m.name === "robots" ? "all" : m.name);
  if (xRobotsTag) {
    // Multiple headers are joined with ", " — "googlebot: noindex, otherbot: nosnippet" or "noindex, nofollow"
    for (const part of xRobotsTag.split(/,(?=\s*[a-z0-9_-]+\s*:)/i)) {
      const m = part.match(/^\s*([a-z0-9_-]+)\s*:\s*(.+)$/i);
      if (m && !/^(max-snippet|max-image-preview|max-video-preview|unavailable_after)$/i.test(m[1]!)) add(m[2]!, "X-Robots-Tag", m[1]!.toLowerCase());
      else add(part, "X-Robots-Tag", "all");
    }
  }
  return hits;
}
