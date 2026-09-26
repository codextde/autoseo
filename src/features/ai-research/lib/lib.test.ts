import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv, toCsv, slugify } from "./csv";
import { citationMatchesBrand, splitByBrand, textMentionsBrand } from "./brand-match";

describe("csv", () => {
  it("round-trips quotes, delimiters and newlines", () => {
    const csv = toCsv(["Prompt", "Topic"], [['Welches "beste" Balkonkraftwerk, 2026?', "Speicher"], ["Zeile\nzwei", ""]]);
    expect(parseCsv(csv)).toEqual([
      ["Prompt", "Topic"],
      ['Welches "beste" Balkonkraftwerk, 2026?', "Speicher"],
      ["Zeile\nzwei", ""],
    ]);
  });
  it("neutralizes spreadsheet formulas", () => {
    expect(toCsv(["a"], [["=HYPERLINK(1)"], ["+1"], ["@x"]])).toContain("'=HYPERLINK(1)");
  });
  it("detects semicolon and tab delimiters", () => {
    expect(detectDelimiter("prompt;topic\na;b")).toBe(";");
    expect(detectDelimiter("prompt\ttopic")).toBe("\t");
    expect(parseCsv("prompt;topic\n\"a;b\";c")).toEqual([
      ["prompt", "topic"],
      ["a;b", "c"],
    ]);
  });
  it("slugifies file names", () => {
    expect(slugify("Default List — Ü")).toBe("default-list-u");
  });
});

describe("brand matching", () => {
  it("uses word boundaries", () => {
    expect(textMentionsBrand("Solakonix is not it", "Solakon")).toBe(false);
    expect(textMentionsBrand("Try Solakon.", "solakon")).toBe(true);
    expect(textMentionsBrand("anything", null)).toBeNull();
  });
  it("handles brands with symbols", () => {
    expect(textMentionsBrand("We like C++ a lot", "C++")).toBe(true);
    expect(textMentionsBrand("AT&T and others", "AT&T")).toBe(true);
  });
  it("matches citations by url or title", () => {
    expect(citationMatchesBrand({ url: "https://www.solakon.de/x", title: null }, "Solakon")).toBe(true);
    expect(citationMatchesBrand({ url: "https://test.de", title: "Solakon im Test" }, "solakon")).toBe(true);
    expect(citationMatchesBrand({ url: "https://test.de", title: "Other" }, "Solakon")).toBe(false);
  });
  it("splits text for highlighting", () => {
    expect(splitByBrand("Solakon vs Anker: Solakon wins", "Solakon").filter((s) => s.match)).toHaveLength(2);
  });
});
