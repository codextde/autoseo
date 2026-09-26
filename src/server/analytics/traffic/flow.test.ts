import { describe, expect, it } from "vitest";
import { buildTrafficFlow, classifyPageIntent, splitOutcomes, type FlowInputRow } from "./flow";

const row = (platform: string, page: string, sessions: number, engaged: number, converted: number, conversions = converted, revenue = 0): FlowInputRow => ({
  platform,
  page,
  sessions,
  engagedSessions: engaged,
  convertedSessions: converted,
  conversions,
  revenue,
});

describe("classifyPageIntent", () => {
  it.each([
    ["/", "home"],
    ["/de/", "home"],
    ["/en-us", "home"],
    ["https://example.com/about-us", "home"],
    ["/pricing", "pricing"],
    ["/de/preise/", "pricing"],
    ["/blog/how-to-choose-a-balcony-plant", "blog"],
    ["/ratgeber/solar", "blog"],
    ["/blog/solakon-vs-anker", "comparison"],
    ["/compare/plans", "comparison"],
    ["/best-running-shoes", "comparison"],
    ["/products/solar-kit-800", "product"],
    ["/shop/cart?x=1", "product"],
    ["/docs/api", "support"],
    ["/faq", "support"],
    ["/something-else", "other"],
  ])("%s → %s", (path, intent) => {
    expect(classifyPageIntent(path)).toBe(intent);
  });
});

describe("splitOutcomes", () => {
  it("always sums to sessions", () => {
    for (const r of [
      { sessions: 10, engagedSessions: 6, convertedSessions: 2 },
      { sessions: 10, engagedSessions: 1, convertedSessions: 4 },
      { sessions: 5, engagedSessions: 9, convertedSessions: 9 },
      { sessions: 0, engagedSessions: 0, convertedSessions: 0 },
    ]) {
      const o = splitOutcomes(r);
      expect(o.converted + o.engaged + o.bounced).toBeCloseTo(r.sessions);
      expect(Math.min(o.converted, o.engaged, o.bounced)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("buildTrafficFlow", () => {
  const rows = [
    row("chatgpt", "/", 100, 60, 10, 12, 500),
    row("chatgpt", "/pricing", 40, 30, 8),
    row("perplexity", "/", 50, 20, 0),
    row("perplexity", "/blog/a", 30, 10, 1),
    row("claude", "/blog/b", 5, 5, 5),
  ];

  it("keeps flow conservation (platform in = outcome out)", () => {
    const f = buildTrafficFlow(rows, { metric: "sessions" });
    const inflow = f.links.filter((l) => l.source.startsWith("p:")).reduce((a, l) => a + l.value, 0);
    const outflow = f.links.filter((l) => l.target.startsWith("o:")).reduce((a, l) => a + l.value, 0);
    expect(inflow).toBeCloseTo(225);
    expect(outflow).toBeCloseTo(225);
    expect(f.nodes.find((n) => n.id === "p:chatgpt")?.label).toBe("ChatGPT");
    expect(f.totals.sessions).toBe(225);
  });

  it("groups beyond maxPages into Other pages", () => {
    const f = buildTrafficFlow(rows, { metric: "sessions", maxPages: 2 });
    expect(f.nodes.some((n) => n.id === "m:__other__")).toBe(true);
    expect(f.middleCount).toBe(4);
  });

  it("filters by URL substring", () => {
    const f = buildTrafficFlow(rows, { metric: "sessions", url: "BLOG" });
    expect(f.totals.sessions).toBe(35);
    expect(f.nodes.filter((n) => n.id.startsWith("m:")).map((n) => n.id).sort()).toEqual(["m:/blog/a", "m:/blog/b"]);
  });

  it("uses page intents in intent mode", () => {
    const f = buildTrafficFlow(rows, { metric: "intent" });
    const mids = f.nodes.filter((n) => n.id.startsWith("m:")).map((n) => n.id);
    expect(mids).toEqual(expect.arrayContaining(["m:home", "m:pricing", "m:blog"]));
  });

  it("splits conversions into revenue vs other conversions", () => {
    const f = buildTrafficFlow(rows, { metric: "conversions" });
    const rev = f.links.filter((l) => l.target === "o:revenue").reduce((a, l) => a + l.value, 0);
    const other = f.links.filter((l) => l.target === "o:other_conv").reduce((a, l) => a + l.value, 0);
    expect(rev).toBe(12);
    expect(other).toBe(14);
  });

  it("labels pages with conversion rate in conversion_rate mode", () => {
    const f = buildTrafficFlow(rows, { metric: "conversion_rate" });
    const first = f.nodes.find((n) => n.id.startsWith("m:"));
    expect(first?.label).toMatch(/%$/);
  });
});
