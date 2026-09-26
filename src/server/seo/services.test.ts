/**
 * Service-level tests with a stubbed DataForSEO HTTP API (fetch) and mocked settings/DB: verifies the exact
 * request paths + payloads the services send and how they orchestrate/parse the responses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/settings", () => ({
  getSetting: async (key: string) => {
    if (key === "dataforseo") return { login: "user@example.com", password: "secret", sandbox: false, defaultLocationCode: 2276, defaultLanguageCode: "de" };
    if (key === "limits") return { dailyBudgetUsd: 0, monthlyBudgetUsd: 0 };
    return {};
  },
}));

/** Chainable no-op DB: every builder call returns the proxy; awaiting it resolves to []. */
vi.mock("@/server/db/client", () => {
  const make = (): unknown =>
    new Proxy(function () {}, {
      get: (_t, prop) => (prop === "then" ? (resolve: (v: unknown) => void) => resolve([]) : make()),
      apply: () => make(),
    });
  return { db: make(), rawSql: make() };
});

import { researchKeywords, getSerpAnalysis, fetchKeywordMetricsForList } from "./keywords";
import { getDomainKeywordsPage, getDomainOverview } from "./domain";
import { getBacklinksOverview, getBacklinksRows } from "./backlinks";
import type { SeoContext } from "./context";

const ctx: SeoContext = {
  projectId: "prj_test",
  workspaceId: "wsp_test",
  userId: "usr_test",
  project: { name: "Test", domain: "example.com", country: "DE", language: "de" },
  market: { locationCode: 2276, languageCode: "de" },
  canRun: true,
};

type Call = { url: string; body: unknown };
let calls: Call[] = [];
let responder: (url: string, body: unknown) => Response;

function envelope(task: Record<string, unknown>) {
  return Response.json({ status_code: 20000, status_message: "Ok.", cost: task.cost ?? 0.01, tasks_count: 1, tasks_error: 0, tasks: [{ id: "t1", status_code: 20000, status_message: "Ok.", cost: 0.01, path: [], ...task }] });
}

