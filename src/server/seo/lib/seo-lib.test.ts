/**
 * Unit tests for the SEO module's pure DataForSEO request builders and response parsers.
 * Sample payloads mirror the DataForSEO v3 docs and open-seo's own test fixtures.
 */
import { describe, expect, it } from "vitest";
import {
  getKeywordDataProvider,
  getIsoCountryCode,
  getLanguageOptions,
  projectMarket,
  resolveKeywordDataLanguage,
  resolveLabsMarket,
  resolveMarket,
  formatLocationLabel,
} from "./locations";
import { parseResearchTarget, RESEARCH_SCOPES, RESEARCH_SCOPE_FILTER_SLOTS, toScopeSearchParam, urlMatchesResearchTarget } from "./research-scope";
import {
  buildBacklinksScopeFilter,
  buildIncludeOrGroup,
  buildRankedKeywordsScopeFilter,
  buildRelevantPagesScopeFilter,
  countExpressionConditions,
  prependScopeClauses,
} from "./filters";
import {
  applyKeywordFiltersAndSort,
  buildAdsIdeasRequest,
  buildAdsSearchVolumeRequest,
  buildKeywordOverviewRequest,
  buildResearchSourceRequest,
  EMPTY_KEYWORD_FILTERS,
  mapAdsKeywordItems,
  mapKeywordDataItems,
  mapRelatedKeywordItems,
  mergeLocalAndNationalRows,
  normalizeIntent,
  normalizeKeywordOverview,
  parseKeywordInput,
  scoreTier,
} from "./keywords";
import { buildRankCheckResult, buildRankCheckTask, buildRankCheckTaskPostBody, buildSerpAnalysisTask, mapOrganicSerpItems } from "./serp";
import {
  classifyMovement,
  changeCell,
  computeNextCheckAt,
  computeScorecards,
  estimateRankCheckCost,
  estimateScheduledRankCheckCost,
  normalizeTrackedKeywords,
  normalizeTrackerDomain,
} from "./rank-tracking";
import { buildKeywordFilters, buildKeywordsOrderBy, buildPageFilters, computeHasMore, mapDomainOverview, mapRankedKeywordItem, mapRelevantPageItem } from "./domain";
import {
  backlinksFilterBudget,
  buildBacklinksDateRange,
  buildBacklinksRowsApiFilters,
  buildCommonBacklinksPayload,
  buildOverviewResult,
  combineFilters,
  mapBacklinksRows,
  normalizeBacklinksTarget,
  normalizeSpamOptions,
} from "./backlinks";
import {
  buildBusinessSearchTask,
  buildLocalSerpRequest,
  buildRankGridPoints,
  buildReviewsTaskPost,
  businessIdentifierKeyword,
  combinedQuestionItems,
  formatBusinessDataCoordinate,
  matchGridItem,
  rankGridZoom,
  resolveBusinessIdentifier,
  summarizeGrid,
} from "./local";
import { rankSerpLocations, slimLocationRegistry } from "./serp-locations";
import { normalizeTags, resolveTagColor, TAG_COLOR_KEYS } from "./tags";
import { buildCsv, sanitizeCell } from "./csv";

function target(input: string, scope?: (typeof RESEARCH_SCOPES)[number]) {
  const p = parseResearchTarget(input, scope);
  if (!p.ok) throw new Error(p.message);
  return p.target;
}

describe("locations", () => {
  it("routes Ads-only countries to google_ads and unknown codes to labs", () => {
    expect(getKeywordDataProvider(2352)).toBe("google_ads"); // Iceland
    expect(getKeywordDataProvider(2276)).toBe("labs"); // Germany
    expect(getKeywordDataProvider(99999)).toBe("labs");
  });
  it("resolves markets like open-seo", () => {
    expect(resolveMarket({}, { locationCode: 2276, languageCode: "de" })).toEqual({ locationCode: 2276, languageCode: "de" });
    // Overriding only the location snaps to its default language.
    expect(resolveMarket({ locationCode: 2250 }, { locationCode: 2276, languageCode: "de" })).toEqual({ locationCode: 2250, languageCode: "fr" });
    // Labs tools fall back to US/en for an unserved project market.
    expect(resolveLabsMarket({}, { locationCode: 2352, languageCode: "is" })).toEqual({ locationCode: 2840, languageCode: "en" });
    expect(projectMarket({ country: "DE", language: "de" })).toEqual({ locationCode: 2276, languageCode: "de" });
    expect(projectMarket({ country: "GB", language: "en" })).toEqual({ locationCode: 2826, languageCode: "en" });
  });
  it("lists multi-language options and falls back for keyword data", () => {
    expect(getLanguageOptions(2756).map((l) => l.code).sort()).toEqual(["de", "fr", "it"]);
    expect(resolveKeywordDataLanguage(2276, "en")).toBe("de");
    expect(resolveKeywordDataLanguage(2840, "es")).toBe("es");
    expect(getIsoCountryCode(2826)).toBe("gb");
    expect(formatLocationLabel("Portland-Auburn, ME,United States", 2)).toBe("Portland-Auburn, ME");
  });
});

