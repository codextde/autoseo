import { describe, expect, it } from "vitest";
import { buildStoredLighthouseIssues, buildStoredPayloadFromReport, getLighthouseSeverity, sortLighthouseIssues } from "../lighthouse/stored-payload";
import { selectLighthouseSample } from "../lighthouse/sample";
import { computeHealthScore } from "../scoring";
import { adjustCrawlWindow, crawlWindowLimits } from "../crawl-window";
import { createCrawlThrottle, initialThrottleState, parseRetryAfterMs } from "../crawl-throttle";
import { buildCsv, csvCell } from "../csv";

describe("Lighthouse issue extraction", () => {
  it("severity thresholds (open-seo parity)", () => {
    expect(getLighthouseSeverity({ score: 95, impactMs: 300, impactBytes: null })).toBe("critical");
    expect(getLighthouseSeverity({ score: 95, impactMs: null, impactBytes: 150_000 })).toBe("critical");
    expect(getLighthouseSeverity({ score: 49, impactMs: null, impactBytes: null })).toBe("critical");
    expect(getLighthouseSeverity({ score: 95, impactMs: 100, impactBytes: null })).toBe("warning");
    expect(getLighthouseSeverity({ score: 95, impactMs: null, impactBytes: 50_000 })).toBe("warning");
    expect(getLighthouseSeverity({ score: 89, impactMs: null, impactBytes: null })).toBe("warning");
    expect(getLighthouseSeverity({ score: null, impactMs: 10, impactBytes: 10 })).toBe("info");
  });
  it("skips passes, numeric/diagnostic/informative audits and compacts items", () => {
    const { issues, hasIssueDetails } = buildStoredLighthouseIssues({
      categories: {
        performance: { score: 0.5, auditRefs: [{ id: "lcp" }, { id: "render-blocking" }, { id: "diagnostics" }, { id: "good" }, { id: "info-only" }, { id: "missing" }] },
        seo: { score: 0.8, auditRefs: [{ id: "meta-description" }] },
      },
      audits: {
        lcp: { score: 0.1, scoreDisplayMode: "numeric", title: "LCP" },
        "render-blocking": {
          score: 0.4,
          scoreDisplayMode: "metricSavings",
          title: "Eliminate render-blocking resources",
          displayValue: "Potential savings of 450 ms",
          details: { overallSavingsMs: 450, items: [{ url: "https://e.com/a.css", totalBytes: 1000, wastedMs: 450, extra: "x" }] },
        },
        diagnostics: { score: 0, scoreDisplayMode: "binary" },
        good: { score: 1, scoreDisplayMode: "binary" },
        "info-only": { score: 0, scoreDisplayMode: "informative" },
        "meta-description": { score: 0, scoreDisplayMode: "binary", title: "Document does not have a meta description", details: { items: { node: "x" } } },
      },
    });
    expect(hasIssueDetails).toBe(true);
    expect(issues.map((i) => i.auditKey)).toEqual(["render-blocking", "meta-description"]);
    expect(issues[0]).toMatchObject({ category: "performance", score: 40, impactMs: 450, severity: "critical" });
    expect(JSON.parse(issues[0]!.items[0]!)).toEqual({ url: "https://e.com/a.css", totalBytes: 1000, wastedMs: 450 });
    expect(issues[1]!.items).toEqual([JSON.stringify({ node: "x" })]);
  });
  it("builds the compact v2 payload and rejects reports without scores", () => {
    const payload = buildStoredPayloadFromReport(
      {
        finalUrl: "https://e.com/",
        lighthouseVersion: "12.0.0",
        categories: { performance: { score: 0.91, auditRefs: [] }, seo: { score: 1 } },
        audits: { "largest-contentful-paint": { score: 0.8, displayValue: "2.1 s", numericValue: 2100 } },
      },
      { url: "https://e.com", strategy: "mobile", source: "pagespeed-insights" },
    );
    expect(payload.scores).toEqual({ performance: 91, accessibility: null, "best-practices": null, seo: 100 });
    expect(payload.metrics.largestContentfulPaint).toEqual({ score: 80, displayValue: "2.1 s", numericValue: 2100 });
    expect(payload.metadata.finalUrl).toBe("https://e.com/");
    expect(() => buildStoredPayloadFromReport({ categories: {} }, { url: "https://e.com", strategy: "desktop", source: "pagespeed-insights" })).toThrow(/no category scores/);
    expect(() => buildStoredPayloadFromReport({ runtimeError: { code: "NO_FCP" } }, { url: "https://e.com", strategy: "desktop", source: "pagespeed-insights" })).toThrow(/NO_FCP/);
  });
  it("sorts by impact (ms weighted) then score", () => {
    const base = { category: "performance" as const, auditKey: "a", title: "", description: "", scoreDisplayMode: null, displayValue: null, severity: "warning" as const, items: [] };
    const sorted = sortLighthouseIssues([
      { ...base, auditKey: "bytes", impactMs: null, impactBytes: 900_000, score: 10 },
      { ...base, auditKey: "ms", impactMs: 1000, impactBytes: null, score: 50 },
      { ...base, auditKey: "none-low", impactMs: null, impactBytes: null, score: 5 },
      { ...base, auditKey: "none-high", impactMs: null, impactBytes: null, score: 80 },
    ]);
    expect(sorted.map((i) => i.auditKey)).toEqual(["ms", "bytes", "none-low", "none-high"]);
  });
});

