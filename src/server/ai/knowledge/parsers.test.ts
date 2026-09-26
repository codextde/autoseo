import { describe, expect, it } from "vitest";
import { classifyUrl, parseRobots, parseSitemapXml } from "./sitemap";
import { normalizeProduct, parsePrice, parseXmlFeed, parseCsvProducts, currencyForCountry } from "./products";
import { assertSafeUrl, isBlockedIp, UnsafeUrlError } from "./safe-fetch";
import { normalizeFunnel, parseVolume } from "@/server/ai/research/import";
import { deriveKeyword } from "@/server/ai/research/enrich";
import { volumeScores } from "@/server/ai/research/keywords";

describe("robots.txt", () => {
  it("groups user agents and collects sitemaps", () => {
    const r = parseRobots("User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nDisallow: /cart # comment\nSitemap: https://x.de/sitemap.xml");
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0]!.agents).toEqual(["gptbot", "claudebot"]);
    expect(r.groups[0]!.disallow).toEqual(["/"]);
    expect(r.sitemaps).toEqual(["https://x.de/sitemap.xml"]);
  });
});

describe("sitemap parsing", () => {
  it("ignores nested image locs and reads lastmod", () => {
    const s = parseSitemapXml(
      '<urlset><url><loc>https://x.de/a</loc><lastmod>2026-01-01</lastmod><image:image><image:loc>https://cdn/x.jpg</image:loc></image:image></url></urlset>',
    );
    expect(s).toEqual({ kind: "urlset", locs: [{ loc: "https://x.de/a", lastmod: "2026-01-01" }] });
  });
  it("detects sitemap indexes and text sitemaps", () => {
    expect(parseSitemapXml("<sitemapindex><sitemap><loc>https://x.de/s1.xml</loc></sitemap></sitemapindex>").kind).toBe("index");
    expect(parseSitemapXml("https://x.de/a\nhttps://x.de/b\n").locs).toHaveLength(2);
  });
  it("classifies page types", () => {
    expect(classifyUrl("/")).toBe("home");
    expect(classifyUrl("/de")).toBe("home");
    expect(classifyUrl("/products/on-power")).toBe("product");
    expect(classifyUrl("/collections/speicher")).toBe("category");
    expect(classifyUrl("/blogs/news/post")).toBe("blog");
    expect(classifyUrl("/pages/impressum")).toBe("legal");
    expect(classifyUrl("/pages/kontakt")).toBe("contact");
    expect(classifyUrl("/cart")).toBe("account");
    expect(classifyUrl("/something", "product")).toBe("product");
  });
});

describe("product feeds", () => {
  it("parses prices in several notations", () => {
    expect(parsePrice("29.99 EUR")).toEqual({ price: 29.99, currency: "EUR" });
    expect(parsePrice("€1.299,00")).toEqual({ price: 1299, currency: "EUR" });
    expect(parsePrice("$1,299.00")).toEqual({ price: 1299, currency: "USD" });
    expect(parsePrice("12", "CHF")).toEqual({ price: 12, currency: "CHF" });
  });
  it("normalizes Google Merchant XML items", () => {
    const items = parseXmlFeed(
      '<rss xmlns:g="http://base.google.com/ns/1.0"><channel><item><g:id>A1</g:id><title>Solar &amp; Speicher</title><link>https://x.de/p/a1</link><g:price>499.00 EUR</g:price><g:image_link>https://x.de/a1.jpg</g:image_link></item></channel></rss>',
    );
    const p = normalizeProduct(items[0]!);
    expect(p).toMatchObject({ sku: "A1", name: "Solar & Speicher", url: "https://x.de/p/a1", price: 499, currency: "EUR", imageUrl: "https://x.de/a1.jpg" });
  });
  it("rejects non-http image and product URLs", () => {
    const p = normalizeProduct({ name: "X", url: "javascript:alert(1)", image_url: "data:image/png;base64,AAA" });
    expect(p?.url).toBeNull();
    expect(p?.imageUrl).toBeNull();
  });
  it("reads CSV with headers and Shopify-like JSON", () => {
    const rows = parseCsvProducts("id;title;price\nA;Foo;9,90\n");
    expect(normalizeProduct(rows[0]!)).toMatchObject({ sku: "A", name: "Foo", price: 9.9 });
    expect(normalizeProduct({ title: "Bar", handle: "bar", __origin: "https://s.de", variants: [{ price: "10.00", sku: "B" }], images: [{ src: "https://s.de/b.jpg" }] })).toMatchObject({
      sku: "B",
      url: "https://s.de/products/bar",
      imageUrl: "https://s.de/b.jpg",
      price: 10,
    });
  });
  it("maps market currencies", () => {
    expect(currencyForCountry("DE")).toBe("EUR");
    expect(currencyForCountry("UK")).toBe("GBP");
    expect(currencyForCountry("ZZ")).toBeNull();
  });
});

describe("SSRF guard", () => {
  it("blocks private, loopback, link-local and mapped addresses", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.1", "172.16.0.5", "100.64.1.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"])
      expect(isBlockedIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2a00:1450:4001::1"]) expect(isBlockedIp(ip), ip).toBe(false);
  });
  it("rejects unsafe URLs", () => {
    for (const u of ["file:///etc/passwd", "http://localhost/", "http://127.0.0.1:3000/", "https://user:pw@x.de/", "http://x.de:22/", "http://intranet/"])
      expect(() => assertSafeUrl(u), u).toThrow(UnsafeUrlError);
    expect(assertSafeUrl("https://www.solakon.de/sitemap.xml").hostname).toBe("www.solakon.de");
  });
});

describe("prompt research helpers", () => {
  it("parses volumes with thousands separators and suffixes", () => {
    expect(parseVolume("1.300")).toBe(1300);
    expect(parseVolume("1,300")).toBe(1300);
    expect(parseVolume("2,5k")).toBe(2500);
    expect(parseVolume("12.5")).toBe(13);
    expect(parseVolume("abc")).toBeNull();
    expect(parseVolume("")).toBeNull();
  });
  it("normalizes funnel stages", () => {
    expect(normalizeFunnel("MOFU")).toBe("mofu");
    expect(normalizeFunnel("Awareness")).toBe("tofu");
    expect(normalizeFunnel("Decision")).toBe("bofu");
    expect(normalizeFunnel("?")).toBeNull();
  });
  it("derives a topic keyword from a question", () => {
    expect(deriveKeyword("Welches Balkonkraftwerk mit Speicher lohnt sich 2026?")).toBe("balkonkraftwerk speicher 2026");
  });
  it("scores volumes on a log scale relative to the maximum", () => {
    const [a, b, c] = volumeScores([10_000, 100, null]);
    expect(a).toBe(1);
    expect(b).toBeGreaterThan(0.4);
    expect(b).toBeLessThan(0.6);
    expect(c).toBeNull();
  });
});