describe("research scope", () => {
  it("parses targets and default scopes", () => {
    expect(target("https://www.Example.com/")).toMatchObject({ hostname: "example.com", path: "", scope: "subdomains", display: "example.com" });
    expect(target("example.com/Blog/")).toMatchObject({ path: "/Blog", scope: "subfolder", display: "example.com/Blog" });
    expect(parseResearchTarget("example.com", "subfolder")).toEqual({ ok: false, message: "Add a path to use Subfolder (e.g. example.com/blog)" });
    expect(parseResearchTarget("localhost").ok).toBe(false);
    expect(parseResearchTarget("my_site.com").ok).toBe(false);
    expect(parseResearchTarget("192.168.1.1").ok).toBe(false);
    expect(parseResearchTarget("user:pw@example.com").ok).toBe(false);
    expect(toScopeSearchParam("example.com", "subdomains")).toBeUndefined();
    expect(toScopeSearchParam("example.com", "domain")).toBe("domain");
  });
  it("post-filters urls (subfolder excludes siblings)", () => {
    const t = target("example.com/blog", "subfolder");
    expect(urlMatchesResearchTarget("https://www.example.com/blog/post", t)).toBe(true);
    expect(urlMatchesResearchTarget("https://example.com/blogging", t)).toBe(false);
  });
  it("scope filter condition counts match RESEARCH_SCOPE_FILTER_SLOTS", () => {
    for (const scope of RESEARCH_SCOPES) {
      const t = target(scope === "subfolder" || scope === "exact_url" ? "example.com/blog" : "example.com", scope);
      expect(buildRankedKeywordsScopeFilter(t).conditionCount).toBe(RESEARCH_SCOPE_FILTER_SLOTS.keywords[scope]);
      expect(buildRelevantPagesScopeFilter(t).conditionCount).toBe(RESEARCH_SCOPE_FILTER_SLOTS.pages[scope]);
    }
  });
  it("builds ranked-keywords subfolder filters with escaping", () => {
    const f = buildRankedKeywordsScopeFilter(target("example.com/100%25_deals", "subfolder"));
    expect(f.clauses[0]).toEqual(["ranked_serp_element.serp_item.domain", "in", ["example.com", "www.example.com"]]);
    expect(f.clauses[1]).toEqual([
      ["ranked_serp_element.serp_item.relative_url", "=", "/100%25_deals"],
      "or",
      ["ranked_serp_element.serp_item.relative_url", "like", "/100\\%25\\_deals/%"],
      "or",
      ["ranked_serp_element.serp_item.relative_url", "like", "/100\\%25\\_deals?%"],
    ]);
  });
  it("backlinks subfolder scope uses 4 like patterns and prepends with AND", () => {
    const f = buildBacklinksScopeFilter("url_to", { scope: "subfolder", apiTarget: "example.com", path: "/blog" });
    expect(f.conditionCount).toBe(4);
    const joined = prependScopeClauses(f, [["dofollow", "=", true]]);
    expect(joined[1]).toBe("and");
    expect(joined[2]).toEqual(["dofollow", "=", true]);
    expect(countExpressionConditions(joined)).toBe(5);
  });
  it("include terms become an OR group", () => {
    expect(buildIncludeOrGroup("url_from", "blog, forum")).toEqual({
      clause: [["url_from", "ilike", "%blog%"], "or", ["url_from", "ilike", "%forum%"]],
      conditionCount: 2,
    });
    expect(buildIncludeOrGroup("url_from", "")).toBeNull();
  });
});

