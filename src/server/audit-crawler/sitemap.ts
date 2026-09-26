/**
 * Sitemap XML parsing (urlset + sitemapindex) with a streaming htmlparser2 tokenizer in XML mode.
 * Pure / isomorphic.
 */
import { Parser } from "htmlparser2";

export type ParsedSitemap = {
  kind: "urlset" | "sitemapindex" | "unknown";
  /** <url><loc> values */
  urls: string[];
  /** <sitemap><loc> values */
  sitemaps: string[];
  /** Number of <url> entries with a <lastmod>. */
  withLastmod: number;
};

export function isProbablySitemapXml(contentType: string | null, body: string): boolean {
  if (contentType?.toLowerCase().includes("xml")) return true;
  const trimmed = body.trimStart().toLowerCase();
  return trimmed.startsWith("<?xml") || trimmed.startsWith("<urlset") || trimmed.startsWith("<sitemapindex");
}

function localName(name: string): string {
  const idx = name.indexOf(":");
  return (idx === -1 ? name : name.slice(idx + 1)).toLowerCase();
}

export function parseSitemapXml(body: string, maxEntries = 50_000): ParsedSitemap {
  const result: ParsedSitemap = { kind: "unknown", urls: [], sitemaps: [], withLastmod: 0 };
  const stack: string[] = [];
  let text: string[] | null = null;
  let entryHasLastmod = false;
  const parser = new Parser(
    {
      onopentag(rawName) {
        const name = localName(rawName);
        stack.push(name);
        if (stack.length === 1) {
          if (name === "urlset") result.kind = "urlset";
          else if (name === "sitemapindex") result.kind = "sitemapindex";
        }
        if (name === "url" || name === "sitemap") entryHasLastmod = false;
        if (name === "loc" || name === "lastmod") text = [];
      },
      ontext(t) {
        if (text) text.push(t);
      },
      onclosetag(rawName) {
        const name = localName(rawName);
        const parent = stack[stack.length - 2];
        if (name === "loc" && text) {
          const value = text.join("").trim();
          if (value) {
            if (parent === "url" && result.urls.length < maxEntries) result.urls.push(value);
            else if (parent === "sitemap" && result.sitemaps.length < maxEntries) result.sitemaps.push(value);
          }
          text = null;
        } else if (name === "lastmod") {
          if (text && text.join("").trim()) entryHasLastmod = true;
          text = null;
        } else if (name === "url" && entryHasLastmod) {
          result.withLastmod += 1;
        }
        stack.pop();
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(body);
  parser.end();
  return result;
}
