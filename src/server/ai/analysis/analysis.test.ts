import { describe, expect, it } from "vitest";
import { matchBrands, maskUrls, normalizeForMatch, resolveBrand, type BrandDef } from "./brand-match";
import { classifySource, normalizeUrl, sourceOwnership, urlDomain } from "./sources";
import { isDue } from "@/server/ai/tracking/runs";
import { parsePromptCsv, toCsv } from "@/features/ai-tracking/csv";
import { resolveRange } from "@/features/ai-tracking/period";

const brands: BrandDef[] = [
  { key: "own", name: "Solakon", terms: ["Solakon", "solakon.de"], domains: ["solakon.de"], isOwn: true, competitorId: null },
  { key: "c1", name: "Anker SOLIX", terms: ["Anker SOLIX", "Anker"], domains: ["anker.com"], isOwn: false, competitorId: "c1" },
  { key: "c2", name: "Müller Solar", terms: ["Müller Solar"], domains: [], isOwn: false, competitorId: "c2" },
  { key: "c3", name: "AT&T", terms: ["AT&T"], domains: [], isOwn: false, competitorId: "c3" },
];

describe("brand matching", () => {
  it("finds brands case/diacritics-insensitively with word boundaries and ordinal positions", () => {
    const text = "Top picks: ANKER solix, then muller solar. Ankerplatz is not a brand. Solakon wins; solakon again. AT&T too.";
    const hits = matchBrands(text, brands, ["www.solakon.de"]);
    expect(hits.map((h) => h.name)).toEqual(["Anker SOLIX", "Müller Solar", "Solakon", "AT&T"]);
    expect(hits.map((h) => h.position)).toEqual([1, 2, 3, 4]);
    const own = hits.find((h) => h.isOwn)!;
    expect(own.occurrences).toBe(2);
    expect(own.cited).toBe(true);
    expect(own.charOffset).toBe(text.indexOf("Solakon"));
    expect(own.depthPct).toBeGreaterThan(0);
    expect(hits.find((h) => h.key === "c1")!.occurrences).toBe(1);
  });

  it("does not count URL targets as mentions", () => {
    const text = "See [this test](https://www.chip.de/anker-solix-test) or https://solakon.de/shop";
    expect(maskUrls(text)).toHaveLength(text.length);
    expect(matchBrands(text, brands)).toHaveLength(0);
  });

  it("keeps offsets aligned after normalization (ß → ss, diacritics)", () => {
    const n = normalizeForMatch("Straße Ü");
    expect(n.text).toBe("strasse u");
    expect(n.map[n.text.indexOf("u")]).toBe(7);
  });

  it("resolves free-text brand names to known brands", () => {
    expect(resolveBrand("Solakon GmbH", brands)?.key).toBe("own");
    expect(resolveBrand("anker", brands)?.key).toBe("c1");
    expect(resolveBrand("EcoFlow", brands)).toBeNull();
  });
});

describe("sources", () => {
  it("normalizes citation URLs", () => {
    expect(normalizeUrl("https://www.Example.com/a/?utm_source=chatgpt.com&x=1#frag")).toBe("https://example.com/a/?x=1");
    expect(normalizeUrl("http://example.com/path/")).toBe("https://example.com/path");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(urlDomain("https://www.reddit.com/r/x")).toBe("reddit.com");
  });

  it("classifies content types and ownership", () => {
    const c = (url: string, title: string | null = null, ownership: "own" | "competitor" | "third_party" = "third_party") =>
      classifySource({ url, domain: urlDomain(url), title, ownership });
    expect(c("https://www.reddit.com/r/solar/comments/1")).toBe("ugc");
    expect(c("https://www.youtube.com/watch?v=1")).toBe("video");
    expect(c("https://de.wikipedia.org/wiki/Balkonkraftwerk")).toBe("reference");
    expect(c("https://www.amazon.de/dp/B0")).toBe("retail");
    expect(c("https://blog.example.com/best-solar-kits-2026")).toBe("listicle");
    expect(c("https://example.com/anker-solix-im-test")).toBe("test");
    expect(c("https://example.com/ratgeber/kaufberatung-speicher")).toBe("buying-guide");
    expect(c("https://www.photovoltaikforum.com/thread/123-speicher/")).toBe("forum");
    expect(c("https://solakon.de/produkte/on", null, "own")).toBe("brand");
    expect(sourceOwnership("shop.anker.com", ["solakon.de"], [{ id: "c1", domains: ["anker.com"] }])).toEqual({ ownership: "competitor", competitorId: "c1" });
  });
});

describe("tracking schedule", () => {
  const now = new Date("2026-09-25T10:00:00Z");
  it("is due per frequency", () => {
    expect(isDue("daily", null, now)).toBe(true);
    expect(isDue("daily", new Date("2026-09-25T01:00:00Z"), now)).toBe(false);
    expect(isDue("daily", new Date("2026-09-24T23:00:00Z"), now)).toBe(true);
    expect(isDue("weekly", new Date("2026-09-20T12:00:00Z"), now)).toBe(false);
    expect(isDue("weekly", new Date("2026-09-18T12:00:00Z"), now)).toBe(true);
    expect(isDue("monthly", new Date("2026-09-01T12:00:00Z"), now)).toBe(false);
    expect(isDue("paused", null, now)).toBe(false);
  });
});

describe("csv + periods", () => {
  it("parses prompt CSV with header, quotes, tags and countries", () => {
    const rows = parsePromptCsv('prompt,tags,country\n"Best kit, 2026?",A|B,de\nx,,US\nOk prompt,,ZZ', "US");
    expect(rows[0]).toMatchObject({ text: "Best kit, 2026?", tags: ["A", "B"], country: "DE", error: null });
    expect(rows[1]!.error).toMatch(/too short/);
    expect(rows[2]!.error).toMatch(/Unknown country/);
  });

  it("escapes CSV output and neutralizes formulas", () => {
    expect(toCsv([["a,b", '=1+1', 'q"t']])).toBe('"a,b",\'=1+1,"q""t"');
  });

  it("resolves periods and the previous period", () => {
    const r = resolveRange("7d", null, null, "2026-09-25");
    expect(r).toMatchObject({ from: "2026-09-19", to: "2026-09-25", days: 7, prev: { from: "2026-09-12", to: "2026-09-18" } });
    const c = resolveRange("custom", "2026-09-01", "2026-09-10", "2026-09-25");
    expect(c).toMatchObject({ from: "2026-09-01", to: "2026-09-10", days: 10, prev: { from: "2026-08-22", to: "2026-08-31" } });
  });
});