describe("keyword research payloads + mappers", () => {
  it("builds exact Labs payloads", () => {
    const base = { keyword: "solar panel", locationCode: 2276, languageCode: "de", limit: 150 };
    expect(buildResearchSourceRequest("related", base)).toEqual({
      path: "/v3/dataforseo_labs/google/related_keywords/live",
      task: { keyword: "solar panel", location_code: 2276, language_code: "de", limit: 150, depth: 3, include_clickstream_data: false, include_serp_info: false },
    });
    expect(buildResearchSourceRequest("suggestions", { ...base, includeClickstreamData: true }).task).toEqual({
      keyword: "solar panel",
      location_code: 2276,
      language_code: "de",
      limit: 150,
      include_clickstream_data: true,
      include_serp_info: false,
      include_seed_keyword: true,
      ignore_synonyms: false,
      exact_match: false,
    });
    expect(buildResearchSourceRequest("ideas", base).task).toMatchObject({ keywords: ["solar panel"], closely_variants: false, ignore_synonyms: false });
    expect(buildAdsIdeasRequest({ keyword: "x", locationCode: 2352, languageCode: "is" }).task).toEqual({
      keywords: ["x"],
      location_code: 2352,
      language_code: "is",
      sort_by: "search_volume",
    });
    expect(buildKeywordOverviewRequest({ keywords: ["a"], locationCode: 2840, languageCode: "en" }).task).toEqual({
      keywords: ["a"],
      location_code: 2840,
      language_code: "en",
      include_clickstream_data: false,
    });
    expect(buildAdsSearchVolumeRequest({ keywords: ["a"], locationCode: 2840, languageCode: "en", locationName: "Enid,Oklahoma,United States" }).task).toEqual({
      keywords: ["a"],
      location_name: "Enid,Oklahoma,United States",
      language_code: "en",
    });
  });

  it("maps Labs items (prefers clickstream block, dedupes, normalizes intent)", () => {
    const rows = mapKeywordDataItems([
      {
        keyword: "Solar Panel",
        keyword_info: { search_volume: 1000, cpc: 1.23, competition: 0.4, monthly_searches: [{ year: 2026, month: 8, search_volume: 900 }] },
        keyword_info_normalized_with_clickstream: { search_volume: 800, monthly_searches: [{ year: 2026, month: 8, search_volume: 700 }] },
        keyword_properties: { keyword_difficulty: 42 },
        search_intent_info: { main_intent: "commercial" },
      },
      { keyword: "solar panel" },
      { keyword: null },
    ]);
    expect(rows).toEqual([
      {
        keyword: "solar panel",
        searchVolume: 800,
        trend: [{ year: 2026, month: 8, searchVolume: 700 }],
        cpc: 1.23,
        competition: 0.4,
        keywordDifficulty: 42,
        intent: "commercial",
      },
    ]);
    const related = mapRelatedKeywordItems([{ keyword_data: { keyword: "balkonkraftwerk", keyword_info: { search_volume: 5 } } }]);
    expect(related[0]).toMatchObject({ keyword: "balkonkraftwerk", searchVolume: 5, intent: "unknown" });
  });

  it("maps Google Ads items (competition_index / 100, no KD/intent)", () => {
    expect(mapAdsKeywordItems([{ keyword: "Hotel", search_volume: 50, cpc: 2, competition: "HIGH", competition_index: 87 }])).toEqual([
      { keyword: "hotel", searchVolume: 50, trend: [], cpc: 2, competition: 0.87, keywordDifficulty: null, intent: "unknown" },
    ]);
  });

  it("normalizes metrics and merges local Ads volume with national Labs KD", () => {
    expect(normalizeKeywordOverview({ keyword: "a", keyword_info: { search_volume: 10, competition_level: "LOW" }, keyword_properties: { keyword_difficulty: 5 } }, "a")).toMatchObject({
      searchVolume: 10,
      competitionLevel: "LOW",
      keywordDifficulty: 5,
    });
    const merged = mergeLocalAndNationalRows(
      ["pizza", "pizza near me"],
      [{ keyword: "pizza", search_volume: 90, cpc: 1, competition_index: 50 }],
      [
        { keyword: "pizza", keyword_properties: { keyword_difficulty: 30 }, search_intent_info: { main_intent: "transactional" } },
        { keyword: "pizza near me", keyword_properties: { keyword_difficulty: 20 } },
      ],
    );
    expect(merged).toEqual([
      expect.objectContaining({ keyword: "pizza", searchVolume: 90, competition: 0.5, keywordDifficulty: 30, intent: "transactional" }),
      expect.objectContaining({ keyword: "pizza near me", searchVolume: null, cpc: null, keywordDifficulty: 20 }),
    ]);
  });

  it("intent / input / tiers", () => {
    expect(normalizeIntent("Informational")).toBe("informational");
    expect(normalizeIntent("navigation")).toBe("navigational");
    expect(normalizeIntent(null)).toBe("unknown");
    expect(parseKeywordInput("a, b\n c\n\n")).toEqual(["a", "b", "c"]);
    expect([null, 20, 21, 35, 50, 65, 80, 81].map(scoreTier)).toEqual([0, 1, 2, 2, 3, 4, 5, 6]);
  });

  it("client-side filters: include=ALL, exclude=ANY, nulls count as 0, sort null → -1", () => {
    const rows = [
      { keyword: "seo audit tool", searchVolume: 100, trend: [], cpc: 2, competition: 0.1, keywordDifficulty: 30, intent: "commercial" as const },
      { keyword: "seo audit jobs", searchVolume: 500, trend: [], cpc: null, competition: null, keywordDifficulty: null, intent: "unknown" as const },
      { keyword: "seo checker", searchVolume: null, trend: [], cpc: 1, competition: 0.2, keywordDifficulty: 10, intent: "informational" as const },
    ];
    const f = { ...EMPTY_KEYWORD_FILTERS, include: "seo, audit", exclude: "jobs" };
    expect(applyKeywordFiltersAndSort(rows, f, "searchVolume", "desc").map((r) => r.keyword)).toEqual(["seo audit tool"]);
    expect(applyKeywordFiltersAndSort(rows, { ...EMPTY_KEYWORD_FILTERS, maxKd: "15" }, "keyword", "asc").map((r) => r.keyword)).toEqual([
      "seo audit jobs",
      "seo checker",
    ]);
    expect(applyKeywordFiltersAndSort(rows, EMPTY_KEYWORD_FILTERS, "searchVolume", "desc").map((r) => r.keyword)).toEqual([
      "seo audit jobs",
      "seo audit tool",
      "seo checker",
    ]);
    expect(applyKeywordFiltersAndSort(rows, { ...EMPTY_KEYWORD_FILTERS, intents: "informational" }, "keyword", "asc")).toHaveLength(1);
  });
});

