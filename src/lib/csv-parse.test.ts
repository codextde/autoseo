import { describe, expect, it } from "vitest";
import { buildCsv } from "@/server/seo/lib/csv";
import { parseCsv, parseCsvNumbers } from "./csv-parse";

describe("parseCsv", () => {
  it("round-trips the CSV produced by the export helpers", () => {
    const csv = buildCsv(["URL", "Status", "Title"], [
      ["https://a.test/x?y=1", 200, 'Title with "quotes", commas'],
      ["https://a.test/b", 404, "multi\nline"],
      ["https://a.test/c", null, "=HYPERLINK()"],
    ]);
    const [head, ...rows] = parseCsv(csv);
    expect(head).toEqual(["URL", "Status", "Title"]);
    expect(rows).toEqual([
      ["https://a.test/x?y=1", "200", 'Title with "quotes", commas'],
      ["https://a.test/b", "404", "multi\nline"],
      ["https://a.test/c", "", "'=HYPERLINK()"],
    ]);
  });
  it("handles CRLF, BOM and a trailing newline", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("converts plain numbers but keeps codes with leading zeros", () => {
    expect(parseCsvNumbers([["12", "-3.5", "0123", "0", "1e5", ""]])).toEqual([[12, -3.5, "0123", 0, "1e5", ""]]);
  });
});
