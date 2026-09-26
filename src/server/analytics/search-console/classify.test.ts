import { describe, expect, it } from "vitest";
import {
  buildStrikingDistanceRows,
  classifyIntent,
  isAiPrompt,
  matchesWordBucket,
  normalizePageKey,
  percentileRanks,
  sanitizeForSpreadsheet,
  scoreOpportunities,
  toCsv,
  wordBucket,
  wordCount,
} from "./classify";

describe("wordCount / buckets", () => {
  it("counts words and ignores punctuation tokens", () => {
    expect(wordCount("  best running shoes  ")).toBe(3);
    expect(wordCount("what is - GEO ?")).toBe(3);
    expect(wordCount("")).toBe(0);
  });
  it("buckets word counts", () => {
    expect(wordBucket(1)).toBe("1-2");
    expect(wordBucket(4)).toBe("3-4");
    expect(wordBucket(7)).toBe("5-7");
    expect(wordBucket(12)).toBe("8+");
    expect(matchesWordBucket(5, "5-7")).toBe(true);
    expect(matchesWordBucket(5, null)).toBe(true);
    expect(matchesWordBucket(2, "8+")).toBe(false);
  });
});

describe("isAiPrompt", () => {
  it("flags conversational and long queries (EN)", () => {
    expect(isAiPrompt("how do i choose a balcony solar system")).toBe(true);
    expect(isAiPrompt("what is the best solar battery for a small apartment")).toBe(true);
    expect(isAiPrompt("is a balcony power plant worth it?")).toBe(true);
    expect(isAiPrompt("best running shoes for flat feet")).toBe(true);
    expect(isAiPrompt("anker solix vs ecoflow")).toBe(true);
  });
  it("flags conversational queries (DE)", () => {
    expect(isAiPrompt("wie viel strom erzeugt ein balkonkraftwerk")).toBe(true);
    expect(isAiPrompt("lohnt sich ein balkonkraftwerk mit speicher")).toBe(true);
    expect(isAiPrompt("welches balkonkraftwerk ist das beste")).toBe(true);
    expect(isAiPrompt("beste powerstation für camping")).toBe(true);
  });
  it("does not flag short head terms / brand queries", () => {
    expect(isAiPrompt("solakon")).toBe(false);
    expect(isAiPrompt("balkonkraftwerk")).toBe(false);
    expect(isAiPrompt("running shoes")).toBe(false);
    expect(isAiPrompt("solakon login")).toBe(false);
    expect(isAiPrompt("")).toBe(false);
  });
});

describe("classifyIntent", () => {
  it("detects comparisons", () => {
    expect(classifyIntent("anker solix vs ecoflow")).toBe("comparison");
    expect(classifyIntent("difference between lifepo4 and lithium ion")).toBe("comparison");
    expect(classifyIntent("balkonkraftwerk vergleich")).toBe("comparison");
    expect(classifyIntent("ecoflow oder anker powerstation")).toBe("comparison");
    expect(classifyIntent("alternatives to salesforce")).toBe("comparison");
  });
  it("detects recommendations", () => {
    expect(classifyIntent("best balcony solar system")).toBe("recommend");
    expect(classifyIntent("beste powerstation für camping")).toBe("recommend");
    expect(classifyIntent("balkonkraftwerk testsieger")).toBe("recommend");
    expect(classifyIntent("which inverter should i choose")).toBe("recommend");
  });
  it("detects actions", () => {
    expect(classifyIntent("buy balcony solar panel")).toBe("action");
    expect(classifyIntent("balkonkraftwerk kaufen")).toBe("action");
    expect(classifyIntent("solakon gutschein")).toBe("action");
    expect(classifyIntent("solar installer near me")).toBe("action");
    expect(classifyIntent("balkonkraftwerk preis")).toBe("action");
  });
  it("falls back to information", () => {
    expect(classifyIntent("how does a balcony power plant work")).toBe("information");
    expect(classifyIntent("wie funktioniert ein wechselrichter")).toBe("information");
    expect(classifyIntent("how do i install a balcony solar system")).toBe("information");
    expect(classifyIntent("app download")).toBe("action");
    expect(classifyIntent("solakon")).toBe("information");
  });
});

