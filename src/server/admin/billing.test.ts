import { describe, expect, it } from "vitest";
import {
  creditsForRaw,
  ESTIMATOR_PRESETS,
  estimateMonthlyCost,
  RAW_COSTS,
  round5,
  sanitizeInput,
  WEEKS_PER_MONTH,
} from "@/features/settings/billing/estimator";
import { csvCell, forecastMonthEnd, monthKeysBack } from "@/features/settings/billing/math";

describe("raw DataForSEO unit costs (open-seo §22)", () => {
  it("matches the documented raw prices", () => {
    expect(RAW_COSTS.rankCheck).toBeCloseTo(0.00195, 10);
    expect(RAW_COSTS.keywordSearch).toBe(0.039);
    expect(RAW_COSTS.localSerp).toBeCloseTo(0.0035, 10);
    expect(RAW_COSTS.backlinkProfile).toBeCloseTo(0.061176, 10);
    expect(RAW_COSTS.aiCitation).toBe(0.85);
  });

  it("reproduces open-seo credit rounding", () => {
    expect(round5(0.123456)).toBe(0.12346);
    expect(creditsForRaw(RAW_COSTS.keywordSearch)).toBe(50);
    expect(creditsForRaw(RAW_COSTS.localSerp)).toBe(5);
    expect(creditsForRaw(RAW_COSTS.backlinkProfile)).toBe(79);
    expect(creditsForRaw(RAW_COSTS.aiCitation)).toBe(1088);
  });
});

describe("estimateMonthlyCost", () => {
  it("business preset: raw ≈ $5.63, open-seo hosted ≈ $7.12 (marketed ≈ $8)", () => {
    const e = estimateMonthlyCost(ESTIMATOR_PRESETS.business.input);
    expect(e.scheduledRunsPerMonth).toBeCloseTo(WEEKS_PER_MONTH, 6);
    const rank = e.lines.find((l) => l.key === "rank")!;
    expect(rank.quantity).toBeCloseTo(50 * WEEKS_PER_MONTH, 6);
    expect(rank.rawCost).toBeCloseTo(50 * WEEKS_PER_MONTH * 0.00195, 8);
    // raw: rank 0.4236 + 100 × 0.039 + 20 × 0.061176
    expect(e.rawTotal).toBeCloseTo(0.42364 + 3.9 + 1.22352, 4);
    expect(e.hostedCredits).toBeCloseTo(4.345 * 125 + 5000 + 20 * 79, 6);
    expect(e.hostedUsd).toBeGreaterThan(6.5);
    expect(e.hostedUsd).toBeLessThan(8.5);
  });

  it("freelancer preset: raw ≈ $19.9, open-seo hosted ≈ $25", () => {
    const e = estimateMonthlyCost(ESTIMATOR_PRESETS.freelancer.input);
    expect(e.scheduledRunsPerMonth).toBeCloseTo(15 * WEEKS_PER_MONTH, 6);
    const expectedRaw = 15 * WEEKS_PER_MONTH * 20 * 0.00195 + 370 * 0.039 + 200 * 0.0035 + 30 * 0.061176;
    expect(e.rawTotal).toBeCloseTo(expectedRaw, 6);
    expect(e.hostedCredits).toBeCloseTo(65.175 * 50 + 370 * 50 + 200 * 5 + 30 * 79, 6);
    expect(Math.round(e.hostedUsd)).toBe(25);
  });

  it("applies the agency markup on top of raw cost only", () => {
    const e = estimateMonthlyCost(ESTIMATOR_PRESETS.business.input, 25);
    expect(e.withMarkup).toBeCloseTo(e.rawTotal * 1.25, 8);
    expect(estimateMonthlyCost(ESTIMATOR_PRESETS.business.input).withMarkup).toBeCloseTo(e.rawTotal, 8);
  });

  it("manual rank checks cost nothing; AI scans are per platform", () => {
    const e = estimateMonthlyCost({ sites: 3, keywordsPerSite: 100, checksPerWeek: 0, aiScans: 4 });
    expect(e.lines.find((l) => l.key === "rank")!.rawCost).toBe(0);
    expect(e.rawTotal).toBeCloseTo(4 * 0.85, 8);
  });

  it("sanitizes hostile input", () => {
    const s = sanitizeInput({ sites: -4, keywordsPerSite: Number.NaN, checksPerWeek: 3 as never, keywordRuns: 1e12, localSerps: 2.6 });
    expect(s).toEqual({ sites: 0, keywordsPerSite: 0, checksPerWeek: 0, keywordRuns: 1_000_000, localSerps: 3, backlinks: 0, aiScans: 0 });
  });
});

describe("billing helpers", () => {
  it("forecasts linearly to month end (at least one elapsed day)", () => {
    const now = new Date(Date.UTC(2026, 8, 16)); // Sep 16 00:00 → 15 days elapsed of 30
    expect(forecastMonthEnd(15, now)).toBeCloseTo(30, 6);
    const firstHour = new Date(Date.UTC(2026, 8, 1, 1));
    expect(forecastMonthEnd(2, firstHour)).toBeCloseTo(60, 6);
  });

  it("lists the last N month keys newest first", () => {
    expect(monthKeysBack(new Date(Date.UTC(2026, 1, 10)), 3)).toEqual(["2026-02", "2026-01", "2025-12"]);
  });

  it("escapes CSV cells and neutralises formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell(-2)).toBe("-2");
    expect(csvCell(null)).toBe("");
  });
});
