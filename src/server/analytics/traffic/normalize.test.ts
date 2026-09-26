import { describe, expect, it } from "vitest";
import {
  TrafficAggregator,
  dateWindows,
  ga4Date,
  ga4RowToTraffic,
  matomoVisitToRow,
  normalizeCountry,
  normalizeLandingPage,
  todayInTimeZone,
} from "./normalize";

describe("normalizers", () => {
  it("normalizes landing pages", () => {
    expect(normalizeLandingPage("(not set)")).toBe("");
    expect(normalizeLandingPage("/")).toBe("/");
    expect(normalizeLandingPage("/pricing?utm_source=chatgpt.com")).toBe("/pricing");
    expect(normalizeLandingPage("https://example.com/de/shop//kit#x")).toBe("/de/shop/kit");
    expect(normalizeLandingPage("blog/post")).toBe("/blog/post");
  });

  it("normalizes countries", () => {
    expect(normalizeCountry("de")).toBe("DE");
    expect(normalizeCountry("(not set)")).toBe("");
    expect(normalizeCountry("xx")).toBe("");
  });

  it("formats GA4 dates and time-zone days", () => {
    expect(ga4Date("20260925")).toBe("2026-09-25");
    const now = new Date("2026-09-25T23:30:00Z");
    expect(todayInTimeZone("Europe/Berlin", now)).toBe("2026-09-26");
    expect(todayInTimeZone("America/Los_Angeles", now)).toBe("2026-09-25");
    expect(todayInTimeZone("Not/AZone", now)).toBe("2026-09-25");
  });

  it("splits date windows", () => {
    expect(dateWindows("2026-01-01", "2026-01-10", 4)).toEqual([
      { from: "2026-01-01", to: "2026-01-04" },
      { from: "2026-01-05", to: "2026-01-08" },
      { from: "2026-01-09", to: "2026-01-10" },
    ]);
    expect(dateWindows("2026-01-01", "2026-01-01", 90)).toHaveLength(1);
  });
});

describe("row mappers", () => {
  it("maps GA4 AI rows and drops non-AI sources", () => {
    const row = ga4RowToTraffic({
      date: "20260920",
      sessionSource: "chatgpt.com",
      landingPage: "/pricing",
      countryId: "DE",
      sessions: 10,
      engagedSessions: 6,
      keyEvents: 3,
      sessionKeyEventRate: 0.2,
      totalRevenue: 99.5,
      userEngagementDuration: 300,
      totalUsers: 9,
    });
    expect(row).toMatchObject({ date: "2026-09-20", platform: "chatgpt", page: "/pricing", country: "DE", sessions: 10, convertedSessions: 2, revenue: 99.5 });
    expect(ga4RowToTraffic({ date: "20260920", sessionSource: "google", sessions: 5 })).toBeNull();
  });

  it("maps Matomo visits", () => {
    const v = matomoVisitToRow({
      serverDate: "2026-09-20",
      referrerName: "perplexity.ai",
      referrerUrl: "https://www.perplexity.ai/search/abc",
      visitDuration: 95,
      actions: 3,
      countryCode: "at",
      visitConverted: 1,
      goalConversions: 1,
      actionDetails: [
        { type: "action", url: "https://example.com/products/kit?x=1" },
        { type: "goal", revenue: 20 },
        { type: "ecommerceOrder", revenue: 150 },
      ],
    });
    expect(v).toMatchObject({ platform: "perplexity", page: "/products/kit", country: "AT", engagedSessions: 1, convertedSessions: 1, conversions: 2, revenue: 170 });
    expect(matomoVisitToRow({ serverDate: "2026-09-20", referrerName: "google", referrerUrl: "https://www.google.com/" })).toBeNull();
  });

  it("aggregates by date × platform × page × country", () => {
    const agg = new TrafficAggregator();
    const base = { date: "2026-09-20", platform: "claude", page: "/", country: "DE", engagedSessions: 1, convertedSessions: 0, conversions: 0, revenue: 0, engagementSeconds: 10, users: 1 };
    agg.add({ ...base, sessions: 1 });
    agg.add({ ...base, sessions: 2 });
    agg.add({ ...base, country: "US", sessions: 1 });
    agg.add({ ...base, sessions: 0, engagedSessions: 0 });
    const rows = agg.rows();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.country === "DE")?.sessions).toBe(3);
  });
});
