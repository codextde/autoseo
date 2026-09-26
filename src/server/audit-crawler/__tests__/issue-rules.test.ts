import { describe, expect, it } from "vitest";
import { buildPageResultFromHtml } from "../fetch-page";
import { runPageReporters, type ReporterPage } from "../page-reporters";
import { AUDIT_ISSUE_TYPE_IDS, AUDIT_ISSUE_TYPES, getIssueDescriptor, type AuditIssueType } from "../registry";
import type { CrawledPageResult } from "../types";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const META_OK = "x".repeat(100);

function page(overrides: Partial<ReporterPage> = {}): ReporterPage {
  return {
    id: "p",
    url: "https://example.com/p",
    statusCode: 200,
    fetchClass: "ok",
    responseTimeMs: 100,
    isHtml: true,
    title: "A perfectly fine page title",
    metaDescription: META_OK,
    h1Count: 1,
    headingOrder: [1, 2, 3],
    isIndexable: true,
    robotsMeta: null,
    xRobotsTag: null,
    canonicalUrl: null,
    headerCanonicalUrl: null,
    wordCount: 400,
    imagesMissingAlt: 0,
    imagesTotal: 2,
    links: [{ targetUrl: "https://example.com/", anchor: "home", isInternal: true, isNofollow: false }],
    crawlDepth: 1,
    ...overrides,
  };
}
const types = (p: ReporterPage) => runPageReporters(p).map((i) => i.issueType).sort();

describe("issue registry", () => {
  it("has exactly the 29 open-seo issue types with severities", () => {
    expect(AUDIT_ISSUE_TYPE_IDS).toHaveLength(29);
    const bySeverity = (s: string) => AUDIT_ISSUE_TYPE_IDS.filter((t) => AUDIT_ISSUE_TYPES[t].severity === s).length;
    expect(bySeverity("critical")).toBe(4);
    expect(bySeverity("warning")).toBe(16);
    expect(bySeverity("info")).toBe(9);
    expect(getIssueDescriptor("missing-title")?.howToFix).toMatch(/50–60 characters/);
    expect(getIssueDescriptor("nope")).toBeNull();
  });
});