describe("SERP + rank checks", () => {
  it("builds analysis + rank check payloads (stop_crawl_on_match, os per device, clamped depth)", () => {
    expect(buildSerpAnalysisTask({ keyword: "k", locationCode: 2840, languageCode: "en", depth: 5 })).toEqual({
      keyword: "k",
      location_code: 2840,
      language_code: "en",
      device: "desktop",
      os: "windows",
      depth: 10,
    });
    expect(
      buildRankCheckTask({ keyword: "k", locationCode: 2840, languageCode: "en", locationName: "Enid,Oklahoma,United States", device: "mobile", targetDomain: "example.com", depth: 40 }),
    ).toEqual({
      keyword: "k",
      location_name: "Enid,Oklahoma,United States",
      language_code: "en",
      device: "mobile",
      os: "android",
      depth: 40,
      stop_crawl_on_match: [{ match_value: "example.com", match_type: "with_subdomains" }],
      find_targets_in: ["organic"],
    });
    const body = buildRankCheckTaskPostBody({
      tasks: [
        { keyword: "alpha", keywordId: "kw-1", device: "desktop" },
        { keyword: "alpha", keywordId: "kw-1", device: "mobile" },
      ],
      locationCode: 2840,
      languageCode: "en",
      depth: 20,
      targetDomain: "example.com",
    });
    expect(body.map((t) => t.tag)).toEqual(["kw-1:desktop", "kw-1:mobile"]);
    expect(body[0]).toMatchObject({ location_code: 2840, os: "windows" });
    expect(() => buildRankCheckTaskPostBody({ tasks: [], locationCode: 1, languageCode: "en", depth: 10, targetDomain: "x.com" })).toThrow();
  });

  it("matches the first organic result of the domain or a subdomain, using rank_group", () => {
    const items = [
      { type: "featured_snippet", domain: "example.com", rank_group: 1, rank_absolute: 1 },
      { type: "organic", domain: "other.com", rank_group: 1, rank_absolute: 2 },
      { type: "people_also_ask", rank_absolute: 3 },
      { type: "organic", domain: "blog.example.com", rank_group: 2, rank_absolute: 5, url: "https://blog.example.com/x" },
    ];
    expect(buildRankCheckResult({ keywordId: "k1", keyword: "kw", targetDomain: "Example.com" }, items)).toEqual({
      keywordId: "k1",
      keyword: "kw",
      position: 2,
      url: "https://blog.example.com/x",
      serpFeatures: ["featured_snippet", "organic", "people_also_ask"],
    });
    expect(buildRankCheckResult({ keywordId: "k1", keyword: "kw", targetDomain: "notexample.com" }, items).position).toBeNull();
  });

  it("maps organic SERP items only", () => {
    const rows = mapOrganicSerpItems([
      { type: "paid", title: "ad" },
      { type: "organic", rank_group: 1, title: "T", url: "https://a.com", domain: "a.com", etv: 12, backlinks_info: { referring_domains: 3, backlinks: 9 } },
    ]);
    expect(rows).toEqual([
      { rank: 1, title: "T", url: "https://a.com", domain: "a.com", description: "", etv: 12, estimatedPaidTrafficCost: null, referringDomains: 3, backlinks: 9, isNew: false, rankChange: null },
    ]);
  });

  it("estimates rank-check costs per metered call", () => {
    // live: 1 keyword × 2 devices × (0.002 + 3 × 0.0015) at depth 40
    expect(estimateRankCheckCost(1, "both", 40, "live")).toEqual({ costUsd: 0.013, totalChecks: 2 });
    // queued: 150 checks at depth 10 = 100 + 50 per task_post × 0.0006
    expect(estimateRankCheckCost(150, "desktop", 10, "queued").costUsd).toBeCloseTo(0.09, 5);
    expect(estimateScheduledRankCheckCost(50, "mobile", 10, "weekly")).toMatchObject({ checksPerMonth: 4, costUsd: 0.03, monthlyCostUsd: 0.12 });
  });

  it("advances schedules on a fixed anchor without drift", () => {
    const anchor = new Date("2026-01-05T06:30:00Z");
    const now = new Date("2026-01-14T00:00:00Z").getTime();
    expect(computeNextCheckAt("weekly", anchor, now).toISOString()).toBe("2026-01-19T06:30:00.000Z");
    expect(computeNextCheckAt("daily", anchor, now).toISOString()).toBe("2026-01-14T06:30:00.000Z");
    expect(computeNextCheckAt("monthly", new Date("2026-01-31T05:00:00Z"), new Date("2026-02-10T00:00:00Z").getTime()).toISOString()).toBe(
      "2026-02-28T05:00:00.000Z",
    );
    const fresh = computeNextCheckAt("daily", null, new Date("2026-03-01T12:00:00Z").getTime(), () => 0);
    expect(fresh.toISOString()).toBe("2026-03-02T04:00:00.000Z");
  });

  it("computes scorecards (visibility CTR model, 4-case movement)", () => {
    const s = computeScorecards([
      { searchVolume: 100, position: 1, previousPosition: 3 },
      { searchVolume: 100, position: null, previousPosition: 5 },
      { searchVolume: 0, position: 8, previousPosition: null },
    ]);
    expect(s.visibility).toBeCloseTo(50, 5); // (100×0.28 + 0) / (200 × 0.28)
    expect(s.visibilityDelta).toBeCloseTo(50 - ((100 * 0.1 + 100 * 0.05) / (200 * 0.28)) * 100, 5);
    expect(s).toMatchObject({ ranking: 2, rankingDelta: 0, top3: 1, top10: 2, improved: 2, declined: 1 });
    expect(classifyMovement(null, null)).toBe("none");
    expect(changeCell(3, 7)).toBe(4);
    expect(changeCell(null, 7)).toBe("lost");
    expect(changeCell(4, null)).toBe("new");
  });

  it("normalizes tracked keywords and domains", () => {
    expect(normalizeTrackedKeywords([" SEO ", "seo", "Nodex", "a"], ["a"], false, 10)).toEqual(["seo", "nodex"]);
    expect(normalizeTrackedKeywords(["Nodex", "nodex"], [], true, 1)).toEqual(["Nodex"]);
    expect(normalizeTrackerDomain("https://www.Example.com/path?x#y")).toBe("example.com");
  });
});

