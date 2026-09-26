import { describe, expect, it } from "vitest";
import { analyzeHtml } from "../page-analyzer";
import { buildPageResultFromHtml, classifyFetch, parseLinkHeaderCanonical } from "../fetch-page";

const PAGE = `<!doctype html><html lang="de"><head>
<title>  Hello   World </title>
<meta name="description" content=" A description ">
<meta name="robots" content="noindex, follow">
<meta property="og:title" content="OG">
<link rel="canonical" href="/canonical/">
<link rel="alternate" hreflang="en" href="/en">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":["WebSite","Thing"]}]}</script>
<script>var x = "<title>nope</title> many words here";</script>
</head><body>
<svg><title>svg title</title></svg>
<h1></h1><h1>Main <b>heading</b></h1><h2>a</h2><h4>skip</h4>
<p>One two three</p><p>four</p>
<noscript><img src="/tracking.gif"><a href="/noscript-link">x</a></noscript>
<img src="/a.png"><img src="/b.png" alt=""><img src="/c.png" alt="C">
<a href="/x">X link</a><a href="/x#frag">dup</a><a href="https://other.com/" rel="nofollow ugc">ext</a>
<a href="mailto:a@b.c">mail</a><a href="javascript:void(0)">js</a><a href="#top">top</a>
</body></html>`;

describe("page analyzer", () => {
  const a = analyzeHtml(PAGE, "https://example.com/page", 200, 100);
  it("extracts head metadata (ignoring svg/script titles)", () => {
    expect(a.title).toBe("Hello World");
    expect(a.metaDescription).toBe("A description");
    expect(a.robotsMeta).toBe("noindex, follow");
    expect(a.ogTitle).toBe("OG");
    expect(a.canonical).toBe("/canonical/");
    expect(a.hreflangTags).toEqual(["en"]);
    expect(a.lang).toBe("de");
  });
  it("collects JSON-LD types including @graph and arrays", () => {
    expect(a.hasStructuredData).toBe(true);
    expect(a.structuredDataTypes.sort()).toEqual(["Organization", "Thing", "WebSite"]);
  });
  it("counts headings, empty H1s and heading order", () => {
    expect(a.h1s).toEqual(["", "Main heading"]);
    expect(a.headingOrder).toEqual([1, 1, 2, 4]);
  });
  it("tracks alt attributes (absent vs empty) and skips noscript content", () => {
    expect(a.images).toEqual([
      { src: "/a.png", alt: null },
      { src: "/b.png", alt: "" },
      { src: "/c.png", alt: "C" },
    ]);
  });
  it("dedupes links by normalized target and flags internal/nofollow", () => {
    expect(a.links.map((l) => l.targetUrl)).toEqual(["https://example.com/x", "https://other.com/"]);
    expect(a.links[0]!.isInternal).toBe(true);
    expect(a.links[0]!.anchor).toBe("X link");
    expect(a.links[1]!.isNofollow).toBe(true);
  });
  it("counts visible body words only", () => {
    expect(a.bodyText).not.toContain("many words");
    expect(a.bodyText).not.toContain("svg title");
    expect(a.wordCount).toBeGreaterThan(5);
  });
});

describe("page result building", () => {
  it("derives h1Count (non-empty), missing alt, indexability and canonical", () => {
    const r = buildPageResultFromHtml({
      id: "p1",
      url: "https://example.com/page",
      statusCode: 200,
      body: PAGE,
      contentType: "text/html",
      responseTimeMs: 50,
      xRobotsTag: null,
      headerCanonicalUrl: null,
      crawlDepth: 1,
      inSitemap: false,
    });
    expect(r.h1Count).toBe(1);
    expect(r.imagesMissingAlt).toBe(1);
    expect(r.imagesTotal).toBe(3);
    expect(r.isIndexable).toBe(false);
    expect(r.canonicalUrl).toBe("https://example.com/canonical/");
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("X-Robots-Tag noindex also makes a page non-indexable", () => {
    const r = buildPageResultFromHtml({ id: "p", url: "https://e.com/", statusCode: 200, body: "<title>t</title>", contentType: "text/html", responseTimeMs: 1, xRobotsTag: "NOINDEX", headerCanonicalUrl: null, crawlDepth: 0, inSitemap: false });
    expect(r.isIndexable).toBe(false);
  });
  it("classifies bot challenges and rate limits", () => {
    const h = (o: Record<string, string> = {}) => new Headers(o);
    expect(classifyFetch(0, h(), "")).toBe("error");
    expect(classifyFetch(429, h({ "cf-mitigated": "challenge" }), "")).toBe("rate_limited");
    expect(classifyFetch(200, h({ "cf-mitigated": "challenge" }), "")).toBe("blocked");
    expect(classifyFetch(403, h(), "")).toBe("blocked");
    expect(classifyFetch(401, h(), "")).toBe("blocked");
    expect(classifyFetch(503, h(), "<title>Just a moment...</title>")).toBe("blocked");
    expect(classifyFetch(503, h(), "maintenance")).toBe("ok");
    expect(classifyFetch(404, h(), "")).toBe("ok");
  });
  it("parses Link header canonicals", () => {
    expect(parseLinkHeaderCanonical('<https://e.com/a>; rel="preload", <https://e.com/c?b=1&a=2>; rel="canonical"', "https://e.com/")).toBe("https://e.com/c?a=2&b=1");
    expect(parseLinkHeaderCanonical("<https://e.com/a>; rel=preload", "https://e.com/")).toBeNull();
  });
});