describe("per-page reporters (exact thresholds)", () => {
  it("clean page has no issues", () => {
    expect(types(page())).toEqual([]);
  });
  it("fetch class short-circuits everything else", () => {
    expect(types(page({ fetchClass: "blocked", statusCode: 403, title: "" }))).toEqual(["blocked-page"]);
    expect(types(page({ fetchClass: "rate_limited", statusCode: 429 }))).toEqual(["rate-limited-page"]);
    expect(types(page({ fetchClass: "error", statusCode: 0, title: "" }))).toEqual([]);
  });
  it("HTTP status: 5xx critical only, 4xx warning only, 3xx nothing", () => {
    expect(types(page({ statusCode: 500, title: "", responseTimeMs: 5000 }))).toEqual(["server-error"]);
    expect(types(page({ statusCode: 404, title: "" }))).toEqual(["broken-page"]);
    expect(types(page({ statusCode: 301, title: "" }))).toEqual([]);
  });
  it("slow response is checked before HTML gating (> 1500 ms)", () => {
    expect(types(page({ responseTimeMs: 1500 }))).toEqual([]);
    expect(types(page({ responseTimeMs: 1501, isHtml: false, title: "" }))).toEqual(["slow-response"]);
  });
  it("non-HTML documents skip content checks", () => {
    expect(types(page({ isHtml: false, title: "", metaDescription: "", h1Count: 0, wordCount: 0, links: [] }))).toEqual([]);
  });
  it("title rules: missing / >60 / <10", () => {
    expect(types(page({ title: "" }))).toEqual(["missing-title"]);
    expect(types(page({ title: "x".repeat(60) }))).toEqual([]);
    expect(types(page({ title: "x".repeat(61) }))).toEqual(["title-too-long"]);
    expect(types(page({ title: "x".repeat(10) }))).toEqual([]);
    expect(types(page({ title: "x".repeat(9) }))).toEqual(["title-too-short"]);
  });
  it("meta description rules: missing / >160 / <70", () => {
    expect(types(page({ metaDescription: "" }))).toEqual(["missing-meta-description"]);
    expect(types(page({ metaDescription: "x".repeat(160) }))).toEqual([]);
    expect(types(page({ metaDescription: "x".repeat(161) }))).toEqual(["meta-description-too-long"]);
    expect(types(page({ metaDescription: "x".repeat(70) }))).toEqual([]);
    expect(types(page({ metaDescription: "x".repeat(69) }))).toEqual(["meta-description-too-short"]);
  });
  it("headings: missing / multiple H1, level skips (decreasing is fine)", () => {
    expect(types(page({ h1Count: 0 }))).toEqual(["missing-h1"]);
    expect(types(page({ h1Count: 2 }))).toEqual(["multiple-h1"]);
    expect(types(page({ headingOrder: [1, 2, 4] }))).toEqual(["heading-order-skip"]);
    expect(types(page({ headingOrder: [1, 2, 3, 2, 1, 2] }))).toEqual([]);
  });
  it("indexability + canonical signals", () => {
    expect(types(page({ isIndexable: false, robotsMeta: "noindex" }))).toEqual(["noindex-page"]);
    expect(types(page({ canonicalUrl: "https://example.com/other" }))).toEqual(["canonicalized-page"]);
    expect(types(page({ canonicalUrl: "https://example.com/p" }))).toEqual([]);
    expect(types(page({ canonicalUrl: "https://example.com/a", headerCanonicalUrl: "https://example.com/b" }))).toEqual(["canonical-conflict", "canonicalized-page"]);
    expect(types(page({ headerCanonicalUrl: "https://example.com/p" }))).toEqual([]);
  });
  it("thin content (< 150 words) and no outgoing links only for indexable pages", () => {
    expect(types(page({ wordCount: 150 }))).toEqual([]);
    expect(types(page({ wordCount: 149 }))).toEqual(["thin-content"]);
    expect(types(page({ wordCount: 10, isIndexable: false }))).toEqual(["noindex-page"]);
    expect(types(page({ links: [] }))).toEqual(["no-outgoing-links"]);
    expect(types(page({ links: [], isIndexable: false }))).toEqual(["noindex-page"]);
  });
  it("images missing alt and deep pages (depth ≥ 5; sitemap-only null depth never)", () => {
    expect(types(page({ imagesMissingAlt: 2, imagesTotal: 3 }))).toEqual(["images-missing-alt"]);
    expect(types(page({ crawlDepth: 4 }))).toEqual([]);
    expect(types(page({ crawlDepth: 5 }))).toEqual(["deep-page"]);
    expect(types(page({ crawlDepth: null }))).toEqual([]);
  });
  it("attaches details payloads", () => {
    const [issue] = runPageReporters(page({ title: "x".repeat(70) }));
    expect(issue!.details).toEqual({ length: 70 });
    const [alt] = runPageReporters(page({ imagesMissingAlt: 2, imagesTotal: 3 }));
    expect(alt!.details).toEqual({ imagesMissingAlt: 2, imagesTotal: 3 });
  });
});

/** badseo-style fixtures (open-seo's end-to-end fixture site), run through the real HTML → page → reporter path. */
function fixture(html: string, opts: { url?: string; responseTimeMs?: number; xRobotsTag?: string | null; headerCanonical?: string | null; depth?: number | null } = {}): CrawledPageResult {
  return buildPageResultFromHtml({
    id: "f",
    url: opts.url ?? "https://badseo.dev/fixture",
    statusCode: 200,
    body: html,
    contentType: "text/html; charset=utf-8",
    responseTimeMs: opts.responseTimeMs ?? 50,
    xRobotsTag: opts.xRobotsTag ?? null,
    headerCanonicalUrl: opts.headerCanonical ?? null,
    crawlDepth: opts.depth === undefined ? 1 : opts.depth,
    inSitemap: false,
  });
}
const doc = (head: string, body: string) => `<html><head>${head}</head><body><nav><a href="/">Home</a></nav>${body}</body></html>`;
const GOOD_HEAD = `<title>Badseo fixture page title</title><meta name="description" content="${"d".repeat(100)}">`;
const GOOD_BODY = `<h1>Heading</h1><p>${words(200)}</p>`;