describe("Lighthouse sampling", () => {
  it("homepage first, one page per URL template, 2xx only, max 10", () => {
    const pages = [
      { url: "https://www.e.com/blog/first-great-post", statusCode: 200 },
      { url: "https://www.e.com/blog/second-great-post", statusCode: 200 },
      { url: "https://www.e.com/", statusCode: 200 },
      { url: "https://www.e.com/products/1", statusCode: 200 },
      { url: "https://www.e.com/products/2", statusCode: 200 },
      { url: "https://www.e.com/broken", statusCode: 404 },
      ...Array.from({ length: 20 }, (_, i) => ({ url: `https://www.e.com/section${i}`, statusCode: 200 })),
    ];
    const sample = selectLighthouseSample(pages, "https://e.com/", "auto");
    expect(sample[0]).toBe("https://www.e.com/");
    expect(sample).toHaveLength(10);
    expect(sample.filter((u) => u.includes("/blog/"))).toHaveLength(1);
    expect(sample.filter((u) => u.includes("/products/"))).toHaveLength(1);
    expect(sample).not.toContain("https://www.e.com/broken");
    expect(selectLighthouseSample(pages, "https://e.com/", "none")).toEqual([]);
  });
});

describe("health score", () => {
  it("averages page scores with severity penalties and skips clean redirects", () => {
    const pages = [
      { id: "a", statusCode: 200 },
      { id: "b", statusCode: 200 },
      { id: "r", statusCode: 301 },
    ];
    const issues = [
      { pageId: "a", issueType: "missing-title" }, // critical −30
      { pageId: "a", issueType: "title-too-long" }, // info −2 (another type)
      { pageId: "b", issueType: "images-missing-alt" }, // warning −10
      { pageId: "b", issueType: "images-missing-alt" }, // same type counts once
    ];
    const { score, pageScores } = computeHealthScore(pages, issues);
    expect(pageScores.get("a")!.score).toBe(68);
    expect(pageScores.get("b")!.score).toBe(90);
    expect(pageScores.get("b")!.issueCount).toBe(2);
    expect(score).toBe(79);
    expect(computeHealthScore(pages, issues, { rateLimited: true }).score).toBe(74);
    expect(computeHealthScore([], []).score).toBeNull();
  });
});

describe("crawl politeness", () => {
  it("parses Retry-After seconds and HTTP dates", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
    expect(parseRetryAfterMs(null)).toBeNull();
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:10 GMT", now)).toBe(10_000);
  });
  it("paces requests, backs off on 429 and stops after too many", async () => {
    const saved: unknown[] = [];
    const t = createCrawlThrottle(Date.now() + 60_000, initialThrottleState(10), async (s) => void saved.push(s));
    expect(await t.ready()).toBe(true);
    expect(await t.backoff(1, "0")).toBe(true);
    expect(t.state.intervalMs).toBe(20);
    expect(t.state.consecutiveRateLimits).toBe(1);
    await t.recovered();
    expect(t.state.consecutiveRateLimits).toBe(0);
    for (let i = 1; i <= 4; i++) await t.backoff(i, "0");
    expect(t.stopped).toBe(true);
    expect(await t.ready()).toBe(false);
    expect(saved.length).toBeGreaterThan(0);
  });
  it("honours crawl-delay as a minimum interval and the chunk deadline", async () => {
    const t = createCrawlThrottle(Date.now() + 50, initialThrottleState(250), undefined, { minIntervalMs: 5000 });
    expect(t.state.intervalMs).toBe(5000);
    expect(await t.ready()).toBe(true);
    expect(await t.ready()).toBe(false); // next slot is past the deadline
  });
  it("adapts the crawl window", () => {
    const limits = crawlWindowLimits(8);
    const ok = { fetchClass: "ok" as const, rateLimited: false, responseTimeMs: 200, htmlBytes: 50_000 };
    expect(adjustCrawlWindow(2, Array(25).fill(ok), limits)).toBe(7);
    expect(adjustCrawlWindow(7, Array(25).fill(ok), limits)).toBe(8);
    expect(adjustCrawlWindow(8, [...Array(5).fill(ok), ...Array(5).fill({ ...ok, fetchClass: "blocked" })], limits)).toBe(4);
    expect(adjustCrawlWindow(8, Array(25).fill({ ...ok, htmlBytes: 16 * 1024 * 1024 }), limits)).toBe(2);
  });
});

describe("CSV", () => {
  it("escapes quotes/newlines and neutralizes formula injection", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(null)).toBe("");
    expect(buildCsv(["A", "B"], [[1, "x\ny"]])).toBe('A,B\r\n1,"x\ny"\r\n');
  });
});
