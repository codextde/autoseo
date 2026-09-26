/**
 * Free tools protection pipeline (integration, dev DB for the cache + budget ledger; DataForSEO / Turnstile / RDAP
 * fetches are stubbed). Mirrors open-seo `web/tests/free-tool-protection.test.ts`.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";

const settingsState = {
  freeTools: {
    publicEnabled: true,
    dailyBudgetUsd: 5,
    maxCallsPerDay: 2000,
    perVisitorCallsPerDay: 40,
    perIpPerMinute: 100,
    turnstileSiteKey: "",
    turnstileSecretKey: "",
    ctaUrl: "",
    ctaLabel: "",
  },
  dataforseo: { login: "user@example.com", password: "secret", sandbox: false },
};

vi.mock("@/server/settings", () => ({
  getSetting: async (key: string) => {
    if (key === "freeTools") return { ...settingsState.freeTools };
    if (key === "dataforseo") return { ...settingsState.dataforseo };
    if (key === "limits") return { dailyBudgetUsd: 0, monthlyBudgetUsd: 0 };
    if (key === "security") return { behindCloudflare: false };
    return {};
  },
}));

// Keep the dev usage ledger clean: DataForSEO usage recording is not what these tests are about.
vi.mock("@/server/usage", () => ({
  recordUsage: vi.fn(async () => {}),
  assertBudget: vi.fn(async () => {}),
  BudgetExceededError: class BudgetExceededError extends Error {},
}));

import { db } from "@/server/db/client";
import { freeToolCache, freeToolCounters } from "@/server/db/schema";
import { ipIdentity, normalizeDomain } from "./domain";
import { breadcrumbParts } from "@/features/free-tools/lib/serp";
import { handleFreeToolRequest, MAX_TOOL_BODY_BYTES } from "./public";
import { reserveToolBudget, visitorHash, getFreeToolsUsageToday } from "./budget";
import { writeCached } from "./cache";
import { runToolInApp } from "./app";
import { recordUsage } from "@/server/usage";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const DAY = `test-${RUN}`;
const cacheKeys: string[] = [];
let ipSeq = 0;
const nextIp = () => `203.0.113.${(ipSeq++ % 250) + 1}-${RUN}`;
const domain = (label: string) => `${label}-${RUN}.com`;

type Call = { url: string; body: unknown };
let calls: Call[] = [];
let responder: (url: string, body: unknown) => Response | Promise<Response>;

function dfsEnvelope(result: unknown, statusCode = 20000, statusMessage = "Ok.") {
  return Response.json({
    status_code: 20000,
    status_message: "Ok.",
    cost: 0.02,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [{ id: "t1", status_code: statusCode, status_message: statusMessage, cost: 0.02, path: [], result: result === null ? null : [result] }],
  });
}

function backlinkResponder(url: string): Response {
  if (url.endsWith("/v3/backlinks/summary/live")) return dfsEnvelope({ rank: 42, backlinks: 1234, referring_domains: 56, broken_backlinks: 3 });
  if (url.endsWith("/v3/backlinks/backlinks/live"))
    return dfsEnvelope({
      items: [
        { type: "backlink", domain_from: "a.com", url_from: "https://a.com/x", url_to: "https://t.com/", anchor: "hello", dofollow: true, domain_from_rank: 80, page_from_title: " " },
        { type: "anchor", domain_from: "b.com", url_from: "https://b.com/y" },
      ],
    });
  throw new Error(`unexpected ${url}`);
}

function toolRequest(tool: string, body: unknown, opts: { ip?: string; origin?: string | null; contentType?: string; raw?: BodyInit } = {}) {
  const headers: Record<string, string> = { "content-type": opts.contentType ?? "application/json", "x-real-ip": opts.ip ?? nextIp() };
  if (opts.origin !== null) headers.origin = opts.origin ?? "http://localhost:3000";
  return new Request(`http://localhost:3000/api/free-tools/${tool}`, {
    method: "POST",
    headers,
    body: opts.raw ?? JSON.stringify(body),
    // Required by undici for streamed bodies.
    ...(opts.raw instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
}

async function counter(key: string) {
  const [row] = await db
    .select()
    .from(freeToolCounters)
    .where(and(eq(freeToolCounters.day, DAY), eq(freeToolCounters.key, key)));
  return row ?? null;
}

beforeEach(() => {
  calls = [];
  responder = (url) => {
    throw new Error(`unexpected fetch ${url}`);
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      calls.push({ url, body });
      return responder(url, body);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(settingsState.freeTools, {
    publicEnabled: true,
    dailyBudgetUsd: 5,
    maxCallsPerDay: 2000,
    perVisitorCallsPerDay: 40,
    perIpPerMinute: 100,
    turnstileSecretKey: "",
  });
  settingsState.dataforseo.login = "user@example.com";
});

afterAll(async () => {
  await db.delete(freeToolCounters).where(like(freeToolCounters.day, `test-${RUN}%`));
  if (cacheKeys.length) await db.delete(freeToolCache).where(inArray(freeToolCache.key, cacheKeys));
  await db.delete(freeToolCache).where(like(freeToolCache.key, `%-${RUN}.com%`));
});

describe("normalizeDomain", () => {
  it("normalizes URLs and hosts like open-seo", () => {
    expect(normalizeDomain("https://www.Example.com/path?q=1")).toBe("example.com");
    expect(normalizeDomain("  sub.example.co.uk ")).toBe("sub.example.co.uk");
    expect(normalizeDomain("http://example.com:8080")).toBe("example.com");
    expect(normalizeDomain("WWW.EXAMPLE.ORG")).toBe("example.org");
  });
  it("rejects anything that isn't a multi-label hostname", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("-bad-.com")).toBeNull();
    expect(normalizeDomain("exa_mple.com")).toBeNull();
    expect(normalizeDomain("a".repeat(260) + ".com")).toBeNull();
    expect(normalizeDomain("127.0.0.1")).toBeNull();
    expect(normalizeDomain("http://169.254.169.254/latest")).toBeNull();
    expect(normalizeDomain("2130706433")).toBeNull();
  });
  it("groups IPv6 clients by /64 and unwraps IPv4-mapped addresses", () => {
    expect(ipIdentity("203.0.113.7")).toBe("203.0.113.7");
    expect(ipIdentity("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipIdentity("2001:db8:0:1:aaaa::1")).toBe("2001:db8:0:1::/64");
    expect(ipIdentity("2001:db8:0:1:bbbb:cccc:dddd:eeee")).toBe("2001:db8:0:1::/64");
    expect(ipIdentity("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });
});

describe("SERP simulator breadcrumb", () => {
  it("builds origin + path crumbs like Google", () => {
    expect(breadcrumbParts("https://www.example.com/blog/my%20post/?utm=1")).toEqual({ host: "www.example.com", crumbs: ["blog", "my post"], origin: "https://www.example.com" });
    expect(breadcrumbParts("example.com")).toEqual({ host: "example.com", crumbs: [], origin: "https://example.com" });
    expect(breadcrumbParts("http://a.io/x/")).toEqual({ host: "a.io", crumbs: ["x"], origin: "http://a.io" });
  });
});

describe("request protections", () => {
  it("404s when the public tools are disabled or the tool is unknown", async () => {
    settingsState.freeTools.publicEnabled = false;
    expect((await handleFreeToolRequest(toolRequest("backlink-checker", { target: "example.com" }), "backlink-checker", { day: DAY })).status).toBe(404);
    settingsState.freeTools.publicEnabled = true;
    expect((await handleFreeToolRequest(toolRequest("nope", {}), "nope", { day: DAY })).status).toBe(404);
    expect((await handleFreeToolRequest(toolRequest("serp-simulator", {}), "serp-simulator", { day: DAY })).status).toBe(404);
    expect((await handleFreeToolRequest(toolRequest("constructor", {}), "constructor", { day: DAY })).status).toBe(404);
    expect((await handleFreeToolRequest(toolRequest("__proto__", {}), "__proto__", { day: DAY })).status).toBe(404);
  });

  it("requires exactly application/json (415)", async () => {
    const plain = await handleFreeToolRequest(toolRequest("backlink-checker", { target: "example.com" }, { contentType: "text/plain" }), "backlink-checker", { day: DAY });
    expect(plain.status).toBe(415);
    const sneaky = await handleFreeToolRequest(
      toolRequest("backlink-checker", { target: "example.com" }, { contentType: "text/plain; x=application/json" }),
      "backlink-checker",
      { day: DAY },
    );
    expect(sneaky.status).toBe(415);
  });

  it("rejects oversized streamed JSON without relying on Content-Length (413)", async () => {
    const chunk = new TextEncoder().encode(`{"target":"${"a".repeat(4000)}`);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_TOOL_BODY_BYTES * 2) return controller.close();
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const res = await handleFreeToolRequest(toolRequest("backlink-checker", null, { raw: stream }), "backlink-checker", { day: DAY });
    expect(res.status).toBe(413);
    expect(sent).toBeLessThanOrEqual(MAX_TOOL_BODY_BYTES + chunk.byteLength * 2);
  });

  it("validates JSON, input and domains (400)", async () => {
    expect((await handleFreeToolRequest(toolRequest("backlink-checker", null, { raw: "{nope" }), "backlink-checker", { day: DAY })).status).toBe(400);
    const bad = await handleFreeToolRequest(toolRequest("backlink-checker", { target: "not a domain" }), "backlink-checker", { day: DAY });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Enter a valid domain, like example.com" });
    const country = await handleFreeToolRequest(toolRequest("keyword-generator", { keyword: "seo", locationCode: 1234 }), "keyword-generator", { day: DAY });
    expect(country.status).toBe(400);
    expect(await country.json()).toEqual({ error: "Pick a supported country" });
  });

  it("503s when DataForSEO is not configured", async () => {
    settingsState.dataforseo.login = "";
    const res = await handleFreeToolRequest(toolRequest("backlink-checker", { target: "example.com" }), "backlink-checker", { day: DAY });
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it("blocks cross-site submissions before any provider or verification call (403)", async () => {
    settingsState.freeTools.turnstileSecretKey = "secret";
    const res = await handleFreeToolRequest(toolRequest("backlink-checker", { target: "example.com" }, { origin: "https://evil.example" }), "backlink-checker", {
      day: DAY,
    });
    expect(res.status).toBe(403);
    const noOrigin = await handleFreeToolRequest(toolRequest("backlink-checker", { target: "example.com" }, { origin: null }), "backlink-checker", { day: DAY });
    expect(noOrigin.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rate limits per IP across all tools with Retry-After (429)", async () => {
    settingsState.freeTools.perIpPerMinute = 2;
    const ip = nextIp();
    const d = domain("ratelimit");
    await writeCached("backlink-checker", d, { ok: true, data: { target: d, summary: {}, topBacklinks: [] } }, 60);
    await writeCached("spam-score-checker", d, { ok: true, data: { target: d, worstBacklinks: [] } }, 60);
    expect((await handleFreeToolRequest(toolRequest("backlink-checker", { target: d }, { ip }), "backlink-checker", { day: DAY })).status).toBe(200);
    expect((await handleFreeToolRequest(toolRequest("spam-score-checker", { target: d }, { ip }), "spam-score-checker", { day: DAY })).status).toBe(200);
    const limited = await handleFreeToolRequest(toolRequest("backlink-checker", { target: d }, { ip }), "backlink-checker", { day: DAY });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    // Another visitor is unaffected.
    expect((await handleFreeToolRequest(toolRequest("backlink-checker", { target: d }), "backlink-checker", { day: DAY })).status).toBe(200);
    expect((await counter("tool:backlink-checker"))?.blocked).toBeGreaterThanOrEqual(1);
  });

  it("verifies Turnstile tokens for this hostname and the free_tool action", async () => {
    settingsState.freeTools.turnstileSecretKey = "0x-real-secret";
    const d = domain("turnstile");
    await writeCached("backlink-checker", d, { ok: true, data: { target: d, summary: {}, topBacklinks: [] } }, 60);
    let verdict: Record<string, unknown> = { success: true, hostname: "localhost", action: "free_tool" };
    responder = (url) => {
      if (url.includes("turnstile/v0/siteverify")) return Response.json(verdict);
      throw new Error(`unexpected ${url}`);
    };
    const missing = await handleFreeToolRequest(toolRequest("backlink-checker", { target: d }), "backlink-checker", { day: DAY });
    expect(missing.status).toBe(403);
    const ok = await handleFreeToolRequest(toolRequest("backlink-checker", { target: d, turnstileToken: "tok" }), "backlink-checker", { day: DAY });
    expect(ok.status).toBe(200);
    const sv = calls.find((c) => c.url.includes("siteverify"));
    expect(String(sv?.body)).toContain("secret=0x-real-secret");
    expect(String(sv?.body)).toContain("response=tok");
    verdict = { success: true, hostname: "evil.example", action: "free_tool" };
    expect((await handleFreeToolRequest(toolRequest("backlink-checker", { target: d, turnstileToken: "tok" }), "backlink-checker", { day: DAY })).status).toBe(403);
    verdict = { success: true, hostname: "localhost", action: "login" };
    expect((await handleFreeToolRequest(toolRequest("backlink-checker", { target: d, turnstileToken: "tok" }), "backlink-checker", { day: DAY })).status).toBe(403);
    responder = () => new Response("down", { status: 500 });
    expect((await handleFreeToolRequest(toolRequest("backlink-checker", { target: d, turnstileToken: "tok" }), "backlink-checker", { day: DAY })).status).toBe(503);
  });
});

describe("cache, budget and DataForSEO", () => {
  it("serves a cache hit without reserving budget or contacting DataForSEO", async () => {
    const d = domain("cachehit");
    const cached = { target: d, summary: { rank: 1, backlinks: 2, referringDomains: 3, brokenBacklinks: 0 }, topBacklinks: [] };
    await writeCached("backlink-checker", d, { ok: true, data: cached }, 60);
    const ip = nextIp();
    const res = await handleFreeToolRequest(toolRequest("backlink-checker", { target: `https://www.${d}/x` }, { ip }), "backlink-checker", { day: DAY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(cached);
    expect(calls).toHaveLength(0);
    expect(await counter(`visitor:${visitorHash(DAY, ip)}`)).toBeNull();
    const tool = await counter("tool:backlink-checker");
    expect(tool?.cacheHits).toBeGreaterThanOrEqual(1);
  });

  it("reserves the full run, calls the exact endpoints + payloads, then caches the result", async () => {
    responder = backlinkResponder;
    const d = domain("fresh");
    const ip = nextIp();
    const before = (await counter("all"))?.calls ?? 0;
    const res = await handleFreeToolRequest(toolRequest("backlink-checker", { target: d }, { ip }), "backlink-checker", { day: DAY });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      target: d,
      summary: { rank: 42, backlinks: 1234, referringDomains: 56, brokenBacklinks: 3 },
      topBacklinks: [{ domainFrom: "a.com", urlFrom: "https://a.com/x", urlTo: "https://t.com/", pageTitle: null, anchor: "hello", dofollow: true, domainRank: 80 }],
    });
    const common = { target: d, include_subdomains: true, include_indirect_links: true, exclude_internal_backlinks: true, backlinks_status_type: "live", rank_scale: "one_hundred" };
    expect(calls.find((c) => c.url === "https://api.dataforseo.com/v3/backlinks/summary/live")?.body).toEqual([common]);
    expect(calls.find((c) => c.url === "https://api.dataforseo.com/v3/backlinks/backlinks/live")?.body).toEqual([
      { ...common, limit: 15, mode: "one_per_domain", order_by: ["domain_from_rank,desc"] },
    ]);
    expect(((await counter("all"))?.calls ?? 0) - before).toBe(2);
    // Public usage = instance-level usage (no workspace / project).
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: "dataforseo", feature: "free_tools_public", workspaceId: null, projectId: null }));
    const visitor = await counter(`visitor:${visitorHash(DAY, ip)}`);
    expect(visitor?.calls).toBe(2);
    expect(visitor?.microUsd).toBe(50_000);

    calls = [];
    const again = await handleFreeToolRequest(toolRequest("backlink-checker", { target: d }, { ip }), "backlink-checker", { day: DAY });
    expect(again.status).toBe(200);
    expect(calls).toHaveLength(0);
    expect((await counter(`visitor:${visitorHash(DAY, ip)}`))?.calls).toBe(2);
  });

  it("caches failures briefly (502) so a failing target isn't retried in a loop", async () => {
    responder = () => new Response("boom", { status: 500 });
    const d = domain("failing");
    const res = await handleFreeToolRequest(toolRequest("spam-score-checker", { target: d }), "spam-score-checker", { day: DAY });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Spam score check failed. Please try again." });
    calls = [];
    const cachedFailure = await handleFreeToolRequest(toolRequest("spam-score-checker", { target: d }), "spam-score-checker", { day: DAY });
    expect(cachedFailure.status).toBe(502);
    expect(calls).toHaveLength(0);
  });

  it("does not cache failures that cost nothing (rejected credentials)", async () => {
    responder = () => new Response("unauthorized", { status: 401 });
    const d = domain("auth401");
    expect((await handleFreeToolRequest(toolRequest("backlink-checker", { target: d }), "backlink-checker", { day: DAY })).status).toBe(502);
    responder = backlinkResponder;
    calls = [];
    expect((await handleFreeToolRequest(toolRequest("backlink-checker", { target: d }), "backlink-checker", { day: DAY })).status).toBe(200);
    expect(calls.length).toBe(2);
  });

  it("treats DataForSEO 'No Search Results' as an empty success", async () => {
    responder = () => dfsEnvelope(null, 40501, "No Search Results.");
    const res = await handleFreeToolRequest(toolRequest("keyword-generator", { keyword: `  Zzq  ${RUN} `, locationCode: 2276 }), "keyword-generator", { day: DAY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ keyword: `zzq ${RUN}`, locationCode: 2276, keywords: [] });
    expect(calls[0]?.body).toEqual([
      {
        keyword: `zzq ${RUN}`,
        include_seed_keyword: false,
        include_serp_info: false,
        include_clickstream_data: false,
        exact_match: false,
        ignore_synonyms: true,
        location_code: 2276,
        language_code: "de",
        limit: 20,
      },
    ]);
    await db.delete(freeToolCache).where(eq(freeToolCache.key, `keyword-generator|core-v2|zzq ${RUN}|2276`));
  });

  it("charges only uncached domains in traffic compare mode", async () => {
    const a = domain("traffic-a");
    const b = domain("traffic-b");
    await writeCached(
      "website-traffic-checker",
      `organic-v2|${a}|2840`,
      { ok: true, data: { domain: a, organicTraffic: 1, organicKeywords: 2, trafficValue: 3, topKeywords: [], topPages: [], totalPages: 4 } },
      60,
    );
    responder = (url) => {
      if (url.endsWith("/domain_rank_overview/live")) return dfsEnvelope({ items: [{ metrics: { organic: { etv: 10.4, count: 20, estimated_paid_traffic_cost: 30.6 } } }] });
      if (url.endsWith("/ranked_keywords/live"))
        return dfsEnvelope({
          items: [{ keyword_data: { keyword: "kw", keyword_info: { search_volume: 100 }, keyword_properties: { keyword_difficulty: 12 } }, ranked_serp_element: { serp_item: { rank_group: 3, url: "https://b/x" } } }],
        });
      if (url.endsWith("/relevant_pages/live")) return dfsEnvelope({ total_count: 7, items: [{ page_address: "https://b/x", metrics: { organic: { etv: 5, count: 2 } } }] });
      throw new Error(url);
    };
    const ip = nextIp();
    const res = await handleFreeToolRequest(toolRequest("website-traffic-checker", { target: a, compare: b, locationCode: 2840 }, { ip }), "website-traffic-checker", {
      day: DAY,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.primary.organicTraffic).toBe(1);
    expect(data.comparison).toMatchObject({ domain: b, organicTraffic: 10, organicKeywords: 20, trafficValue: 31, totalPages: 7 });
    expect(data.comparison.topKeywords).toEqual([{ keyword: "kw", searchVolume: 100, difficulty: 12, position: 3, url: "https://b/x" }]);
    expect(calls).toHaveLength(3);
    expect((await counter(`visitor:${visitorHash(DAY, ip)}`))?.calls).toBe(3);
  });

  it("refuses a visitor over the per-visitor daily allowance (429)", async () => {
    settingsState.freeTools.perVisitorCallsPerDay = 2;
    responder = backlinkResponder;
    const ip = nextIp();
    expect((await handleFreeToolRequest(toolRequest("backlink-checker", { target: domain("v1") }, { ip }), "backlink-checker", { day: DAY })).status).toBe(200);
    calls = [];
    const res = await handleFreeToolRequest(toolRequest("backlink-checker", { target: domain("v2") }, { ip }), "backlink-checker", { day: DAY });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/today's free limit/);
    expect(calls).toHaveLength(0);
  });
});

describe("budget ledger", () => {
  const limits = { maxCallsPerDay: 1000, dailyBudgetUsd: 100, perVisitorCallsPerDay: 1000 };

  it("never over-reserves the daily call ceiling under concurrency", async () => {
    const day = `${DAY}-calls`;
    const decisions = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        reserveToolBudget({ tool: "competitor-analysis", calls: 2, visitor: visitorHash(day, `ip${i}`), day, limits: { ...limits, maxCallsPerDay: 10 } }),
      ),
    );
    expect(decisions.filter((d) => d === "allowed")).toHaveLength(5);
    expect(decisions.filter((d) => d === "daily")).toHaveLength(15);
    const [all] = await db.select().from(freeToolCounters).where(and(eq(freeToolCounters.day, day), eq(freeToolCounters.key, "all")));
    expect(all?.calls).toBe(10);
    expect(all?.microUsd).toBe(5 * 2 * 15_000);
    expect(all?.blocked).toBe(15);
  });

  it("enforces the estimated USD budget atomically", async () => {
    const day = `${DAY}-usd`;
    // backlink-checker reserves $0.025/call → 2 calls = $0.05; a $0.10 budget fits exactly two runs.
    const decisions = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        reserveToolBudget({ tool: "backlink-checker", calls: 2, visitor: visitorHash(day, `ip${i}`), day, limits: { ...limits, dailyBudgetUsd: 0.1 } }),
      ),
    );
    expect(decisions.filter((d) => d === "allowed")).toHaveLength(2);
  });

  it("enforces per-tool and per-visitor ceilings", async () => {
    const day = `${DAY}-caps`;
    const visitor = visitorHash(day, "same");
    const perVisitor = await Promise.all(
      Array.from({ length: 6 }, () => reserveToolBudget({ tool: "keyword-generator", calls: 1, visitor, day, limits: { ...limits, perVisitorCallsPerDay: 4 } })),
    );
    expect(perVisitor.filter((d) => d === "allowed")).toHaveLength(4);
    expect(perVisitor.filter((d) => d === "visitor")).toHaveLength(2);

    const perTool = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        reserveToolBudget({ tool: "spam-score-checker", calls: 2, visitor: visitorHash(day, `t${i}`), day, limits: { ...limits, toolCallsPerDay: 6 } }),
      ),
    );
    expect(perTool.filter((d) => d === "allowed")).toHaveLength(3);
    expect(perTool.filter((d) => d === "tool")).toHaveLength(3);
  });

  it("a zero budget is a hard cap, not unlimited", async () => {
    const day = `${DAY}-zero`;
    expect(await reserveToolBudget({ tool: "keyword-generator", calls: 1, visitor: visitorHash(day, "z"), day, limits: { ...limits, dailyBudgetUsd: 0 } })).toBe("daily");
    expect(await reserveToolBudget({ tool: "keyword-generator", calls: 1, visitor: visitorHash(day, "z"), day, limits: { ...limits, maxCallsPerDay: 0 } })).toBe("daily");
  });

  it("reports today's usage for the admin page", async () => {
    const usage = await getFreeToolsUsageToday(`${DAY}-calls`);
    expect(usage.calls).toBe(10);
    expect(usage.estimatedUsd).toBeCloseTo(0.15);
    expect(usage.blocked).toBe(15);
    expect(usage.visitors).toBe(5);
    expect(usage.tools).toHaveLength(8);
    expect(usage.tools.find((t) => t.tool === "competitor-analysis")).toMatchObject({ calls: 10, callsLimit: 2500, paid: true });
    expect(usage.tools.find((t) => t.tool === "serp-simulator")).toMatchObject({ paid: false, callsLimit: null });
  });
});

describe("in-app runner (signed-in project members)", () => {
  const ctx = { projectId: "prj_test", workspaceId: "wsp_test", userId: "usr_test", canRun: true };

  it("requires seo.run for DataForSEO tools", async () => {
    const res = await runToolInApp({ ...ctx, canRun: false }, "backlink-checker", { target: "example.com" });
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
    expect(calls).toHaveLength(0);
  });

  it("explains a missing DataForSEO connection", async () => {
    settingsState.dataforseo.login = "";
    const res = await runToolInApp(ctx, "keyword-generator", { keyword: "seo", locationCode: 2840 });
    expect(res).toMatchObject({ ok: false, code: "not_configured" });
  });

  it("charges the workspace (not the public ledger) and shares the result cache", async () => {
    responder = backlinkResponder;
    const d = domain("inapp");
    vi.mocked(recordUsage).mockClear();
    const res = await runToolInApp(ctx, "backlink-checker", { target: d });
    expect(res.ok).toBe(true);
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "dataforseo", feature: "free_tools", workspaceId: "wsp_test", projectId: "prj_test", userId: "usr_test" }),
    );
    calls = [];
    // Same domain on the public surface → cache hit, nothing spent.
    const pub = await handleFreeToolRequest(toolRequest("backlink-checker", { target: d }), "backlink-checker", { day: DAY });
    expect(pub.status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it("runs the RDAP domain-age lookup without seo.run", async () => {
    const d = domain("rdap");
    responder = (url) => {
      if (url === `https://rdap.org/domain/${d}`) {
        return Response.json({
          events: [
            { eventAction: "registration", eventDate: "2001-02-03T00:00:00Z" },
            { eventAction: "expiration", eventDate: "2030-02-03T00:00:00Z" },
          ],
          entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Example Registrar"]]] }],
        });
      }
      throw new Error(url);
    };
    const res = await runToolInApp({ ...ctx, canRun: false }, "domain-age-checker", { domains: [d, d.toUpperCase()] });
    expect(res.ok).toBe(true);
    const rows = (res as { ok: true; data: { rows: { domain: string; registrar: string; created: string; error: string | null }[] } }).data.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ domain: d, registrar: "Example Registrar", created: "2001-02-03T00:00:00Z", error: null });
  });
});