describe("domain overview", () => {
  it("builds keyword filters in open-seo order and enforces the 8-condition budget", () => {
    const scope = buildRankedKeywordsScopeFilter(target("example.com", "domain"));
    expect(buildKeywordFilters({ include: "seo", minVol: 10, maxKd: 50 }, undefined, scope)).toEqual([
      ["ranked_serp_element.serp_item.domain", "in", ["example.com", "www.example.com"]],
      "and",
      ["keyword_data.keyword", "ilike", "%seo%"],
      "and",
      ["keyword_data.keyword_info.search_volume", ">=", 10],
      "and",
      ["keyword_data.keyword_properties.keyword_difficulty", "<=", 50],
    ]);
    expect(() => buildKeywordFilters({ include: "a,b,c,d,e,f,g,h,i" })).toThrow(/Too many filter conditions \(9 of 8 max\)/);
    expect(buildKeywordsOrderBy("rank", "asc")).toEqual(["ranked_serp_element.serp_item.rank_absolute,asc"]);
    expect(buildPageFilters({ exclude: "blog", minVol: 5 }, "pricing", { clauses: [], conditionCount: 0 })).toEqual([
      ["page_address", "not_ilike", "%blog%"],
      "and",
      ["metrics.organic.count", ">=", 5],
      "and",
      ["page_address", "ilike", "%pricing%"],
    ]);
  });
  it("maps Labs responses", () => {
    expect(mapDomainOverview("example.com", [{ metrics: { organic: { etv: 1234.6, count: 88.2 } } }], new Date("2026-01-01T00:00:00Z"))).toMatchObject({
      organicTraffic: 1235,
      organicKeywords: 88,
      hasData: true,
    });
    expect(mapDomainOverview("x.com", []).hasData).toBe(false);
    expect(
      mapRankedKeywordItem({
        keyword_data: { keyword: "seo tool", keyword_info: { search_volume: 1000.4, cpc: 3.1, keyword_difficulty: 12 }, keyword_properties: { keyword_difficulty: null } },
        ranked_serp_element: { serp_item: { url: "https://example.com/tools?x=1", rank_absolute: 3.2, etv: 55.5 } },
      }),
    ).toEqual({ keyword: "seo tool", position: 3, searchVolume: 1000, traffic: 55.5, cpc: 3.1, url: "https://example.com/tools?x=1", relativeUrl: "/tools?x=1", keywordDifficulty: 12 });
    expect(mapRelevantPageItem({ page_address: "https://example.com/a", metrics: { organic: { etv: 10.4, count: 3 } } })).toEqual({
      page: "https://example.com/a",
      relativePath: "/a",
      organicTraffic: 10,
      keywords: 3,
    });
    expect(computeHasMore(0, 100, 250, 100)).toBe(true);
    expect(computeHasMore(200, 50, 250, 100)).toBe(false);
    expect(computeHasMore(0, 100, null, 100)).toBe(true);
  });
});

