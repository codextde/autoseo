/**
 * Streaming HTML page analyzer (port of open-seo `page-analyzer.ts`, htmlparser2 tokenizer — no DOM).
 * Extracts title, meta, headings, images, links, canonical, OG, structured data, robots meta,
 * word count, hreflang. Additions: JSON-LD @type list and <html lang>.
 */
import { Parser } from "htmlparser2";
import { isSameOrigin, normalizeUrl } from "./url-utils";
import type { PageAnalysis, PageLink } from "./types";

const SKIPPED_LINK_PROTOCOLS = /^(javascript:|mailto:|tel:|#)/i;
/** Subtrees whose text is not visible content. */
const NON_CONTENT_TAGS = new Set(["script", "style", "noscript", "svg", "template"]);
const HEADING_LEVELS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const MAX_ANCHOR_CHARS = 200;
const MAX_EXTRACTED_LINKS = 1_000;
const MAX_EXTRACTED_IMAGES = 1_000;
const MAX_JSONLD_CHARS = 200_000;

interface OpenAnchor {
  href: string;
  rel: string;
  text: string[];
}

/** Collects @type values from a parsed JSON-LD document (incl. @graph and nested nodes). */
export function collectJsonLdTypes(value: unknown, out = new Set<string>(), depth = 0): Set<string> {
  if (depth > 6 || value == null) return out;
  if (Array.isArray(value)) {
    for (const v of value) collectJsonLdTypes(v, out, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") out.add(t.replace(/^https?:\/\/schema\.org\//, ""));
    else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") out.add(x.replace(/^https?:\/\/schema\.org\//, ""));
    for (const [k, v] of Object.entries(obj)) {
      if (k === "@context") continue;
      if (v && typeof v === "object") collectJsonLdTypes(v, out, depth + 1);
    }
  }
  return out;
}

export function analyzeHtml(
  html: string,
  pageUrl: string,
  statusCode: number,
  responseTimeMs: number,
  redirectUrl: string | null = null,
): PageAnalysis {
  let title: string | null = null;
  let titleDepth = 0;
  let titleDone = false;
  let noscriptDepth = 0;
  let metaDescription: string | null = null;
  let canonical: string | null = null;
  let robotsMeta: string | null = null;
  let ogTitle: string | null = null;
  let ogDescription: string | null = null;
  let ogImage: string | null = null;
  let hasStructuredData = false;
  let lang: string | null = null;
  const hreflangTags: string[] = [];
  const jsonLdTypes = new Set<string>();
  let jsonLdBuffer: string[] | null = null;

  const h1s: string[] = [];
  const headingOrder: number[] = [];
  let openH1: string[] | null = null;

  const images: Array<{ src: string | null; alt: string | null }> = [];
  const linksByTarget = new Map<string, PageLink>();
  let openAnchor: OpenAnchor | null = null;

  let suppressDepth = 0;
  let bodyDepth = 0;
  let headDepth = 0;
  let sawBody = false;
  const bodyParts: string[] = [];
  const fallbackParts: string[] = [];

  const handleMetaTag = (attribs: Record<string, string>) => {
    const content = attribs["content"];
    const name = attribs["name"]?.toLowerCase();
    const property = attribs["property"]?.toLowerCase();
    if (name === "description") metaDescription ??= content?.trim() ?? "";
    else if (name === "robots") robotsMeta ??= content ?? null;
    else if (property === "og:title") ogTitle ??= content ?? null;
    else if (property === "og:description") ogDescription ??= content ?? null;
    else if (property === "og:image") ogImage ??= content ?? null;
  };

  const handleLinkTag = (attribs: Record<string, string>) => {
    const rel = (attribs["rel"] ?? "").toLowerCase().split(/\s+/);
    if (rel.includes("canonical")) canonical ??= attribs["href"] ?? null;
    else if (rel.includes("alternate") && attribs["hreflang"]) hreflangTags.push(attribs["hreflang"]);
  };

  const closeAnchor = () => {
    if (!openAnchor) return;
    const { href, rel, text } = openAnchor;
    openAnchor = null;
    if (linksByTarget.size >= MAX_EXTRACTED_LINKS) return;
    const resolved = normalizeUrl(href, pageUrl);
    if (!resolved || linksByTarget.has(resolved)) return;
    const anchor = text.join("").replace(/\s+/g, " ").trim().slice(0, MAX_ANCHOR_CHARS);
    linksByTarget.set(resolved, {
      targetUrl: resolved,
      anchor: anchor || null,
      isInternal: isSameOrigin(resolved, pageUrl),
      isNofollow: rel.split(/\s+/).includes("nofollow"),
    });
  };

  const parser = new Parser({
    onopentag(name, attribs) {
      if (NON_CONTENT_TAGS.has(name)) suppressDepth += 1;
      if (name === "noscript") noscriptDepth += 1;
      if (noscriptDepth > 0) return;
      switch (name) {
        case "html":
          lang ??= attribs["lang"]?.trim() || null;
          break;
        case "title":
          if (!titleDone && suppressDepth === 0) {
            titleDepth += 1;
            if (title === null) title = "";
          }
          break;
        case "head":
          headDepth += 1;
          break;
        case "body":
          bodyDepth += 1;
          sawBody = true;
          break;
        case "meta":
          handleMetaTag(attribs);
          break;
        case "link":
          handleLinkTag(attribs);
          break;
        case "img":
          if (images.length < MAX_EXTRACTED_IMAGES) {
            images.push({ src: attribs["src"] ?? attribs["data-src"] ?? null, alt: "alt" in attribs ? (attribs["alt"] ?? "") : null });
          }
          break;
        case "script":
          if ((attribs["type"] ?? "").toLowerCase().trim() === "application/ld+json") {
            hasStructuredData = true;
            jsonLdBuffer = [];
          }
          break;
        case "a": {
          closeAnchor();
          const href = attribs["href"]?.trim();
          if (href && !SKIPPED_LINK_PROTOCOLS.test(href)) {
            openAnchor = { href, rel: attribs["rel"]?.toLowerCase() ?? "", text: [] };
          }
          break;
        }
      }
      const headingLevel = HEADING_LEVELS[name];
      if (headingLevel !== undefined) {
        headingOrder.push(headingLevel);
        if (headingLevel === 1 && openH1 === null) openH1 = [];
      }
    },
    ontext(text) {
      if (jsonLdBuffer) {
        if (jsonLdBuffer.reduce((n, s) => n + s.length, 0) < MAX_JSONLD_CHARS) jsonLdBuffer.push(text);
        return;
      }
      if (suppressDepth > 0) return;
      if (titleDepth > 0) {
        if (title !== null) title += text;
        return;
      }
      if (openH1) openH1.push(text);
      if (openAnchor) openAnchor.text.push(text);
      if (bodyDepth > 0) bodyParts.push(text);
      else if (headDepth === 0) fallbackParts.push(text);
    },
    onclosetag(name) {
      if (name === "script" && jsonLdBuffer) {
        try {
          collectJsonLdTypes(JSON.parse(jsonLdBuffer.join("")), jsonLdTypes);
        } catch {
          /* invalid JSON-LD — still counts as present */
        }
        jsonLdBuffer = null;
      }
      if (NON_CONTENT_TAGS.has(name) && suppressDepth > 0) suppressDepth -= 1;
      if (name === "noscript" && noscriptDepth > 0) {
        noscriptDepth -= 1;
        return;
      }
      if (noscriptDepth > 0) return;
      if (name === "title" && titleDepth > 0) {
        titleDepth -= 1;
        if (titleDepth === 0) titleDone = true;
      }
      if (name === "head" && headDepth > 0) headDepth -= 1;
      if (name === "body" && bodyDepth > 0) bodyDepth -= 1;
      if (name === "a") closeAnchor();
      if (name === "h1" && openH1) {
        h1s.push(openH1.join("").replace(/\s+/g, " ").trim());
        openH1 = null;
      }
    },
  });
  parser.write(html);
  parser.end();
  closeAnchor();

  const rawText = (sawBody ? bodyParts : fallbackParts).join(" ");
  const bodyText = rawText.replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

  return {
    url: pageUrl,
    statusCode,
    redirectUrl,
    responseTimeMs,
    title: (title ?? "").replace(/\s+/g, " ").trim(),
    metaDescription: metaDescription ?? "",
    canonical,
    robotsMeta,
    ogTitle,
    ogDescription,
    ogImage,
    h1s,
    headingOrder,
    wordCount,
    bodyText,
    images,
    links: Array.from(linksByTarget.values()),
    hasStructuredData,
    structuredDataTypes: [...jsonLdTypes].slice(0, 50),
    hreflangTags,
    lang,
  };
}
