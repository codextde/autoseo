import { afterEach, describe, expect, it, vi } from "vitest";
import { columnLetter, createSpreadsheetFromRows, SheetExportLimitError, toSheetValue, validateSheetExport } from "./sheets";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function mockFetch(responses: ((call: Call) => unknown)[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const next = responses[calls.length - 1];
    const payload = next ? next(call) : {};
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("sheet values", () => {
  it("keeps values verbatim for RAW input and strips the CSV injection apostrophe", () => {
    expect(toSheetValue("'=SUM(A1)")).toBe("=SUM(A1)");
    expect(toSheetValue("'plain")).toBe("'plain");
    expect(toSheetValue(12.5)).toBe(12.5);
    expect(toSheetValue(Number.NaN)).toBe("");
    expect(toSheetValue(null)).toBe("");
    expect(toSheetValue(true)).toBe(true);
  });
  it("computes column letters", () => {
    expect([1, 26, 27, 52, 703].map(columnLetter)).toEqual(["A", "Z", "AA", "AZ", "AAA"]);
  });
  it("enforces Sheets size limits", () => {
    expect(() => validateSheetExport([], [])).toThrow(SheetExportLimitError);
    expect(() => validateSheetExport(["a"], Array.from({ length: 200_001 }, () => ["x"]))).toThrow(SheetExportLimitError);
    expect(() => validateSheetExport(Array.from({ length: 100 }, (_, i) => `c${i}`), Array.from({ length: 60_000 }, () => []))).toThrow(
      SheetExportLimitError,
    );
  });
});

describe("createSpreadsheetFromRows", () => {
  it("creates the spreadsheet, writes values and formats a bold frozen header", async () => {
    const calls = mockFetch([
      () => ({ spreadsheetId: "sheet123", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet123/edit", sheets: [{ properties: { sheetId: 7, title: "Data" } }] }),
      () => ({ updatedRows: 3 }),
      () => ({ replies: [] }),
    ]);
    const res = await createSpreadsheetFromRows("tok_abc", {
      title: "keyword-research — 2026-09-26",
      headers: ["Keyword", "Volume"],
      rows: [
        ["balkonkraftwerk", 12100],
        ["'=cmd", null],
      ],
    });
    expect(res).toEqual({ spreadsheetId: "sheet123", url: "https://docs.google.com/spreadsheets/d/sheet123/edit", rows: 2 });
    expect(calls).toHaveLength(3);
    const [create, values, format] = calls;
    expect(create!.url).toBe("https://sheets.googleapis.com/v4/spreadsheets");
    expect(create!.method).toBe("POST");
    expect(create!.headers.Authorization).toBe("Bearer tok_abc");
    expect(create!.body).toMatchObject({
      properties: { title: "keyword-research — 2026-09-26" },
      sheets: [{ properties: { title: "Data", gridProperties: { frozenRowCount: 1, rowCount: 3, columnCount: 2 } } }],
    });
    expect(values!.method).toBe("PUT");
    expect(values!.url).toContain("/spreadsheets/sheet123/values/");
    expect(values!.url).toContain("valueInputOption=RAW");
    expect(decodeURIComponent(values!.url)).toContain("'Data'!A1:B3");
    expect((values!.body as { values: unknown[][] }).values).toEqual([
      ["Keyword", "Volume"],
      ["balkonkraftwerk", 12100],
      ["=cmd", ""],
    ]);
    expect(format!.url).toBe("https://sheets.googleapis.com/v4/spreadsheets/sheet123:batchUpdate");
    const req = (format!.body as { requests: Record<string, unknown>[] }).requests[0] as {
      repeatCell: { range: { sheetId: number; endRowIndex: number }; cell: { userEnteredFormat: { textFormat: { bold: boolean } } } };
    };
    expect(req.repeatCell.range).toMatchObject({ sheetId: 7, startRowIndex: 0, endRowIndex: 1 });
    expect(req.repeatCell.cell.userEnteredFormat.textFormat.bold).toBe(true);
  });

  it("writes large tables in chunks", async () => {
    const calls = mockFetch([() => ({ spreadsheetId: "big", spreadsheetUrl: "u", sheets: [{ properties: { sheetId: 0 } }] })]);
    await createSpreadsheetFromRows("t", { title: "big", headers: ["a"], rows: Array.from({ length: 25_000 }, (_, i) => [i]) });
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(3);
    expect(decodeURIComponent(puts[1]!.url)).toContain("A10001:A20000");
    expect(decodeURIComponent(puts[2]!.url)).toContain("A20001:A25001");
  });
});
