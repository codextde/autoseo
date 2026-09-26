import { describe, expect, it } from "vitest";
import { flagEmoji, getCountry } from "@/lib/countries";
import { extractJson } from "@/server/ai/llm";

describe("foundation", () => {
  it("resolves countries and flags", () => {
    expect(getCountry("de")?.locationCode).toBe(2276);
    expect(getCountry("GB")?.iso).toBe("UK");
    expect(flagEmoji("UK")).toBe("🇬🇧");
  });
  it("extracts JSON from model output", () => {
    expect(extractJson('Sure! ```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('prefix {"x":"}"} suffix')).toEqual({ x: "}" });
  });
});