describe("striking distance", () => {
  it("keeps each query's best page within positions 5–20, sorted by impressions", () => {
    const rows = buildStrikingDistanceRows([
      { query: "a", page: "/1", impressions: 100, clicks: 1, position: 12 },
      { query: "a", page: "/2", impressions: 50, clicks: 1, position: 8 },
      { query: "b", page: "/3", impressions: 500, clicks: 5, position: 3 },
      { query: "c", page: "/4", impressions: 300, clicks: 2, position: 19.5 },
      { query: "d", page: "/5", impressions: 900, clicks: 0, position: 25 },
      { query: "e", page: "/6", impressions: 10, clicks: 0, position: 7 },
      { query: "e", page: "/7", impressions: 20, clicks: 0, position: 7 },
    ]);
    expect(rows.map((r) => [r.query, r.page])).toEqual([
      ["c", "/4"],
      ["a", "/2"],
      ["e", "/7"],
    ]);
  });
});

describe("normalizePageKey", () => {
  it("normalizes URLs per open-seo rules", () => {
    expect(normalizePageKey("https://WWW.Example.com/Blog/Post/?utm=1#x")).toBe("www.example.com/Blog/Post");
    expect(normalizePageKey("http://example.com")).toBe("example.com/");
    expect(normalizePageKey("example.com/a/")).toBe("example.com/a");
    expect(normalizePageKey("https://example.com:8443/a")).toBe("example.com:8443/a");
    expect(normalizePageKey("https://example.com:443/a")).toBe("example.com/a");
    expect(normalizePageKey("(not set)")).toBeNull();
    expect(normalizePageKey("  ")).toBeNull();
  });
});

describe("opportunity scoring", () => {
  it("computes percentile ranks with shared ties", () => {
    expect(percentileRanks([5])).toEqual([1]);
    expect(percentileRanks([1, 2, 3])).toEqual([0, 0.5, 1]);
    expect(percentileRanks([1, 1, 3])).toEqual([0, 0, 1]);
  });
  it("scores 0.5 demand + 0.3 business + 0.2 reachability", () => {
    const { scores, engagementFallback } = scoreOpportunities([
      { impressions: 1000, position: 5, sessionKeyEventRate: 0.1, engagementRate: 0.5, keyEvents: 3 },
      { impressions: 10, position: 18, sessionKeyEventRate: 0, engagementRate: 0.2, keyEvents: 0 },
    ]);
    expect(engagementFallback).toBe(false);
    expect(scores[0]!.score).toBe(100);
    expect(scores[1]!.score).toBe(0);
  });
  it("falls back to engagement rate when no row has key events", () => {
    const { scores, engagementFallback } = scoreOpportunities([
      { impressions: 10, position: 10, sessionKeyEventRate: 0, engagementRate: 0.9, keyEvents: 0 },
      { impressions: 10, position: 10, sessionKeyEventRate: 0, engagementRate: 0.1, keyEvents: 0 },
    ]);
    expect(engagementFallback).toBe(true);
    expect(scores[0]!.components.businessValue).toBe(1);
    expect(scores[1]!.components.businessValue).toBe(0);
  });
});

describe("CSV export", () => {
  it("guards against formula injection", () => {
    expect(sanitizeForSpreadsheet("=HYPERLINK()")).toBe("'=HYPERLINK()");
    expect(sanitizeForSpreadsheet("normal")).toBe("normal");
    expect(toCsv([["q", "a,b"], ["=1+1", 'x"y']])).toBe('q,"a,b"\n\'=1+1,"x""y"');
  });
});
