import { describe, expect, it } from "vitest";
import { humanizeSegment, isIdSegment } from "./page-crumb";

describe("breadcrumb labels", () => {
  it("keeps acronyms upper-case", () => {
    expect(humanizeSegment("serp-simulator")).toBe("SERP Simulator");
    expect(humanizeSegment("ai")).toBe("AI");
    expect(humanizeSegment("duplicate-content")).toBe("Duplicate Content");
  });

  it("hides opaque ids", () => {
    expect(isIdSegment("cmp_wllbx8dtybi2talr")).toBe(true);
    expect(isIdSegment("d6b06d84924cb618ed4d956be7f87806bf2f")).toBe(true);
    expect(isIdSegment("backlink-checker")).toBe(false);
    expect(humanizeSegment("agt_17azzzkonz93dmew")).toBe("Details");
  });
});
