import { describe, expect, it } from "vitest";
import {
  clampScore,
  compareTasks,
  fingerprintKey,
  impactBand,
  priorityBand,
  priorityScore,
  stableHash,
  taskFingerprint,
} from "./scoring";

describe("priorityScore", () => {
  it("spans 10..100", () => {
    expect(priorityScore(10, 1)).toBe(100);
    expect(priorityScore(1, 10)).toBe(10);
  });
  it("is monotonic: more impact ⇒ higher, more effort ⇒ lower", () => {
    for (let e = 1; e <= 10; e++) for (let i = 1; i < 10; i++) expect(priorityScore(i + 1, e)).toBeGreaterThan(priorityScore(i, e));
    for (let i = 1; i <= 10; i++) for (let e = 1; e < 10; e++) expect(priorityScore(i, e + 1)).toBeLessThan(priorityScore(i, e));
  });
  it("weights impact more than effort", () => {
    // +1 impact outweighs −1 effort
    expect(priorityScore(8, 6)).toBeGreaterThan(priorityScore(7, 5));
  });
  it("clamps out-of-range and non-finite input", () => {
    expect(priorityScore(50, -3)).toBe(100);
    expect(priorityScore(Number.NaN, Number.NaN)).toBe(priorityScore(6, 6));
    expect(clampScore(3.6)).toBe(4);
  });
  it("maps to bands", () => {
    expect(priorityBand(100).short).toBe("P1");
    expect(priorityBand(62).short).toBe("P2");
    expect(priorityBand(50).short).toBe("P3");
    expect(priorityBand(20).short).toBe("P4");
    expect(impactBand(8)).toBe("high");
    expect(impactBand(5)).toBe("medium");
    expect(impactBand(2)).toBe("low");
  });
});

describe("taskFingerprint", () => {
  it("is stable across case, whitespace, protocol and trailing slashes", () => {
    const a = taskFingerprint("citation_gap", ["https://www.Reddit.com/r/solar/", "chatgpt"]);
    const b = taskFingerprint("citation_gap", ["reddit.com/r/solar", "  ChatGPT "]);
    expect(a).toBe(b);
    expect(a.startsWith("citation_gap:")).toBe(true);
  });
  it("differs by signal and by subject", () => {
    expect(taskFingerprint("a", ["x"])).not.toBe(taskFingerprint("b", ["x"]));
    expect(taskFingerprint("a", ["x"])).not.toBe(taskFingerprint("a", ["y"]));
    expect(taskFingerprint("a", ["x", "y"])).not.toBe(taskFingerprint("a", ["y", "x"]));
  });
  it("keeps the readable key", () => {
    expect(fingerprintKey("vis", ["Best Balkonkraftwerk?", "DE"])).toBe("vis|best balkonkraftwerk?|de");
  });
});

describe("stableHash", () => {
  it("ignores key order but not values", () => {
    expect(stableHash({ a: 1, b: [1, 2] })).toBe(stableHash({ b: [1, 2], a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
});

describe("compareTasks", () => {
  it("sorts by priority, then impact, then recency", () => {
    const rows = [
      { id: "low", priority: 40, impact: 3, lastDetectedAt: "2026-01-02" },
      { id: "hi", priority: 90, impact: 9, lastDetectedAt: "2026-01-01" },
      { id: "tieOld", priority: 60, impact: 6, lastDetectedAt: "2026-01-01" },
      { id: "tieNew", priority: 60, impact: 6, lastDetectedAt: "2026-01-05" },
      { id: "tieImpact", priority: 60, impact: 7, lastDetectedAt: "2026-01-01" },
    ];
    expect(rows.sort(compareTasks).map((r) => r.id)).toEqual(["hi", "tieImpact", "tieNew", "tieOld", "low"]);
  });
});