function labsItems(keywords: string[]) {
  return keywords.map((k, i) => ({
    keyword: k,
    keyword_info: { search_volume: 1000 - i, cpc: 1.5, competition: 0.3, monthly_searches: [{ year: 2026, month: 8, search_volume: 900 }] },
    keyword_properties: { keyword_difficulty: 20 + i },
    search_intent_info: { main_intent: "commercial" },
  }));
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, body });
      return responder(url, body);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("researchKeywords", () => {
  it("auto mode: related → suggestions, stops at ≥5 non-seed rows, Basic auth", async () => {
    responder = (url) => {
      if (url.endsWith("/related_keywords/live")) return envelope({ result: [{ items: labsItems(["solar", "solar panel"]).map((k) => ({ keyword_data: k })) }] });
      if (url.endsWith("/keyword_suggestions/live")) return envelope({ result: [{ items: labsItems(["solar", "solar 1", "solar 2", "solar 3", "solar 4", "solar 5"]) }] });
      throw new Error(`unexpected ${url}`);
    };
    const res = await researchKeywords(ctx, { keywords: ["Solar", "solar"], resultLimit: 150 });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live",
      "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live",
    ]);
    expect(calls[0]!.body).toEqual([
      { keyword: "solar", location_code: 2276, language_code: "de", limit: 150, depth: 3, include_clickstream_data: false, include_serp_info: false },
    ]);
    expect(res.source).toBe("suggestions");
    expect(res.usedFallback).toBe(true);
    expect(res.rows.map((r) => r.keyword)).toEqual(["solar", "solar panel", "solar 1", "solar 2", "solar 3", "solar 4", "solar 5"]);
    expect(res.diagnostics.sourceAttempts).toEqual([
      { source: "related", rowCount: 2, nonSeedCount: 1 },
      { source: "suggestions", rowCount: 6, nonSeedCount: 5 },
    ]);
    const init = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("user@example.com:secret").toString("base64")}`);
  });

  it("routes Google-Ads-only countries to keywords_for_keywords and truncates to the limit", async () => {
    responder = () =>
      envelope({ result: Array.from({ length: 200 }, (_, i) => ({ keyword: `hotel ${i}`, search_volume: 10, cpc: 1, competition_index: 40 })) });
    const res = await researchKeywords(ctx, { keywords: ["hotel"], locationCode: 2352, mode: "ideas", clickstream: true, resultLimit: 150 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live");
    expect(calls[0]!.body).toEqual([{ keywords: ["hotel"], location_code: 2352, language_code: "is", sort_by: "search_volume" }]);
    expect(res.source).toBe("google_ads");
    expect(res.rows).toHaveLength(150);
    expect(res.rows[0]).toMatchObject({ competition: 0.4, keywordDifficulty: null, intent: "unknown" });
  });

  it("refuses a paid call without seo.run", async () => {
    responder = () => envelope({ result: [] });
    await expect(researchKeywords({ ...ctx, canRun: false }, { keywords: ["x"] })).rejects.toThrow(/permission/);
    expect(calls).toHaveLength(0);
  });
});

describe("getSerpAnalysis", () => {
  it("treats 'No Search Results' as an empty (billed) SERP", async () => {
    responder = () =>
      Response.json({ status_code: 20000, status_message: "Ok.", cost: 0.002, tasks: [{ id: "t", status_code: 40501, status_message: "No Search Results.", cost: 0.002, result: null }] });
    const res = await getSerpAnalysis(ctx, { keyword: "Obscure Query" });
    expect(calls[0]!.body).toEqual([{ keyword: "obscure query", location_code: 2276, language_code: "de", device: "desktop", os: "windows", depth: 20 }]);
    expect(res.items).toEqual([]);
    expect(res.reason).toBe("no_organic_results");
  });

  it("retries HTTP 5xx on idempotent live reads", async () => {
    let n = 0;
    responder = () => (++n === 1 ? new Response("oops", { status: 502 }) : envelope({ result: [{ items: [{ type: "organic", rank_group: 1, title: "A", url: "https://a.com", domain: "a.com" }] }] }));
    const res = await getSerpAnalysis(ctx, { keyword: "a", depth: 100 });
    expect(n).toBe(2);
    expect(res.items).toHaveLength(1);
    expect(res.depth).toBe(100);
  });
});

describe("fetchKeywordMetricsForList", () => {
  it("local (city) configs merge Google Ads local volume with national Labs KD", async () => {
    responder = (url) =>
      url.includes("google_ads")
        ? envelope({ result: [{ keyword: "pizza", search_volume: 90, cpc: 1, competition_index: 20 }] })
        : envelope({ result: [{ items: [{ keyword: "pizza", keyword_properties: { keyword_difficulty: 33 } }, { keyword: "pizza near me", keyword_properties: { keyword_difficulty: 12 } }] }] });
    const rows = await fetchKeywordMetricsForList(ctx, { keywords: ["pizza", "pizza near me"], locationCode: 2840, languageCode: "en", locationName: "Enid,Oklahoma,United States", feature: "rank_tracking" });
    const ads = calls.find((c) => c.url.includes("google_ads"))!;
    expect(ads.body).toEqual([{ keywords: ["pizza", "pizza near me"], location_name: "Enid,Oklahoma,United States", language_code: "en" }]);
    expect(rows).toEqual([
      expect.objectContaining({ keyword: "pizza", searchVolume: 90, keywordDifficulty: 33 }),
      expect.objectContaining({ keyword: "pizza near me", searchVolume: null, keywordDifficulty: 12 }),
    ]);
  });
});

describe("domain overview", () => {
  it("sends domain_rank_overview + ranked_keywords with scope filters, order and offset", async () => {
    responder = (url) =>
      url.endsWith("/domain_rank_overview/live")
        ? envelope({ result: [{ items: [{ metrics: { organic: { etv: 5000.4, count: 321 } } }] }] })
        : envelope({
            result: [
              {
                total_count: 321,
                items: [{ keyword_data: { keyword: "balkonkraftwerk", keyword_info: { search_volume: 9000, cpc: 0.9 } }, ranked_serp_element: { serp_item: { url: "https://example.com/blog/x", relative_url: "/blog/x", rank_absolute: 2, etv: 800 } } }],
              },
            ],
          });
    const overview = await getDomainOverview(ctx, { domain: "https://www.example.com/blog", scope: "subfolder" });
    expect(overview).toMatchObject({ organicTraffic: 5000, organicKeywords: 321, hasData: true, scope: "subfolder", displayTarget: "example.com/blog" });
    expect(calls[0]!.body).toEqual([{ target: "example.com", location_code: 2276, language_code: "de", limit: 1 }]);
    const page = await getDomainKeywordsPage(ctx, { domain: "example.com/blog", scope: "subfolder", page: 2, pageSize: 50, sortMode: "rank", sortOrder: "asc", filters: { minVol: 100 } });
    const body = (calls[1]!.body as Record<string, unknown>[])[0]!;
    expect(body).toMatchObject({ target: "example.com", limit: 50, offset: 50, order_by: ["ranked_serp_element.serp_item.rank_absolute,asc"] });
    expect(body.filters).toEqual([
      ["ranked_serp_element.serp_item.domain", "in", ["example.com", "www.example.com"]],
      "and",
      [
        ["ranked_serp_element.serp_item.relative_url", "=", "/blog"],
        "or",
        ["ranked_serp_element.serp_item.relative_url", "like", "/blog/%"],
        "or",
        ["ranked_serp_element.serp_item.relative_url", "like", "/blog?%"],
      ],
      "and",
      ["keyword_data.keyword_info.search_volume", ">=", 100],
    ]);
    expect(page).toMatchObject({ totalCount: 321, hasMore: true, page: 2 });
    expect(page.rows[0]).toMatchObject({ keyword: "balkonkraftwerk", position: 2, traffic: 800, relativeUrl: "/blog/x" });
  });

  it("rejects Google-Ads-only markets for Labs domain analytics", async () => {
    responder = () => envelope({ result: [] });
    await expect(getDomainOverview(ctx, { domain: "example.com", locationCode: 2352 })).rejects.toThrow(/not available/);
    expect(calls).toHaveLength(0);
  });
});

describe("backlinks", () => {
  it("domain scope: summary (include_subdomains false) + 1-year history in parallel", async () => {
    responder = (url) =>
      url.endsWith("/summary/live")
        ? envelope({ result: [{ rank: 44, backlinks: 1200, referring_domains: 80, new_reffering_domains: 4, info: { target_spam_score: 3 } }] })
        : envelope({ result: [{ items: [{ date: "2026-08-01 00:00:00 +00:00", backlinks: 1100, referring_domains: 78, new_backlinks: 20, lost_backlinks: 5 }] }] });
    const o = await getBacklinksOverview(ctx, { target: "www.example.com", scope: "domain" });
    const summary = calls.find((c) => c.url.endsWith("/backlinks/summary/live"))!;
    expect((summary.body as Record<string, unknown>[])[0]).toEqual({
      target: "example.com",
      include_subdomains: false,
      include_indirect_links: true,
      exclude_internal_backlinks: true,
      backlinks_status_type: "live",
      rank_scale: "one_hundred",
    });
    const history = calls.find((c) => c.url.endsWith("/backlinks/history/live"))!;
    expect((history.body as Record<string, unknown>[])[0]).toMatchObject({ target: "example.com", rank_scale: "one_hundred" });
    expect(o.summary).toMatchObject({ rank: 44, backlinks: 1200, newReferringDomains: 4, targetSpamScore: 3 });
    expect(o.trends).toEqual([{ date: "2026-08-01", backlinks: 1100, referringDomains: 78, rank: null }]);
  });

  it("subfolder scope: two limit:1 backlinks/live calls (as_is, one_per_domain) with the url_to prefix group", async () => {
    let i = 0;
    responder = () => envelope({ result: [{ total_count: ++i === 1 ? 500 : 40, items: [] }] });
    const o = await getBacklinksOverview(ctx, { target: "example.com/blog" });
    expect(calls.map((c) => (c.body as Record<string, unknown>[])[0]!.mode)).toEqual(["as_is", "one_per_domain"]);
    expect((calls[0]!.body as Record<string, unknown>[])[0]).toMatchObject({ target: "example.com", limit: 1 });
    expect(o.summary.backlinks).toBe(500);
    expect(o.summary.referringDomains).toBe(40);
    expect(o.trends).toEqual([]);
  });

  it("rows: web UI filters + optional spam condition (≤ 40) + sort + mode", async () => {
    responder = () => envelope({ result: [{ total_count: 3, items: [{ domain_from: "a.com", url_from: "https://a.com/x", url_to: "https://example.com/", backlink_spam_score: 12, dofollow: true }] }] });
    const res = await getBacklinksRows(ctx, { target: "example.com", filters: { include: "blog", hideBroken: true }, hideSpam: true, sortField: "domainRank", sortOrder: "desc", pageSize: 50 });
    const body = (calls[0]!.body as Record<string, unknown>[])[0]!;
    expect(body).toMatchObject({ limit: 50, offset: 0, mode: "one_per_domain", order_by: ["domain_from_rank,desc"] });
    expect(body.filters).toEqual([["url_from", "ilike", "%blog%"], "and", ["is_broken", "=", false], "and", ["backlink_spam_score", "<=", 40]]);
    expect(res.rows[0]).toMatchObject({ domainFrom: "a.com", spamScore: 12, isDofollow: true });
    expect(res.hasMore).toBe(true); // offset 0 + 1 row < total_count 3
  });
});