describe("badseo fixtures", () => {
  const cases: Array<[string, CrawledPageResult, AuditIssueType[]]> = [
    ["/head/missing-title", fixture(doc(`<meta name="description" content="${"d".repeat(100)}">`, GOOD_BODY)), ["missing-title"]],
    ["/head/title-too-long", fixture(doc(`<title>${"Long ".repeat(15)}</title><meta name="description" content="${"d".repeat(100)}">`, GOOD_BODY)), ["title-too-long"]],
    ["/head/title-too-short", fixture(doc(`<title>Short</title><meta name="description" content="${"d".repeat(100)}">`, GOOD_BODY)), ["title-too-short"]],
    ["/head/missing-meta-description", fixture(doc(`<title>Badseo fixture page title</title>`, GOOD_BODY)), ["missing-meta-description"]],
    ["/head/meta-description-too-long", fixture(doc(`<title>Badseo fixture page title</title><meta name="description" content="${"d".repeat(200)}">`, GOOD_BODY)), ["meta-description-too-long"]],
    ["/head/meta-description-too-short", fixture(doc(`<title>Badseo fixture page title</title><meta name="description" content="short">`, GOOD_BODY)), ["meta-description-too-short"]],
    ["/head/missing-h1", fixture(doc(GOOD_HEAD, `<p>${words(200)}</p>`)), ["missing-h1"]],
    ["/head/empty-h1", fixture(doc(GOOD_HEAD, `<h1></h1><p>${words(200)}</p>`)), ["missing-h1"]],
    ["/head/multiple-h1", fixture(doc(GOOD_HEAD, `<h1>A</h1><h1>B</h1><p>${words(200)}</p>`)), ["multiple-h1"]],
    ["/head/heading-order-skip", fixture(doc(GOOD_HEAD, `<h1>A</h1><h2>B</h2><h4>C</h4><p>${words(200)}</p>`)), ["heading-order-skip"]],
    ["/content/thin-content", fixture(doc(GOOD_HEAD, `<h1>A</h1><p>${words(20)}</p>`)), ["thin-content"]],
    ["/content/images-missing-alt", fixture(doc(GOOD_HEAD, `${GOOD_BODY}<img src="/x.png">`)), ["images-missing-alt"]],
    ["/index/noindex-meta", fixture(doc(`${GOOD_HEAD}<meta name="robots" content="noindex">`, GOOD_BODY)), ["noindex-page"]],
    ["/index/noindex-header", fixture(doc(GOOD_HEAD, GOOD_BODY), { xRobotsTag: "noindex" }), ["noindex-page"]],
    ["/index/canonicalized", fixture(doc(`${GOOD_HEAD}<link rel="canonical" href="/other">`, GOOD_BODY)), ["canonicalized-page"]],
    ["/index/canonical-conflict", fixture(doc(`${GOOD_HEAD}<link rel="canonical" href="/a">`, GOOD_BODY), { headerCanonical: "https://badseo.dev/b" }), ["canonical-conflict", "canonicalized-page"]],
    ["/perf/slow-response", fixture(doc(GOOD_HEAD, GOOD_BODY), { responseTimeMs: 1700 }), ["slow-response"]],
    ["/structure/no-outgoing-links", fixture(`<html><head>${GOOD_HEAD}</head><body>${GOOD_BODY}</body></html>`), ["no-outgoing-links"]],
    ["/structure/deep/treasure", fixture(doc(GOOD_HEAD, GOOD_BODY), { depth: 6 }), ["deep-page"]],
    [
      "/kitchen-sink",
      fixture(doc(`<title>${"Kitchen sink ".repeat(8)}</title>`, `<h1>A</h1><h1>B</h1><h4>C</h4><p>${words(200)}</p><img src="/k.png">`), { responseTimeMs: 1700 }),
      ["heading-order-skip", "images-missing-alt", "missing-meta-description", "multiple-h1", "slow-response", "title-too-long"],
    ],
    ["/ (clean)", fixture(doc(GOOD_HEAD, GOOD_BODY)), []],
  ];
  it.each(cases)("%s", (_name, result, expected) => {
    expect(runPageReporters(result).map((i) => i.issueType).sort()).toEqual([...expected].sort());
  });
});