describe("backlinks", () => {
  it("normalizes targets per scope", () => {
    expect(normalizeBacklinksTarget("www.example.com")).toEqual({ apiTarget: "example.com", displayTarget: "example.com", scope: "subdomains", includeSubdomains: true, path: "" });
    expect(normalizeBacklinksTarget("example.com", "domain").includeSubdomains).toBe(false);
    expect(normalizeBacklinksTarget("example.com/blog")).toMatchObject({ apiTarget: "example.com", scope: "subfolder", path: "/blog", displayTarget: "example.com/blog" });
    expect(normalizeBacklinksTarget("http://www.example.com/page", "page")).toMatchObject({ apiTarget: "http://www.example.com/page", scope: "exact_url" });
    expect(() => normalizeBacklinksTarget("example.com/p?x=1", "exact_url")).toThrow(/query strings/);
  });
  it("builds common payload + filters (include OR group first; spam condition appended)", () => {
    expect(buildCommonBacklinksPayload({ target: "example.com", includeSubdomains: false })).toEqual({
      target: "example.com",
      include_subdomains: false,
      include_indirect_links: true,
      exclude_internal_backlinks: true,
      backlinks_status_type: "live",
      rank_scale: "one_hundred",
    });
    const f = buildBacklinksRowsApiFilters({ include: "blog,news", exclude: "spam", minDomainRank: 10, linkType: "nofollow", hideLost: true });
    expect(f).toEqual([
      [["url_from", "ilike", "%blog%"], "or", ["url_from", "ilike", "%news%"]],
      "and",
      ["url_from", "not_ilike", "%spam%"],
      "and",
      ["domain_from_rank", ">=", 10],
      "and",
      ["dofollow", "=", false],
      "and",
      ["is_lost", "=", false],
    ]);
    expect(combineFilters(f, ["backlink_spam_score", "<=", 40])?.slice(-2)).toEqual(["and", ["backlink_spam_score", "<=", 40]]);
    expect(combineFilters(undefined, undefined)).toBeUndefined();
    expect(normalizeSpamOptions()).toEqual({ hideSpam: true, spamThreshold: 40 });
    expect(normalizeSpamOptions({ hideSpam: true, spamThreshold: 400 }).spamThreshold).toBe(100);
    expect(backlinksFilterBudget("subfolder", "backlinks")).toBe(3);
    expect(backlinksFilterBudget("subfolder", "pages")).toBe(4);
    expect(backlinksFilterBudget("domain", "domains")).toBe(8);
  });
  it("maps rows and overview (accepts misspelled reffering keys)", () => {
    expect(
      mapBacklinksRows([{ domain_from: "a.com", attributes: ["nofollow"], backlinks_spam_score: 12, lost_date: "2026-01-01", dofollow: false }])[0],
    ).toMatchObject({ domainFrom: "a.com", relAttributes: ["nofollow"], spamScore: 12, lastSeen: "2026-01-01", isLost: true, isBroken: false, isDofollow: false });
    const o = buildOverviewResult({
      target: normalizeBacklinksTarget("example.com"),
      now: new Date("2026-02-01T00:00:00Z"),
      summary: { rank: 50, backlinks: 100, new_reffering_domains: 3, lost_referring_domains: 1, info: { target_spam_score: 4 } },
      history: [{ date: "2026-01-01 00:00:00 +00:00", backlinks: 90, referring_domains: 9, new_backlinks: 2 }, { date: null }],
    });
    expect(o.summary).toMatchObject({ rank: 50, newReferringDomains: 3, lostReferringDomains: 1, targetSpamScore: 4 });
    expect(o.trends).toEqual([{ date: "2026-01-01", backlinks: 90, referringDomains: 9, rank: null }]);
    expect(buildBacklinksDateRange(new Date("2026-03-15T12:00:00Z"))).toEqual({ dateFrom: "2025-03-14", dateTo: "2026-03-14" });
  });
});

