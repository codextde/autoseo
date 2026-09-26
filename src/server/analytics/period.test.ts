import { describe, expect, it } from "vitest";
import { isValidDate, resolveAnalyticsPeriod } from "./period";

const today = new Date("2026-09-25T12:00:00Z");

describe("resolveAnalyticsPeriod", () => {
  it("resolves presets with lag and previous period", () => {
    const p = resolveAnalyticsPeriod({ period: "7d" }, { today, lagDays: 2 });
    expect(p).toMatchObject({ preset: "7d", from: "2026-09-17", to: "2026-09-23", days: 7, prevFrom: "2026-09-10", prevTo: "2026-09-16" });
  });
  it("falls back to 30d for unknown presets and invalid custom dates", () => {
    expect(resolveAnalyticsPeriod({ period: "bogus" }, { today }).preset).toBe("30d");
    const bad = resolveAnalyticsPeriod({ period: "custom", from: "2026-00-00" }, { today });
    expect(bad.preset).toBe("30d");
    expect(bad.days).toBe(30);
    expect(() => resolveAnalyticsPeriod({ period: "custom", from: "2026-13-40", to: "2026-02-30" }, { today })).not.toThrow();
  });
  it("never extends into the future or beyond 16 months", () => {
    const future = resolveAnalyticsPeriod({ period: "custom", from: "2030-01-01", to: "2026-09-01" }, { today });
    expect(future.to <= "2026-09-25").toBe(true);
    expect(future.from).toBe("2026-09-01");
    const old = resolveAnalyticsPeriod({ period: "custom", from: "2020-01-01", to: "2020-02-01" }, { today });
    expect(old.from >= "2025-05-27").toBe(true);
    expect(old.to >= old.from).toBe(true);
  });
  it("validates real calendar dates", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("26-1-1")).toBe(false);
  });
});
