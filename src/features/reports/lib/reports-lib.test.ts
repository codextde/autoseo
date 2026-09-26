import { describe, expect, it } from "vitest";
import PptxGenJS from "pptxgenjs";
import { aabb, resizeRotated, snapBox } from "../components/editor/geometry";
import { emptyBundle } from "./bundle";
import { CHARTS, LISTS, TABLES, TOKENS, formatValue, interpolate, resolveToken } from "./catalog";
import { resolveReportPeriod } from "./period";
import { buildPptx } from "./pptx";
import { LIBRARY_TEMPLATES, buildLibraryDeck } from "./templates/library";
import { parseMarkup, toMarkup, tokensIn } from "./text";
import { PITCH_THEME, themeFromBrandKit } from "./theme";
import { countDeck, deckSchema } from "./types";

describe("markup", () => {
  it("parses bold, accent, italic, tokens and bullets", () => {
    const [p1, p2] = parseMarkup("Is **{{brand.name}}** in ==AI search==?\n- *first* point");
    expect(p1!.runs).toEqual([
      { text: "Is " },
      { text: "", token: "brand.name", b: true },
      { text: " in " },
      { text: "AI search", color: "$accent" },
      { text: "?" },
    ]);
    expect(p2).toEqual({ bullet: true, runs: [{ text: "first", i: true }, { text: " point" }] });
  });
  it("round-trips through toMarkup", () => {
    const src = "Visibility **{{ai.visibility}}** is ==up==\n- next";
    expect(toMarkup(parseMarkup(src))).toBe(src);
  });
});

describe("periods", () => {
  it("resolves presets with an equally long previous period", () => {
    const p = resolveReportPeriod({ preset: "7d" }, new Date("2026-09-25T10:00:00Z"));
    expect(p).toMatchObject({ from: "2026-09-19", to: "2026-09-25", days: 7, prevFrom: "2026-09-12", prevTo: "2026-09-18" });
    const lm = resolveReportPeriod({ preset: "last_month" }, new Date("2026-09-25T10:00:00Z"));
    expect(lm).toMatchObject({ from: "2026-08-01", to: "2026-08-31", days: 31 });
    const custom = resolveReportPeriod({ preset: "custom", from: "2026-09-10", to: "2026-09-01" });
    expect(custom).toMatchObject({ from: "2026-09-01", to: "2026-09-10", days: 10 });
  });
});

describe("geometry", () => {
  it("keeps the opposite corner fixed when resizing an unrotated box", () => {
    const r = resizeRotated({ x: 100, y: 100, w: 200, h: 100, rotation: 0 }, "se", 50, 20);
    expect(r).toEqual({ x: 100, y: 100, w: 250, h: 120 });
    const nw = resizeRotated({ x: 100, y: 100, w: 200, h: 100, rotation: 0 }, "nw", 50, 20);
    expect(nw).toEqual({ x: 150, y: 120, w: 150, h: 80 });
  });
  it("resizes rotated boxes in their local frame", () => {
    const r = resizeRotated({ x: 0, y: 0, w: 100, h: 100, rotation: 90 }, "e", 0, 40);
    expect(Math.round(r.w)).toBe(140);
    expect(Math.round(r.h)).toBe(100);
    // east edge of a 90° box points down: the box grows downwards, its top stays in place
    const before = aabb({ x: 0, y: 0, w: 100, h: 100, rotation: 90 });
    const after = aabb({ ...r, rotation: 90 });
    expect(Math.round(after.y)).toBe(Math.round(before.y));
  });
  it("snaps to slide center", () => {
    const s = snapBox({ x: 906, y: 10, w: 100, h: 50 }, { xs: [0, 960, 1920], ys: [0, 540, 1080] }, 8);
    expect(s.dx).toBe(4);
    expect(s.gx).toEqual([960]);
  });
});

describe("catalog", () => {
  it("formats values", () => {
    expect(formatValue(66.04, "percent")).toBe("66%");
    expect(formatValue(-2.6, "delta_pp")).toBe("−2.6 pp");
    expect(formatValue(1.84, "position")).toBe("#1.8");
    expect(formatValue(null, "number")).toBe("—");
  });
  it("resolves tokens against an empty bundle without throwing", () => {
    const bundle = emptyBundle({ id: "prj_x", name: "Acme", domain: "acme.com" });
    for (const key of Object.keys(TOKENS)) expect(() => resolveToken(key, { bundle })).not.toThrow();
    expect(interpolate("{{brand.name}} · {{ai.visibility}}", { bundle })).toBe("Acme · —");
  });
});

describe("library templates", () => {
  it("builds all 11 templates with finseo slide counts, valid schema and known bindings", () => {
    const counts: Record<string, number> = {};
    for (const t of LIBRARY_TEMPLATES) {
      const deck = buildLibraryDeck(t.key, PITCH_THEME);
      expect(deckSchema.safeParse(deck).success).toBe(true);
      counts[t.key] = countDeck(deck).slides;
      for (const s of deck.slides)
        for (const e of s.elements) {
          if (e.type === "text") for (const k of tokensIn(e.paragraphs)) expect(TOKENS[k], k).toBeDefined();
          if (e.type === "chart") expect(CHARTS[e.metric]?.types).toContain(e.chartType);
          if (e.type === "list") expect(LISTS[e.source], e.source).toBeDefined();
          if (e.type === "table" && e.source) expect(TABLES[e.source], e.source).toBeDefined();
          if (e.type === "kpi" || e.type === "score") expect(TOKENS[e.metric], e.metric).toBeDefined();
        }
    }
    expect(counts).toEqual({
      blank: 1,
      pitch: 11,
      audit_pitch: 11,
      monthly: 7,
      competitor_benchmark: 5,
      citation_analysis: 5,
      prompt_coverage: 5,
      geo_audit: 5,
      baseline: 5,
      one_pager: 1,
      classic: 1,
    });
  });
  it("applies brand kit colors", () => {
    const t = themeFromBrandKit({ accentColor: "#6EA8FF", mode: "light" });
    expect(t.mode).toBe("light");
    expect(t.colors.accent).toBe("#6EA8FF");
    expect(t.chart[0]).toBe("#6EA8FF");
  });
});

describe("pptx export", () => {
  it("writes a pptx (zip) with one slide per visible slide", async () => {
    const deck = buildLibraryDeck("pitch", PITCH_THEME);
    const bundle = emptyBundle({ id: "prj_x", name: "Acme", domain: "acme.com" });
    const pptx = await buildPptx(PptxGenJS, deck, { bundle }, { loadImage: async () => null, assetUrl: (id) => `asset:${id}` }, { title: "Test" });
    const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const text = buf.toString("latin1");
    expect(text.match(/ppt\/slides\/slide\d+\.xml/g)?.length).toBeGreaterThanOrEqual(11);
  });
});