describe("local SEO", () => {
  it("formats coordinates and business payloads", () => {
    expect(formatBusinessDataCoordinate({ latitude: 52.52, longitude: 13.405 })).toBe("52.52,13.405,10000");
    expect(formatBusinessDataCoordinate({ latitude: 1, longitude: 2, radiusKm: 0.05 })).toBe("1,2,200");
    expect(buildBusinessSearchTask({ query: "pizza", near: { latitude: 52.5, longitude: 13.4, radiusKm: 5 }, minRating: 4, minReviews: 10, sortBy: "rating" })).toEqual({
      categories: undefined,
      title: "pizza",
      location_coordinate: "52.5,13.4,5",
      is_claimed: undefined,
      filters: [["rating.value", ">=", 4], "and", ["rating.votes_count", ">=", 10]],
      order_by: ["rating.value,desc"],
      limit: 20,
      offset: 0,
    });
    expect(buildLocalSerpRequest({ keyword: "pizza", latitude: 1, longitude: 2, zoom: 14, searchType: "maps", device: "mobile", depth: 20, languageCode: "en" })).toEqual({
      path: "/v3/serp/google/maps/live/advanced",
      task: { keyword: "pizza", location_coordinate: "1,2,14z", language_code: "en", device: "mobile", os: "android", depth: 20, search_places: false },
    });
    expect(buildLocalSerpRequest({ keyword: "p", latitude: 1, longitude: 2, searchType: "local_finder", device: "desktop", depth: 20, languageCode: "en" }).path).toBe(
      "/v3/serp/google/local_finder/live/advanced",
    );
    expect(buildReviewsTaskPost({ cid: "123", locationCode: 2276, languageCode: "de", depth: 20, sortBy: "newest", includeOtherSources: false })).toEqual({
      endpoint: "reviews",
      task: { keyword: undefined, cid: "123", place_id: undefined, location_code: 2276, language_code: "de", depth: 20, priority: 2, sort_by: "newest" },
    });
    expect(buildReviewsTaskPost({ keyword: "x", locationCode: 2276, languageCode: "de", depth: 20, includeOtherSources: true }).endpoint).toBe("extended_reviews");
    expect(businessIdentifierKeyword(resolveBusinessIdentifier({ placeId: "ChIJ" }))).toBe("place_id:ChIJ");
    expect(() => resolveBusinessIdentifier({ businessName: "a", cid: "b" })).toThrow();
  });
  it("builds the rank grid (row 0 = north) with derived zoom and summary", () => {
    const pts = buildRankGridPoints({ latitude: 0, longitude: 0 }, 3, 2);
    expect(pts).toHaveLength(9);
    expect(pts[0]).toEqual({ row: 0, col: 0, latitude: Number((2 / 110.574).toFixed(7)), longitude: Number((-2 / 111.32).toFixed(7)) });
    expect(pts[4]).toEqual({ row: 1, col: 1, latitude: 0, longitude: 0 });
    expect(rankGridZoom(2, 0)).toBe(13);
    // cos floored at 0.01 near the pole: floor(log2(24045 × 0.01 / 0.25)) = 9
    expect(rankGridZoom(0.25, 89.99)).toBe(9);
    expect(rankGridZoom(10, 52.5)).toBe(10);
    const item = matchGridItem([{ title: "Joe's Pizza", cid: "1" }, { title: "Other", cid: "2", place_id: "p2" }], { placeId: "p2" });
    expect(item).toMatchObject({ cid: "2" });
    expect(matchGridItem([{ title: "Joe's Pizza Berlin" }], { name: "joe's pizza" })).toBeTruthy();
    expect(summarizeGrid([{ row: 0, col: 0, latitude: 0, longitude: 0, rank: 2 }, { row: 0, col: 1, latitude: 0, longitude: 0, rank: 11 }, { row: 0, col: 2, latitude: 0, longitude: 0, rank: null }])).toEqual({
      pointsSearched: 3,
      pointsFound: 2,
      averageRank: 6.5,
      top3Count: 1,
      top10Count: 1,
    });
    expect(combinedQuestionItems([{ items: [{ question_id: "a" }], items_without_answers: [{ question_id: "b" }] }]).map((q) => q.question_id)).toEqual(["a", "b"]);
  });
});

describe("SERP location search", () => {
  const registry = slimLocationRegistry([
    { location_code: 1, location_name: "Portland,Oregon,United States", location_type: "City" },
    { location_code: 2, location_name: "Portland,Maine,United States", location_type: "City" },
    { location_code: 3, location_name: "Portland-Auburn, ME,United States", location_type: "DMA Region" },
    { location_code: 4, location_name: "Oregon,United States", location_type: "State" },
    { location_code: 5, location_name: "South Portland,Maine,United States", location_type: "City" },
    { location_code: 6, location_name: "München,Bavaria,Germany", location_type: "City" },
  ]);
  it("keeps only targetable types", () => {
    expect(registry.map((r) => r.locationCode)).toEqual([1, 2, 3, 5, 6]);
    expect(registry[2]!.displayLabel).toBe("Portland-Auburn, ME, United States");
  });
  it("ranks exact place matches first and expands state abbreviations after the first token", () => {
    expect(rankSerpLocations("Portland OR", registry, "us").map((r) => r.locationCode)).toEqual([1]);
    expect(rankSerpLocations("portland", registry, "us").map((r) => r.locationCode)).toEqual([2, 1, 3, 5]);
    expect(rankSerpLocations("munchen", registry, "de").map((r) => r.locationCode)).toEqual([6]);
  });
});

describe("tags + csv", () => {
  it("normalizes tags and resolves deterministic colours", () => {
    expect(normalizeTags(["  Blog  Ideas ", "blog ideas", ""])).toEqual([{ name: "Blog Ideas", normalizedName: "blog ideas" }]);
    expect(TAG_COLOR_KEYS).toContain(resolveTagColor({ id: "skt_abc" }));
    expect(resolveTagColor({ id: "x", color: "rose" })).toBe("rose");
  });
  it("guards CSV injection and quotes every field", () => {
    expect(sanitizeCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(sanitizeCell(1.23456)).toBe("1.23");
    expect(buildCsv(["Keyword", "Volume"], [['say "hi"', 10]])).toBe('"Keyword","Volume"\n"say ""hi""","10"');
  });
});
